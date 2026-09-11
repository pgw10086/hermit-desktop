import assert from "node:assert/strict";
import test from "node:test";
import { ActivationLease } from "@tianbuyv/agent-desktop-core";

test("ActivationLease 先使 generation 失效，再按逆序且仅一次回收资源", async () => {
  const events = [];
  const lease = new ActivationLease("generation-1");
  lease.own(() => events.push(`first:${String(lease.active)}`));
  lease.own(async () => events.push(`second:${String(lease.active)}`));

  const firstDispose = lease.dispose();
  const secondDispose = lease.dispose();
  assert.equal(firstDispose, secondDispose);
  await firstDispose;

  assert.equal(lease.active, false);
  assert.deepEqual(events, ["second:false", "first:false"]);
});

test("旧 generation 的 callback 与晚到 Promise completion 都不会产生副作用", async () => {
  const applied = [];
  const lease = new ActivationLease("generation-1");
  const callback = lease.guard((value) => applied.push(`callback:${value}`));
  let complete;
  const operation = new Promise((resolve) => { complete = resolve; });
  const completion = lease.applyCompletion(operation, (value) => {
    applied.push(`completion:${value}`);
  });

  callback("before");
  await lease.dispose();
  callback("after");
  complete("late");

  assert.equal(await completion, "stale");
  assert.deepEqual(applied, ["callback:before"]);
});

test("某个资源回收失败不阻止其余资源回收", async () => {
  const events = [];
  const lease = new ActivationLease("generation-1");
  lease.own(() => events.push("first"));
  lease.own(() => { throw new Error("second failed"); });
  lease.own(() => events.push("third"));

  await assert.rejects(lease.dispose(), AggregateError);
  assert.deepEqual(events, ["third", "first"]);
});
