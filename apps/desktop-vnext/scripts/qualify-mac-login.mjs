import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

const scriptPath = fileURLToPath(import.meta.url);
const appRoot = path.resolve(path.dirname(scriptPath), "..");
const repositoryRoot = path.resolve(appRoot, "..", "..");
const bundledNode = path.join(repositoryRoot, ".hermit", "runtime", "node", "bin", "node");
const expectedNodeVersion = fs.readFileSync(
  path.join(repositoryRoot, ".node-version"),
  "utf8",
).trim();
const expectedDshVersion = JSON.parse(
  fs.readFileSync(path.join(appRoot, "package.json"), "utf8"),
).dependencies["@deepseek-ai/dsh"];
const sourceApp = path.join(appRoot, "dist", "mac-smoke", "mac-arm64", "Hermit.app");
const installedApp = "/Applications/Hermit.app";
const installedExecutable = path.join(installedApp, "Contents", "MacOS", "Hermit");
const artifactsDirectory = path.join(repositoryRoot, ".hermit", "artifacts");
const pendingArtifact = path.join(
  artifactsDirectory,
  "m1-local-login-pending-darwin-arm64.json",
);
const finalArtifact = path.join(
  artifactsDirectory,
  "m1-local-login-darwin-arm64.json",
);
const desktopArtifact = path.join(
  artifactsDirectory,
  "m1-desktop-packaged-darwin-arm64.json",
);
const loginObservationArtifactName = "m1-local-login-startup-darwin-arm64.json";
const loginObservationArtifact = path.join(artifactsDirectory, loginObservationArtifactName);
const action = process.argv[2];

if (!new Set(["status", "prepare", "verify"]).has(action)) {
  throw new Error("Usage: qualify-mac-login.mjs <status|prepare|verify>");
}
if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("macOS 登录资格只能在原生 Apple Silicon 主机运行");
}

if (!process.argv.includes("--qualified-runtime")) {
  const result = spawnSync(
    bundledNode,
    [scriptPath, action, "--qualified-runtime"],
    { cwd: repositoryRoot, env: process.env, stdio: "inherit" },
  );
  if (result.error !== undefined) throw result.error;
  process.exit(result.status ?? 1);
}
if (process.version !== `v${expectedNodeVersion}`) {
  throw new Error(`登录资格要求 bundled Node ${expectedNodeVersion}，当前为 ${process.version}`);
}

try {
  if (action === "status") await showStatus();
  if (action === "prepare") await prepareQualification();
  if (action === "verify") await verifyQualification();
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
}

async function showStatus() {
  const result = {
    schemaVersion: 1,
    sourceAppExists: fs.existsSync(sourceApp),
    installedAppExists: fs.existsSync(installedApp),
    installedAppRunning: runningMainPids(installedExecutable).length > 0,
    pending: readJsonIfExists(pendingArtifact),
    result: readJsonIfExists(finalArtifact),
    startupObservation: readLatestStartupObservation(),
  };
  console.log(JSON.stringify(result, undefined, 2));
}

async function prepareQualification() {
  if (process.env.HERMIT_ACCEPT_MAC_LOGIN_QUALIFICATION !== "1") {
    throw new Error(
      "prepare 会修改当前用户的 macOS 登录项；获得明确授权后设置 HERMIT_ACCEPT_MAC_LOGIN_QUALIFICATION=1",
    );
  }
  if (!fs.existsSync(sourceApp)) {
    throw new Error(`资格候选不存在，请先生成 mac-smoke: ${sourceApp}`);
  }
  if (!fs.existsSync(installedApp)) {
    throw new Error(`尚未安装稳定候选，请先经用户授权复制到 ${installedApp}`);
  }
  if (runningMainPids(installedExecutable).length > 0) {
    throw new Error("Hermit 正在运行；请先正常退出后再准备登录资格");
  }

  const sourceIdentity = await readAppIdentity(sourceApp);
  const installedIdentity = await readAppIdentity(installedApp);
  assertSameCandidate(sourceIdentity, installedIdentity);
  const existing = readJsonIfExists(pendingArtifact);
  if (existing?.phase === "armed") {
    assertPendingCandidate(existing, installedIdentity);
    console.log("M1 macOS login qualification is already armed; perform real logout/login, then run verify.");
    return;
  }
  if (existing?.phase === "cleanup-unconfirmed") {
    assertPendingCandidate(existing, installedIdentity);
    throw new Error("上一轮登录项清理尚未确认；禁止重复注册，先检查系统设置中的 Hermit 登录项");
  }
  if (existing !== undefined) assertPendingCandidate(existing, installedIdentity);

  const application = await launchInstalledApp();
  try {
    const inspected = await inspectApplication(application);
    assertInstalledProcess(inspected, installedIdentity);
    const observation = readStartupObservation(inspected.userDataPath);
    assertNormalReadyObservation(observation, installedIdentity);

    const originalLoginItem = existing?.originalLoginItem ?? inspected.loginItem;
    if (existing === undefined) assertSupportedOriginalLoginState(originalLoginItem);
    const qualificationId = existing?.qualificationId ?? randomUUID();
    const baseline = {
      schemaVersion: 1,
      qualificationId,
      phase: "baseline-recorded",
      scope: "local-machine-only",
      artifactRole: "unsigned-local-qualification",
      candidate: installedIdentity,
      userDataPath: inspected.userDataPath,
      originalLoginItem,
      baselineInterpretation: loginBaselineInterpretation(originalLoginItem),
      preLoginObservation: observation,
      recordedAt: new Date().toISOString(),
    };
    writeJsonAtomic(pendingArtifact, baseline);

    let armedLoginItem = inspected.loginItem;
    if (!armedLoginItem.openAtLogin) {
      armedLoginItem = await setAndReadLoginItem(application, true);
    }
    if (armedLoginItem.status === "requires-approval") {
      writeJsonAtomic(pendingArtifact, {
        ...baseline,
        phase: "approval-required",
        armedLoginItem,
      });
      throw new Error(
        "macOS 登录项需要用户在 System Settings > General > Login Items 中批准；批准后重新运行 prepare",
      );
    }
    if (!armedLoginItem.openAtLogin || armedLoginItem.status !== "enabled") {
      const cleanupLoginItem = await setAndReadLoginItem(application, false);
      const cleanupPassed = isCanonicalDisabledLoginItem(cleanupLoginItem);
      recordRegistrationNotEstablished(
        baseline,
        armedLoginItem,
        cleanupLoginItem,
        cleanupPassed,
      );
      throw new Error(
        cleanupPassed
          ? `登录项注册没有建立，已恢复为 not-registered，不执行注销: ${JSON.stringify(armedLoginItem)}`
          : `登录项注册没有建立且清理未确认，不执行注销: ${JSON.stringify({ armedLoginItem, cleanupLoginItem })}`,
      );
    }
    const armedAt = new Date().toISOString();
    writeJsonAtomic(pendingArtifact, {
      ...baseline,
      phase: "armed",
      armedAt,
      armedLoginItem,
    });
    console.log(
      `M1 macOS login qualification armed: ${qualificationId}; save work, perform real logout/login, then run verify.`,
    );
  } finally {
    await application.close().catch(() => undefined);
  }
}

async function verifyQualification() {
  const pending = readJsonIfExists(pendingArtifact);
  if (pending === undefined || pending.phase !== "armed") {
    throw new Error("没有已 armed 的登录资格事务；先运行 prepare");
  }
  if (!fs.existsSync(installedApp)) {
    throw new Error(`登录后候选已不存在: ${installedApp}`);
  }
  const installedIdentity = await readAppIdentity(installedApp);
  assertPendingCandidate(pending, installedIdentity);
  const loginObservation = readStartupObservation(pending.userDataPath);
  const functionalFailures = validateLoginObservation(loginObservation, pending);

  fs.mkdirSync(artifactsDirectory, { recursive: true });
  writeJsonAtomic(loginObservationArtifact, loginObservation);
  const restoredLoginItem = await restoreOriginalLoginItem(pending.originalLoginItem);
  const cleanupPassed = loginStateMatches(restoredLoginItem, pending.originalLoginItem);
  if (!cleanupPassed) {
    throw new Error(
      `登录项未恢复到原始状态，保留 pending 供人工处理: ${JSON.stringify(restoredLoginItem)}`,
    );
  }

  const passed = functionalFailures.length === 0;
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    qualificationId: pending.qualificationId,
    scope: "local-machine-only",
    artifactRole: "unsigned-local-qualification",
    status: passed ? "PASS" : "NOT_ESTABLISHED",
    candidate: installedIdentity,
    preLogin: {
      armedAt: pending.armedAt,
      originalLoginItem: pending.originalLoginItem,
      armedLoginItem: pending.armedLoginItem,
    },
    postLogin: {
      evidenceArtifact: loginObservationArtifactName,
      observation: loginObservation,
      failures: functionalFailures,
    },
    cleanup: { status: "PASS", restoredLoginItem },
  };
  writeJsonAtomic(finalArtifact, result);
  // 登录项已经恢复后先关闭事务，避免派生汇总写入失败留下可重复执行的 armed journal。
  fs.rmSync(pendingArtifact, { force: true });
  updateDesktopArtifact(passed, result);

  if (!passed) {
    throw new Error(
      `unsigned 登录启动没有形成有效本机证据，但不反向判定实现失败: ${functionalFailures.join("; ")}`,
    );
  }
  console.log(`M1_LOCAL_QUALIFIED = PASS (${pending.qualificationId})`);
}

async function launchInstalledApp() {
  const application = await electron.launch({
    executablePath: installedExecutable,
    cwd: os.homedir(),
    timeout: 60_000,
  });
  await waitForMainWindow(application);
  return application;
}

async function waitForMainWindow(application) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const page = application.windows().find((candidate) =>
      /^http:\/\/127\.0\.0\.1:\d+/u.test(candidate.url()));
    if (page !== undefined) {
      await page.locator("body").waitFor({ timeout: 30_000 });
      return;
    }
    await delay(100);
  }
  throw new Error("安装后的 Hermit 没有在 60 秒内到达 DSH Web ready");
}

async function inspectApplication(application) {
  return await application.evaluate(({ app }) => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    executablePath: app.getPath("exe"),
    userDataPath: app.getPath("userData"),
    loginItem: ((value) => ({
      openAtLogin: value.openAtLogin === true,
      status: typeof value.status === "string" ? value.status : "unavailable",
      wasOpenedAtLogin: value.wasOpenedAtLogin === true,
    }))(app.getLoginItemSettings()),
  }));
}

async function setAndReadLoginItem(application, openAtLogin) {
  return await application.evaluate(async ({ app }, requested) => {
    app.setLoginItemSettings({ openAtLogin: requested, type: "mainAppService" });
    const deadline = Date.now() + 5_000;
    let current = app.getLoginItemSettings({ type: "mainAppService" });
    while (Date.now() < deadline) {
      const requestedStateObserved = requested
        ? current.openAtLogin && current.status === "enabled"
        : !current.openAtLogin && current.status === "not-registered";
      if (requestedStateObserved || (requested && current.status === "requires-approval")) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
      current = app.getLoginItemSettings({ type: "mainAppService" });
    }
    return {
      openAtLogin: current.openAtLogin === true,
      status: typeof current.status === "string" ? current.status : "unavailable",
      wasOpenedAtLogin: current.wasOpenedAtLogin === true,
    };
  }, openAtLogin);
}

async function restoreOriginalLoginItem(original) {
  await stopInstalledApplication();
  const application = await launchInstalledApp();
  try {
    return await setAndReadLoginItem(application, original.openAtLogin);
  } finally {
    await application.close().catch(() => undefined);
  }
}

async function stopInstalledApplication() {
  const pids = runningMainPids(installedExecutable);
  for (const pid of pids) process.kill(pid, "SIGTERM");
  const deadline = Date.now() + 15_000;
  while (runningMainPids(installedExecutable).length > 0 && Date.now() < deadline) {
    await delay(100);
  }
  if (runningMainPids(installedExecutable).length > 0) {
    throw new Error("无法正常退出登录后启动的 Hermit；不使用强杀掩盖 cleanup 失败");
  }
}

function runningMainPids(executable) {
  const result = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  if (result.status !== 0) return [];
  return result.stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(.+)$/u.exec(line);
    if (match === null || match[2] !== executable) return [];
    return [Number(match[1])];
  });
}

async function readAppIdentity(appPath) {
  const contents = path.join(appPath, "Contents");
  const executable = path.join(contents, "MacOS", "Hermit");
  const infoPlist = path.join(contents, "Info.plist");
  const generationPath = path.join(
    contents,
    "Resources",
    "runtime",
    "generations",
    "bundled",
    "generation.json",
  );
  for (const required of [appPath, executable, infoPlist, generationPath]) {
    if (!fs.existsSync(required)) throw new Error(`候选缺少文件: ${required}`);
  }
  const bundleId = capture("plutil", ["-extract", "CFBundleIdentifier", "raw", infoPlist]);
  const version = capture("plutil", ["-extract", "CFBundleShortVersionString", "raw", infoPlist]);
  const architectures = capture("lipo", ["-archs", executable]).split(/\s+/u).filter(Boolean);
  if (bundleId !== "io.github.pgw10086.hermit") {
    throw new Error(`候选 bundle id 不匹配: ${bundleId}`);
  }
  if (architectures.length !== 1 || architectures[0] !== "arm64") {
    throw new Error(`候选不是单一 arm64: ${architectures.join(",")}`);
  }
  const generation = readJson(generationPath);
  if (generation.nodeVersion !== expectedNodeVersion || generation.dshVersion !== expectedDshVersion) {
    throw new Error(`候选 runtime manifest 不匹配: ${JSON.stringify(generation)}`);
  }
  const fingerprintFiles = [
    "Contents/Info.plist",
    "Contents/MacOS/Hermit",
    "Contents/Resources/app.asar",
    "Contents/Resources/runtime/generations/bundled/generation.json",
    "Contents/Resources/runtime/generations/bundled/node/hermit-runtime.json",
    "Contents/Resources/runtime/generations/bundled/dsh/hermit-runtime.json",
  ];
  const fingerprint = createHash("sha256");
  for (const relative of fingerprintFiles) {
    const file = path.join(appPath, relative);
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`候选 identity 文件必须是普通文件: ${relative}`);
    }
    fingerprint.update(relative).update("\0").update(fs.readFileSync(file)).update("\0");
  }
  return {
    appPath,
    executablePath: executable,
    bundleId,
    version,
    architecture: "arm64",
    fingerprintSha256: fingerprint.digest("hex"),
    runtime: {
      generationId: generation.generationId,
      nodeVersion: generation.nodeVersion,
      dshVersion: generation.dshVersion,
    },
  };
}

function assertSameCandidate(source, installed) {
  for (const key of ["bundleId", "version", "architecture", "fingerprintSha256"]) {
    if (source[key] !== installed[key]) {
      throw new Error(`安装候选与 mac-smoke 源不一致: ${key}`);
    }
  }
  if (JSON.stringify(source.runtime) !== JSON.stringify(installed.runtime)) {
    throw new Error("安装候选 runtime manifest 与 mac-smoke 源不一致");
  }
}

function assertPendingCandidate(pending, installed) {
  if (
    pending.schemaVersion !== 1 ||
    pending.candidate?.fingerprintSha256 !== installed.fingerprintSha256 ||
    pending.candidate?.bundleId !== installed.bundleId ||
    pending.candidate?.version !== installed.version
  ) {
    throw new Error("pending 登录资格不属于当前安装候选；禁止覆盖原事务");
  }
}

function assertInstalledProcess(inspected, identity) {
  if (!inspected.packaged || inspected.version !== identity.version) {
    throw new Error("运行中的 Hermit 不是预期 packaged candidate");
  }
  if (fs.realpathSync(inspected.executablePath) !== fs.realpathSync(installedExecutable)) {
    throw new Error(`Hermit 没有从稳定安装路径运行: ${inspected.executablePath}`);
  }
}

function assertSupportedOriginalLoginState(state) {
  const supported =
    (!state.openAtLogin && state.status === "not-registered") ||
    (!state.openAtLogin && state.status === "not-found") ||
    (state.openAtLogin && state.status === "enabled");
  if (!supported) {
    throw new Error(`登录项原始状态不适合自动事务: ${JSON.stringify(state)}`);
  }
}

function loginBaselineInterpretation(state) {
  if (!state.openAtLogin && state.status === "not-found") return "observed-not-found";
  if (!state.openAtLogin && state.status === "not-registered") return "canonical-disabled";
  return "preexisting-enabled";
}

function assertNormalReadyObservation(observation, identity) {
  if (
    observation.schemaVersion !== 1 ||
    observation.stage !== "dsh-ready" ||
    observation.launchReason !== "normal" ||
    observation.loginItem?.wasOpenedAtLogin !== false ||
    observation.application?.version !== identity.version ||
    fs.realpathSync(observation.application.executablePath) !== fs.realpathSync(installedExecutable)
  ) {
    throw new Error(`稳定安装候选没有形成正常启动观察: ${JSON.stringify(observation)}`);
  }
}

function validateLoginObservation(observation, pending) {
  const failures = [];
  if (observation.schemaVersion !== 1) failures.push("schemaVersion != 1");
  if (observation.stage !== "dsh-ready") failures.push("stage != dsh-ready");
  if (observation.launchReason !== "login-item") failures.push("launchReason != login-item");
  if (observation.loginItem?.wasOpenedAtLogin !== true) failures.push("wasOpenedAtLogin != true");
  if (observation.loginItem?.openAtLogin !== true) failures.push("openAtLogin != true");
  if (observation.loginItem?.status !== "enabled") failures.push("login item status != enabled");
  if (observation.application?.packaged !== true) failures.push("application.packaged != true");
  if (observation.application?.architecture !== "arm64") failures.push("architecture != arm64");
  if (observation.application?.version !== pending.candidate.version) failures.push("version mismatch");
  if (
    typeof observation.application?.executablePath !== "string" ||
    !sameRealPath(observation.application.executablePath, installedExecutable)
  ) failures.push("executablePath mismatch");
  if (
    !Number.isFinite(Date.parse(observation.startedAt)) ||
    Date.parse(observation.startedAt) <= Date.parse(pending.armedAt)
  ) failures.push("startup event is not newer than armedAt");
  if (observation.launchId === pending.preLoginObservation?.launchId) {
    failures.push("launchId did not change across login boundary");
  }
  return failures;
}

function loginStateMatches(actual, original) {
  if (actual.openAtLogin !== original.openAtLogin) return false;
  return original.openAtLogin
    ? actual.status === "enabled"
    : isCanonicalDisabledLoginItem(actual);
}

function isCanonicalDisabledLoginItem(state) {
  return !state.openAtLogin && state.status === "not-registered";
}

function recordRegistrationNotEstablished(
  baseline,
  registrationProbe,
  cleanupLoginItem,
  cleanupPassed,
) {
  const failure = `registration probe ended at ${registrationProbe.status}`;
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    qualificationId: baseline.qualificationId,
    scope: "local-machine-only",
    artifactRole: "unsigned-local-qualification",
    status: "NOT_ESTABLISHED",
    reason: "login-item-registration-not-established",
    candidate: baseline.candidate,
    preLogin: {
      originalLoginItem: baseline.originalLoginItem,
      baselineInterpretation: baseline.baselineInterpretation,
      registrationProbe,
    },
    postLogin: {
      evidenceArtifact: null,
      observation: null,
      failures: [failure],
    },
    cleanup: {
      status: cleanupPassed ? "PASS" : "UNCONFIRMED",
      restoredLoginItem: cleanupLoginItem,
    },
  };
  writeJsonAtomic(finalArtifact, result);
  if (cleanupPassed) {
    fs.rmSync(pendingArtifact, { force: true });
  } else {
    writeJsonAtomic(pendingArtifact, {
      ...baseline,
      phase: "cleanup-unconfirmed",
      registrationProbe,
      cleanupLoginItem,
    });
  }
  updateDesktopArtifact(false, result);
}

function sameRealPath(left, right) {
  try {
    return fs.realpathSync(left) === fs.realpathSync(right);
  } catch {
    return false;
  }
}

function readLatestStartupObservation() {
  const pending = readJsonIfExists(pendingArtifact);
  const defaultUserData = path.join(os.homedir(), "Library", "Application Support", "Hermit");
  return readJsonIfExists(path.join(
    pending?.userDataPath ?? defaultUserData,
    "desktop",
    "startup-observation.json",
  ));
}

function readStartupObservation(userDataPath) {
  const file = path.join(userDataPath, "desktop", "startup-observation.json");
  const observation = readJsonIfExists(file);
  if (observation === undefined) throw new Error(`缺少桌面启动观察: ${file}`);
  return observation;
}

function updateDesktopArtifact(passed, loginResult) {
  const artifact = readJsonIfExists(desktopArtifact);
  if (artifact === undefined) throw new Error(`缺少 M1 desktop artifact: ${desktopArtifact}`);
  writeJsonAtomic(desktopArtifact, {
    ...artifact,
    generatedAt: new Date().toISOString(),
    status: {
      ...artifact.status,
      localQualification: passed ? "PASS" : "NOT_ESTABLISHED",
    },
    observed: {
      ...artifact.observed,
      realLoginCycle: {
        status: loginResult.status,
        qualificationId: loginResult.qualificationId,
        evidenceArtifact: path.basename(finalArtifact),
      },
    },
    pendingEvidence: {
      ...artifact.pendingEvidence,
      localQualification: passed ? [] : ["real-login-cycle"],
    },
  });
}

function readJsonIfExists(file) {
  try {
    return readJson(file);
  } catch (cause) {
    if (cause?.code === "ENOENT") return undefined;
    throw cause;
  }
}

function readJson(file) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) {
    throw new Error(`JSON artifact 必须是 1 MiB 内普通文件: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, undefined, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
