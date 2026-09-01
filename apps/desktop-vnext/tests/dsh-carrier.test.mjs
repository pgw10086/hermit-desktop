import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const carrier = path.resolve("lib", "runtime", "dsh-carrier.js");
const fakeDsh = path.resolve("tests", "fixtures", "fake-dsh.mjs");

test("Electron 父进程管道关闭后 carrier 回收完整 DSH 进程组", {
  skip: process.platform === "win32" ? "POSIX process group contract" : false,
  timeout: 10_000,
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-dsh-carrier-"));
  const stateFile = path.join(root, "tree.json");
  const child = spawn(
    process.execPath,
    [carrier, fakeDsh, "process-tree-stubborn", stateFile],
    {
      cwd: process.cwd(),
      env: { ...process.env, HERMIT_DSH_CARRIER_GRACE_MS: "100" },
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { output += chunk.toString("utf8"); });
  let tree;
  try {
    await waitUntil(() => /dsh web: http:\/\/127\.0\.0\.1:/u.test(output), 3_000);
    tree = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    process.kill(tree.descendantPid, 0);

    child.stdin.end();
    await once(child, "exit");
    await waitUntil(() => !groupExists(tree.rootPid), 2_000);
    assert.throws(() => process.kill(tree.descendantPid, 0), { code: "ESRCH" });
  } finally {
    if (tree !== undefined && groupExists(tree.rootPid)) {
      process.kill(-tree.rootPid, "SIGKILL");
    }
    if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
      process.kill(-child.pid, "SIGKILL");
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function groupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (cause) {
    if (cause?.code === "ESRCH") return false;
    throw cause;
  }
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition did not become true before timeout");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
