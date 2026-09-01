import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
const executablePath = packagedExecutable(appRoot);

if (!new Set(["darwin", "win32"]).has(process.platform)) {
  throw new Error(`M1 Desktop packaged 验收尚不支持 ${process.platform}`);
}
if (!fs.existsSync(executablePath)) {
  throw new Error(`Hermit packaged executable is missing: ${executablePath}`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-m1-desktop-"));
const userData = path.join(root, "user-data");
const evidenceFile = path.join(userData, "acceptance", "desktop-evidence.jsonl");
const trayMenuEvidence = readTrayMenuEvidence(process.env.HERMIT_TRAY_EVIDENCE_FILE);
let application;
let loginBaseline;
let succeeded = false;

try {
  application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userData}`, "--lang=zh-CN"],
    cwd: root,
    env: { ...process.env, HERMIT_EVIDENCE_FILE: evidenceFile },
    timeout: 60_000,
  });
  await waitForMainWindow(application);

  const nativeState = await application.evaluate(({ app, BrowserWindow }) => {
    return {
      appName: app.getName(),
      appVersion: app.getVersion(),
      executablePath: app.getPath("exe"),
      userData: app.getPath("userData"),
      loginItem: app.getLoginItemSettings(),
      windows: BrowserWindow.getAllWindows().map((window) => ({
        title: window.getTitle(),
        visible: window.isVisible(),
      })),
    };
  });
  assert.equal(nativeState.appName, "Hermit");
  assert.equal(fs.realpathSync(nativeState.userData), fs.realpathSync(userData));
  assert.equal(nativeState.windows.some(({ title }) => title === "Hermit"), true);
  loginBaseline = nativeState.loginItem;

  const requested = !loginBaseline.openAtLogin;
  const changed = await setAndReadLoginItem(application, { openAtLogin: requested });
  assert.equal(changed.openAtLogin, requested, JSON.stringify(changed));
  if (requested && process.platform === "darwin") {
    assert.equal(changed.status, "enabled", JSON.stringify(changed));
  }
  if (requested && process.platform === "win32") {
    assert.equal(changed.executableWillLaunchAtLogin, true, JSON.stringify(changed));
  }

  const restored = await setAndReadLoginItem(application, loginItemRestoreSettings(loginBaseline));
  assert.equal(restored.openAtLogin, loginBaseline.openAtLogin, JSON.stringify(restored));
  if (process.platform === "win32" && loginBaseline.openAtLogin) {
    assert.equal(
      restored.executableWillLaunchAtLogin,
      loginBaseline.executableWillLaunchAtLogin,
      JSON.stringify(restored),
    );
  }

  await application.close();
  application = undefined;

  const evidence = readEvidence(evidenceFile);
  const startupObservation = JSON.parse(fs.readFileSync(
    path.join(userData, "desktop", "startup-observation.json"),
    "utf8",
  ));
  assert.equal(startupObservation.schemaVersion, 1);
  assert.equal(startupObservation.stage, "dsh-ready");
  assert.equal(startupObservation.launchReason, "normal");
  assert.equal(startupObservation.application.version, nativeState.appVersion);
  assert.equal(
    fs.realpathSync(startupObservation.application.executablePath),
    fs.realpathSync(nativeState.executablePath),
  );
  assert.equal(startupObservation.loginItem.wasOpenedAtLogin, false);
  const tray = evidence.find(({ event }) => event === "desktop.tray-created");
  assert.equal(tray?.details.destroyed, false);
  const trayBounds = evidence.filter(({ event }) => event === "desktop.tray-bounds").at(-1);
  assert.equal(trayBounds?.details.stage, "dsh-ready", JSON.stringify(trayBounds));
  assert.ok(trayBounds?.details.width > 0, JSON.stringify(trayBounds));
  assert.ok(trayBounds?.details.height > 0, JSON.stringify(trayBounds));
  assert.equal(event(evidence, "lifecycle.shutdown-requested").details.source, "app-quit");
  assertOrder(evidence, [
    "lifecycle.shutdown-requested",
    "lifecycle.dsh-stop-started",
    "lifecycle.dsh-stop-completed",
    "lifecycle.app-quit-requested",
  ]);

  writeAcceptanceArtifact({
    trayBounds: trayBounds.details,
    loginItemStatus: loginItemStatus(changed),
    loginItemRestored: loginItemRestored(loginBaseline, restored),
    startupObservation: {
      stage: startupObservation.stage,
      launchReason: startupObservation.launchReason,
      wasOpenedAtLogin: startupObservation.loginItem.wasOpenedAtLogin,
    },
    ...(trayMenuEvidence === undefined ? {} : { realTrayMenuClick: trayMenuEvidence }),
  });

  console.log(
    `M1 Desktop packaged passed: tray=${String(trayBounds.details.width)}x${String(trayBounds.details.height)}, login=${loginItemStatus(changed)}, shutdown=ordered`,
  );
  succeeded = true;
} catch (cause) {
  console.error(`M1 Desktop isolated state retained for diagnosis: ${root}`);
  throw cause;
} finally {
  if (application !== undefined) {
    if (loginBaseline !== undefined) {
      await setAndReadLoginItem(application, loginItemRestoreSettings(loginBaseline))
        .catch(() => undefined);
    }
    await application.close().catch(() => undefined);
  }
  if (succeeded) fs.rmSync(root, { recursive: true, force: true });
}

function packagedExecutable(rootPath) {
  const override = process.env.HERMIT_PACKAGED_EXECUTABLE;
  if (override !== undefined) {
    if (!path.isAbsolute(override)) {
      throw new Error("HERMIT_PACKAGED_EXECUTABLE must be an absolute path");
    }
    return override;
  }
  if (process.platform === "win32") {
    return path.join(rootPath, "dist", "win-unpacked", "Hermit.exe");
  }
  const output = process.arch === "arm64" ? "mac-arm64" : "mac";
  return path.join(rootPath, "dist", output, "Hermit.app", "Contents", "MacOS", "Hermit");
}

async function waitForMainWindow(target) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const page = target.windows().find((candidate) =>
      /^http:\/\/127\.0\.0\.1:\d+/u.test(candidate.url()));
    if (page !== undefined) {
      await page.locator("body").waitFor({ timeout: 30_000 });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Hermit main window did not load DSH: ${target.windows().map((page) => page.url())}`);
}

async function setAndReadLoginItem(target, settings) {
  return await target.evaluate(async ({ app }, requested) => {
    app.setLoginItemSettings(requested);
    await new Promise((resolve) => setTimeout(resolve, 750));
    return app.getLoginItemSettings();
  }, settings);
}

function loginItemRestoreSettings(baseline) {
  if (process.platform !== "win32" || !baseline.openAtLogin) {
    return { openAtLogin: baseline.openAtLogin };
  }
  const matching = baseline.launchItems?.find(({ path: itemPath }) =>
    typeof itemPath === "string" && itemPath.toLowerCase().includes("hermit.exe"));
  return {
    openAtLogin: true,
    enabled: matching?.enabled ?? baseline.executableWillLaunchAtLogin,
  };
}

function loginItemRestored(baseline, restored) {
  if (restored.openAtLogin !== baseline.openAtLogin) return false;
  return process.platform !== "win32" || !baseline.openAtLogin ||
    restored.executableWillLaunchAtLogin === baseline.executableWillLaunchAtLogin;
}

function loginItemStatus(state) {
  if (process.platform === "darwin") return state.status ?? "unknown";
  return state.executableWillLaunchAtLogin ? "enabled" : "disabled";
}

function readEvidence(file) {
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
}

function readTrayMenuEvidence(file) {
  if (file === undefined) return undefined;
  if (!path.isAbsolute(file)) {
    throw new Error("HERMIT_TRAY_EVIDENCE_FILE must be an absolute path");
  }
  const command = readEvidence(file).find(({ event: name, details }) =>
    name === "desktop.tray-command" && details?.command === "open-main");
  assert.ok(command, "真实 Tray 证据中缺少 open-main 菜单命令");
  return { status: "PASS", command: "open-main", at: command.at };
}

function event(entries, name) {
  const entry = entries.find(({ event: current }) => current === name);
  assert.ok(entry, `Missing evidence event: ${name}`);
  return entry;
}

function assertOrder(entries, names) {
  const indexes = names.map((name) => entries.findIndex(({ event: current }) => current === name));
  assert.equal(indexes.every((index) => index >= 0), true, JSON.stringify({ names, indexes }));
  assert.deepEqual([...indexes].sort((a, b) => a - b), indexes);
}

function writeAcceptanceArtifact(observed) {
  const localQualification = observed.realTrayMenuClick === undefined
    ? ["real-tray-menu-click", "real-login-cycle"]
    : ["real-login-cycle"];
  const directory = path.resolve(appRoot, "..", "..", ".hermit", "artifacts");
  fs.mkdirSync(directory, { recursive: true });
  let persistedObserved = observed;
  if (observed.realTrayMenuClick !== undefined) {
    const evidenceArtifact = `m1-desktop-tray-${process.platform}-${process.arch}.jsonl`;
    fs.copyFileSync(process.env.HERMIT_TRAY_EVIDENCE_FILE, path.join(directory, evidenceArtifact));
    persistedObserved = {
      ...observed,
      realTrayMenuClick: { ...observed.realTrayMenuClick, evidenceArtifact },
    };
  }
  fs.writeFileSync(
    path.join(directory, `m1-desktop-packaged-${process.platform}-${process.arch}.json`),
    `${JSON.stringify({
      schemaVersion: 3,
      generatedAt: new Date().toISOString(),
      status: {
        implementation: "PASS",
        localQualification: "PENDING_OS_EVIDENCE",
      },
      candidate: { executablePath, role: "packaged-local-qualification" },
      host: { platform: process.platform, architecture: process.arch },
      observed: persistedObserved,
      pendingEvidence: {
        localQualification,
      },
    }, null, 2)}\n`,
    "utf8",
  );
}
