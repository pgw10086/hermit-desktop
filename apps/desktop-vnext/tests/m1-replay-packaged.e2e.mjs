import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";
import { validateRuntimeClosure } from "../scripts/after-pack.mjs";
import {
  bundledGenerationRoot,
  defaultResourcesPath,
} from "../scripts/runtime-paths.mjs";
import {
  findRuntimeResidue,
  identifyHermitRuntime,
  readProcessSnapshot,
  sameProcessExists,
} from "./helpers/process-snapshot.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
const fixtureRoot = path.join(scriptDir, "fixtures", "dsh-approval-replay");
const fixturePath = path.join(fixtureRoot, "session.jsonl");
const provenancePath = path.join(fixtureRoot, "provenance.json");
const resourcesPath = defaultResourcesPath(appRoot, process.platform, process.arch);
const generationRoot = bundledGenerationRoot(resourcesPath);
const dshRoot = path.join(generationRoot, "dsh");
const nodeBinary = path.join(
  generationRoot,
  "node",
  process.platform === "win32" ? "node.exe" : path.join("bin", "node"),
);
const carrierEntry = path.join(resourcesPath, "runtime", "carrier", "dsh-carrier.js");
const executablePath = packagedExecutable(appRoot);

if (!new Set(["darwin", "win32"]).has(process.platform)) {
  throw new Error(`M1 Replay packaged 验收尚不支持 ${process.platform}`);
}

for (const [label, file] of [
  ["Hermit executable", executablePath],
  ["bundled Node", nodeBinary],
    ["Hermit carrier", carrierEntry],
    ["replay fixture", fixturePath],
  ["replay provenance", provenancePath],
]) {
  if (!fs.existsSync(file)) throw new Error(`${label} is missing: ${file}`);
}

const { entry: dshEntry, pnpmEntry } = validateRuntimeClosure(dshRoot);
const provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
const fixture = fs.readFileSync(fixturePath);
assert.equal(createHash("sha256").update(fixture).digest("hex"), provenance.sha256);
const generation = JSON.parse(
  fs.readFileSync(path.join(generationRoot, "generation.json"), "utf8"),
);
assert.equal(provenance.replayVersion, generation.dshVersion);

const prompt = readFixturePrompt(fixture.toString("utf8"));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-m1-replay-"));
const userData = path.join(root, "user-data");
const profileHome = path.join(userData, "dsh-home");
const workspaceParent = path.join(userData, "workspace");
const sessionWorkspace = path.join(workspaceParent, "acceptance");
fs.mkdirSync(sessionWorkspace, { recursive: true });

let firstApp;
let secondApp;
let succeeded = false;
try {
  stageReplayProfile();
  firstApp = await launchPackagedApp();
  const firstPage = await readyPage(firstApp);
  await passOnboarding(firstPage);
  await connectWorkspace(firstPage);
  await selectReadOnly(firstPage);

  const input = firstPage.locator("textarea:enabled").first();
  await input.waitFor({ timeout: 20_000 });
  await input.fill(prompt);
  await input.press("Enter");

  const approval = firstPage.locator("[data-approval-key]");
  await approval.waitFor({ timeout: 90_000 });
  assert.match(await approval.innerText(), /notes\.txt/u);
  await approval.getByRole("button", { name: /Allow once|允许一次/u }).click();

  await waitForFile(path.join(sessionWorkspace, "notes.txt"), 30_000);
  await firstPage.getByText("DONE", { exact: true }).waitFor({ timeout: 30_000 });
  await firstPage.locator("[data-approval-key]").waitFor({ state: "detached", timeout: 10_000 });
  assertSessionPersisted();

  const firstOrigin = new URL(firstPage.url()).origin;
  await killElectronMain(firstApp);
  firstApp = undefined;
  await assertOriginClosed(firstOrigin, 5_000);

  secondApp = await launchPackagedApp();
  const secondPage = await readyPage(secondApp);
  await passOnboarding(secondPage);
  await secondPage.getByText("Write a file named notes.txt", { exact: false })
    .first()
    .waitFor({ timeout: 30_000 });

  writeAcceptanceArtifact();
  console.log("M1 Replay passed: Tool approval survived Electron SIGKILL cleanup and the Session restored after restart");
  succeeded = true;
} catch (cause) {
  const application = secondApp ?? firstApp;
  const windows = application?.windows() ?? [];
  const page = windows.find((candidate) => /^http:\/\/127\.0\.0\.1:\d+/u.test(candidate.url()))
    ?? windows[0];
  const screenshot = path.join(appRoot, "dist", "m1-replay-failure.png");
  await page?.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
  console.error(`M1 Replay isolated state retained for diagnosis: ${root}`);
  throw cause;
} finally {
  await closeAfterFailure(secondApp);
  await closeAfterFailure(firstApp);
  if (succeeded) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function packagedExecutable(rootPath) {
  if (process.platform === "darwin") {
    const output = process.arch === "arm64" ? "mac-arm64" : "mac";
    return path.join(rootPath, "dist", output, "Hermit.app", "Contents", "MacOS", "Hermit");
  }
  return path.join(rootPath, "dist", "win-unpacked", "Hermit.exe");
}

function runtimeEnvironment() {
  const environment = {
    ...process.env,
    DSH_HOME: profileHome,
    PATH: [
      path.dirname(nodeBinary),
      path.join(dshRoot, "node_modules", ".bin"),
      process.env.PATH ?? process.env.Path ?? "",
    ].filter(Boolean).join(path.delimiter),
  };
  delete environment.Path;
  delete environment.NODE_OPTIONS;
  delete environment.NODE_PATH;
  delete environment.node_path;
  delete environment.PNPM_HOME;
  delete environment.COREPACK_HOME;
  for (const key of Object.keys(environment)) {
    const normalized = key.toLowerCase();
    if (
      normalized === "npm_execpath" ||
      normalized === "npm_node_execpath" ||
      normalized.startsWith("npm_config_") ||
      normalized.startsWith("pnpm_config_")
    ) {
      delete environment[key];
    }
  }
  return environment;
}

function stageReplayProfile() {
  const runtimeManifest = JSON.parse(
    fs.readFileSync(path.join(dshRoot, "hermit-runtime.json"), "utf8"),
  );
  const pnpmVersion = spawnSync(nodeBinary, [pnpmEntry, "--version"], {
    encoding: "utf8",
    env: runtimeEnvironment(),
  });
  assert.equal(pnpmVersion.status, 0, pnpmVersion.stderr);
  assert.equal(pnpmVersion.stdout.trim(), runtimeManifest.pnpmVersion);

  const packageSpec = `${provenance.replayPackage}@${provenance.replayVersion}`;
  const install = spawnSync(
    nodeBinary,
    [dshEntry, "plugin", "--profile", "web", "add", "-E", packageSpec],
    {
      cwd: workspaceParent,
      env: runtimeEnvironment(),
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    },
  );
  assert.equal(install.status, 0, `${install.stdout}\n${install.stderr}`);

  const profileRoot = path.join(profileHome, "profiles", "web");
  const profile = JSON.parse(fs.readFileSync(path.join(profileRoot, "package.json"), "utf8"));
  assert.equal(profile.dependencies?.[provenance.replayPackage], provenance.replayVersion);
  fs.writeFileSync(
    path.join(profileRoot, "cordis.patch.yml"),
    replayPatch(fixturePath),
  );
}

function replayPatch(file) {
  return `# M1 keyless acceptance overlay; isolated from the user's DSH_HOME.
- id: llm-deepseek
  disabled: true

- id: session-title-llm
  disabled: true

- insert:
    - id: llm-replay
      name: '@deepseek-ai/dsh-llm-replay'
      config:
        file: ${JSON.stringify(file)}
        paceMs: 15
        providers:
          - id: deepseek-official
            name: DeepSeek
            retryPolicy:
              mode: normal
              backoff:
                initialDelayMs: 1
                maxDelayMs: 1
                jitterRatio: 0
            models:
              - id: deepseek-v4-flash
                contextWindow: 128000
`;
}

function writeAcceptanceArtifact() {
  const directory = path.resolve(appRoot, "..", "..", ".hermit", "artifacts");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, `m1-replay-packaged-${process.platform}-${process.arch}.json`),
    `${JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      status: "PASS",
      candidate: { executablePath },
      host: { platform: process.platform, architecture: process.arch },
      replay: {
        package: provenance.replayPackage,
        version: provenance.replayVersion,
        fixtureSha256: provenance.sha256,
      },
      observed: {
        approval: "allow-once",
        toolResult: "file-created",
        electronMainTermination: "SIGKILL",
        dshProcessGroupReclaimed: true,
        originClosed: true,
        sessionRestored: true,
      },
    }, null, 2)}\n`,
    "utf8",
  );
}

async function launchPackagedApp() {
  const application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userData}`, "--lang=en-US"],
    cwd: workspaceParent,
    // DSH 的公开 auto picker 合同在 SSH 场景选择浏览器内 picker，避免 E2E
    // 依赖 Playwright 无法控制的 macOS 原生对话框。
    env: { ...process.env, SSH_TTY: "hermit-m1-replay" },
    timeout: 60_000,
  });
  const actualUserData = await application.evaluate(({ app }) => app.getPath("userData"));
  assert.equal(fs.realpathSync(actualUserData), fs.realpathSync(userData));
  return application;
}

async function readyPage(application) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const page = application.windows().find((candidate) =>
      /^http:\/\/127\.0\.0\.1:\d+/u.test(candidate.url()));
    if (page !== undefined) {
      await page.locator('[class*="frame"]').waitFor({ timeout: 30_000 });
      return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Hermit main window did not load DSH; windows=${application.windows().map((page) => page.url()).join(", ")}`,
  );
}

async function passOnboarding(page) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const button = page.getByRole("button", {
      name: /Continue|继续|Configure later|稍后配置/u,
    }).first();
    if (!(await button.isVisible({ timeout: 1_000 }).catch(() => false))) return;
    if (!(await button.isEnabled().catch(() => false))) {
      await page.waitForTimeout(250);
      continue;
    }
    await button.click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(250);
  }
  throw new Error("DSH onboarding did not settle within 30 seconds");
}

async function connectWorkspace(page) {
  const choose = page.getByRole("textbox", { name: /Choose workspace|选择工作区/u });
  if (!(await choose.isVisible({ timeout: 2_000 }).catch(() => false))) return;
  await choose.click();
  const dialog = page.getByRole("dialog", { name: /Select Workspace Directory|选择工作区目录/u });
  await dialog.waitFor({ timeout: 10_000 });
  await dialog.getByRole("button", { name: /Edit path|编辑路径/u }).click();
  const pathInput = dialog.getByRole("textbox", { name: /Edit path|编辑路径/u });
  await pathInput.fill(sessionWorkspace);
  await pathInput.press("Enter");
  const open = dialog.getByRole("button").filter({ hasText: /^(Open|打开)$/u });
  await open.waitFor({ timeout: 10_000 });
  await open.click();
  await page.locator("textarea:enabled").first().waitFor({ timeout: 20_000 });
}

async function selectReadOnly(page) {
  const access = page.locator(
    '[aria-label^="Access mode"], [aria-label^="访问模式"], [aria-label^="权限模式"]',
  ).first();
  await access.waitFor({ timeout: 15_000 });
  await access.click();
  await page.getByRole("menuitem", { name: /Read Only|只读/u }).click();
  await page.locator(
    '[aria-label="Access mode, current: Read Only"], [aria-label*="只读"]',
  ).first().waitFor({ timeout: 15_000 });
}

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`approved tool did not create ${file}`);
}

function assertSessionPersisted() {
  const logs = [
    ...findFiles(path.join(profileHome, "sessions"), ".jsonl"),
    ...findFiles(path.join(profileHome, "sessions"), ".jsonl.zstd"),
  ];
  assert.ok(logs.length > 0, "DSH did not persist a Session log");
  assert.ok(logs.some((file) => fs.statSync(file).size > 0), "persisted Session log is empty");
}

function findFiles(rootPath, suffix) {
  if (!fs.existsSync(rootPath)) return [];
  return fs.readdirSync(rootPath, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(rootPath, entry.name);
    return entry.isDirectory()
      ? findFiles(fullPath, suffix)
      : entry.name.endsWith(suffix) ? [fullPath] : [];
  });
}

function readFixturePrompt(text) {
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const event = JSON.parse(line);
    if (event.type !== "user/message") continue;
    const promptText = event.data?.content?.find((block) => block.type === "text")?.text;
    if (typeof promptText === "string") return promptText;
  }
  throw new Error("Replay fixture contains no user prompt");
}

async function assertProcessesExited(identities, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = readProcessSnapshot();
    const alive = identities.filter((identity) => sameProcessExists(identity, snapshot));
    if (alive.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const snapshot = readProcessSnapshot();
  const alive = identities.filter((identity) => sameProcessExists(identity, snapshot));
  throw new Error(`Hermit quit left owned processes alive: ${alive.map(({ pid }) => pid).join(", ")}`);
}

async function closeGracefully(application) {
  const rootPid = application.process().pid;
  let owned = [];
  try {
    const runtime = identifyHermitRuntime(readProcessSnapshot(), rootPid);
    owned = [runtime.carrier, runtime.dsh, ...runtime.dshDescendants];
  } catch {
    // 失败清理可能发生在 DSH ready 前；此时只等待 Electron 自己退出。
  }
  const exited = new Promise((resolve) => {
    if (application.process().exitCode !== null) resolve();
    else application.process().once("exit", resolve);
  });
  void application.evaluate(({ app }) => app.quit()).catch(() => undefined);
  await Promise.race([
    exited,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`Hermit did not quit within 15 seconds (pid=${String(rootPid)})`)),
      15_000,
    )),
  ]);
  await assertProcessesExited(owned, 8_000);
}

async function killElectronMain(application) {
  const rootPid = application.process().pid;
  const runtime = identifyHermitRuntime(readProcessSnapshot(), rootPid);
  const owned = [runtime.carrier, runtime.dsh, ...runtime.dshDescendants];
  const dshGroup = runtime.dsh.groupId;
  const exited = new Promise((resolve) => application.process().once("exit", resolve));
  killMainOnly(rootPid);
  await exited;
  await assertProcessesExited(owned, 8_000);
  if (process.platform === "darwin") {
    assert.equal(
      processGroupExists(dshGroup),
      false,
      `DSH process group ${String(dshGroup)} survived Electron SIGKILL`,
    );
  }
  const residue = findRuntimeResidue(readProcessSnapshot(), { carrierEntry, dshEntry, nodeBinary });
  assert.deepEqual(
    residue.map(({ pid }) => pid),
    [],
    `Hermit runtime residue survived Electron hard kill: ${residue.map(({ pid }) => pid)}`,
  );
}

function killMainOnly(pid) {
  if (process.platform !== "win32") {
    process.kill(pid, "SIGKILL");
    return;
  }
  // 不加 /T：测试必须让 carrier 通过父管道 EOF 自己回收 DSH，而不是让 taskkill 代劳。
  const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/F"], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

async function assertOriginClosed(origin, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin);
      await response.body?.cancel();
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`DSH origin still responds after Electron SIGKILL: ${origin}`);
}

function processGroupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (cause) {
    if (cause?.code === "ESRCH") return false;
    throw cause;
  }
}

async function closeAfterFailure(application) {
  if (application === undefined || application.process().exitCode !== null) return;
  try {
    await closeGracefully(application);
  } catch {
    await application.close().catch(() => undefined);
  }
}
