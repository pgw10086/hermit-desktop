import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DshSupervisor } from "../lib/runtime/dsh-supervisor.js";

const fixture = path.resolve("tests/fixtures/fake-dsh.mjs");
const carrier = path.resolve("lib/runtime/dsh-carrier.js");

function command(mode, stateFile) {
  return {
    executable: process.execPath,
    args: [fixture, mode, ...(stateFile === undefined ? [] : [stateFile])],
    cwd: process.cwd(),
    env: process.env,
  };
}

function carrierCommand(mode, stateFile) {
  return {
    executable: process.execPath,
    args: [carrier, fixture, mode, ...(stateFile === undefined ? [] : [stateFile])],
    cwd: process.cwd(),
    env: process.env,
    stopViaStdin: true,
  };
}

test("启动真实子进程、等待 HTTP ready，并在 stop 后退出", async () => {
  const supervisor = new DshSupervisor({
    command: command("healthy"),
    readyTimeoutMs: 3_000,
    shutdownTimeoutMs: 1_000,
    maxRestarts: 0,
  });

  const url = await supervisor.start();
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(supervisor.state, "ready");
  assert.equal(await supervisor.start(), url);

  await supervisor.stop();
  assert.equal(supervisor.state, "stopped");
});

test("连续崩溃超过上限后进入 unavailable，并保留失败原因", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-dsh-supervisor-unavailable-"));
  const stateFile = path.join(temp, "launches.txt");
  const supervisor = new DshSupervisor({
    command: command("crash-always", stateFile),
    readyTimeoutMs: 3_000,
    shutdownTimeoutMs: 1_000,
    restartDelayMs: 10,
    maxRestarts: 1,
  });

  try {
    await supervisor.start();
    const unavailable = await new Promise((resolve) => {
      supervisor.once("unavailable", resolve);
    });
    assert.equal(supervisor.state, "unavailable");
    assert.match(unavailable.cause.message, /DSH crashed too many times/u);
    assert.equal(Number(fs.readFileSync(stateFile, "utf8")), 2);
  } finally {
    await supervisor.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("DSH 意外退出后使用新端口恢复，且不会超过重启策略", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-dsh-supervisor-"));
  const stateFile = path.join(temp, "launches.txt");
  const supervisor = new DshSupervisor({
    command: command("crash-first", stateFile),
    readyTimeoutMs: 3_000,
    shutdownTimeoutMs: 1_000,
    restartDelayMs: 10,
    maxRestarts: 2,
  });

  const urls = [];
  const recovered = new Promise((resolve) => {
    supervisor.on("ready", ({ url }) => {
      urls.push(url.href);
      if (urls.length === 2) resolve(undefined);
    });
  });

  try {
    await supervisor.start();
    await recovered;
    assert.equal(supervisor.state, "ready");
    assert.equal(urls.length, 2);
    assert.notEqual(urls[0], urls[1]);
  } finally {
    await supervisor.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("carrier 不接管重启策略，DSH crash 仍由 supervisor 恢复", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-carrier-restart-"));
  const stateFile = path.join(temp, "launches.txt");
  const supervisor = new DshSupervisor({
    command: carrierCommand("crash-first", stateFile),
    readyTimeoutMs: 3_000,
    shutdownTimeoutMs: 1_000,
    restartDelayMs: 10,
    maxRestarts: 2,
  });
  const readyUrls = [];
  const recovered = new Promise((resolve) => {
    supervisor.on("ready", ({ url }) => {
      readyUrls.push(url.href);
      if (readyUrls.length === 2) resolve(undefined);
    });
  });

  try {
    await supervisor.start();
    await recovered;
    assert.equal(supervisor.state, "ready");
    assert.equal(Number(fs.readFileSync(stateFile, "utf8")), 2);
  } finally {
    await supervisor.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("DSH 报告非 loopback URL 时拒绝启动，不做 host fallback", async () => {
  const supervisor = new DshSupervisor({
    command: command("invalid-url"),
    readyTimeoutMs: 1_000,
    shutdownTimeoutMs: 1_000,
    maxRestarts: 0,
  });
  await assert.rejects(supervisor.start(), /invalid loopback/u);
  assert.equal(supervisor.state, "unavailable");
  await supervisor.stop();
});

test("POSIX stop 等整组进程退出，不把根进程退出误判为整棵树已清理", {
  skip: process.platform === "win32" ? "POSIX process group contract" : false,
}, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-dsh-tree-"));
  const pidFile = path.join(temp, "descendant.pid");
  const supervisor = new DshSupervisor({
    command: command("process-tree", pidFile),
    readyTimeoutMs: 3_000,
    shutdownTimeoutMs: 200,
    maxRestarts: 0,
  });

  let descendantPid;
  try {
    await supervisor.start();
    descendantPid = Number(fs.readFileSync(pidFile, "utf8"));
    process.kill(descendantPid, 0);
    await supervisor.stop();
    assert.throws(() => process.kill(descendantPid, 0), { code: "ESRCH" });
  } finally {
    if (descendantPid !== undefined) {
      try {
        process.kill(descendantPid, "SIGKILL");
      } catch (cause) {
        if (cause?.code !== "ESRCH") throw cause;
      }
    }
    await supervisor.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("POSIX 整树终止失败后保留受管引用，第二次 stop 可以继续回收", {
  skip: process.platform === "win32" ? "POSIX process group contract" : false,
}, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-dsh-tree-retry-"));
  const pidFile = path.join(temp, "descendant.pid");
  let attempts = 0;
  const supervisor = new DshSupervisor({
    command: command("process-tree", pidFile),
    readyTimeoutMs: 3_000,
    shutdownTimeoutMs: 100,
    maxRestarts: 0,
    terminateTree: async (child) => {
      attempts += 1;
      if (attempts === 1) throw new Error("injected tree termination failure");
      process.kill(-child.pid, "SIGKILL");
    },
  });

  let descendantPid;
  try {
    await supervisor.start();
    descendantPid = Number(fs.readFileSync(pidFile, "utf8"));
    await assert.rejects(supervisor.stop(), /injected tree termination failure/u);
    await supervisor.stop();
    assert.equal(attempts, 2);
    assert.throws(() => process.kill(descendantPid, 0), { code: "ESRCH" });
  } finally {
    if (descendantPid !== undefined) {
      try {
        process.kill(descendantPid, "SIGKILL");
      } catch (cause) {
        if (cause?.code !== "ESRCH") throw cause;
      }
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
