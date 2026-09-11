import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DshSupervisor } from "@tianbuyv/dsh-runtime-adapter";

const fixture = path.resolve("tests/fixtures/fake-dsh.mjs");
const carrier = path.resolve("lib/runtime/dsh-carrier.js");

/** Hermit carrier 只传播存活信号，崩溃重启策略仍由共享 Core 负责。 */
test("carrier 不接管重启策略，DSH crash 仍由 supervisor 恢复", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-carrier-restart-"));
  const stateFile = path.join(temp, "launches.txt");
  const supervisor = new DshSupervisor({
    command: {
      executable: process.execPath,
      args: [carrier, fixture, "crash-first", stateFile],
      cwd: process.cwd(),
      env: process.env,
      stopViaStdin: true,
    },
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
