import assert from "node:assert/strict";
import test from "node:test";
import { ShutdownCoordinator } from "../lib/desktop/shutdown-coordinator.js";

test("所有退出来源共享一次 stop，且 stop 完成后才允许 app.quit", async () => {
  const order = [];
  let releaseStop;
  const stop = new Promise((resolve) => { releaseStop = resolve; });
  const coordinator = new ShutdownCoordinator({
    prepare: () => order.push("prepare"),
    stopRuntime: () => {
      order.push("stop-started");
      return stop.then(() => { order.push("stop-completed"); });
    },
    allowQuit: () => order.push("allow-quit"),
    quit: () => order.push("quit"),
    evidence: { record: (event) => order.push(event) },
    timeoutMs: 1_000,
    reportProblem: (message) => assert.fail(message),
  });

  const first = coordinator.request("app-quit");
  const second = coordinator.request("system-shutdown");
  assert.equal(first, second);
  assert.equal(coordinator.started, true);
  assert.equal(order.includes("quit"), false);

  releaseStop();
  await first;
  assert.deepEqual(order, [
    "lifecycle.shutdown-requested",
    "prepare",
    "lifecycle.dsh-stop-started",
    "stop-started",
    "lifecycle.shutdown-duplicate",
    "stop-completed",
    "lifecycle.dsh-stop-completed",
    "allow-quit",
    "lifecycle.app-quit-requested",
    "quit",
  ]);
});

test("stop 失败仍明确记录并退出，carrier 可继续按 EOF 回收", async () => {
  const events = [];
  const problems = [];
  const coordinator = new ShutdownCoordinator({
    prepare: () => undefined,
    stopRuntime: () => Promise.reject(new Error("stop failed")),
    allowQuit: () => events.push("allow"),
    quit: () => events.push("quit"),
    evidence: { record: (event, details) => events.push({ event, details }) },
    reportProblem: (message) => problems.push(message),
  });

  await coordinator.request("windows-session-end");
  assert.match(problems[0], /stop failed/u);
  assert.equal(events.some((entry) => entry.event === "lifecycle.dsh-stop-failed"), true);
  assert.deepEqual(events.slice(-2), [
    { event: "lifecycle.app-quit-requested", details: undefined },
    "quit",
  ]);
});

test("stop 超时是有界且可观察的退出策略", async () => {
  const events = [];
  const coordinator = new ShutdownCoordinator({
    prepare: () => undefined,
    stopRuntime: () => new Promise(() => undefined),
    allowQuit: () => events.push("allow"),
    quit: () => events.push("quit"),
    evidence: { record: (event, details) => events.push({ event, details }) },
    timeoutMs: 10,
    reportProblem: (message) => events.push(message),
  });

  await coordinator.request("system-shutdown");
  assert.equal(events.some((entry) => entry.event === "lifecycle.dsh-stop-timed-out"), true);
  assert.equal(events.at(-1), "quit");
});
