import assert from "node:assert/strict";
import test from "node:test";
import {
  extractDshWebUrl,
  validateDshWebUrl,
  waitForHttpReady,
} from "../lib/runtime/dsh-readiness.js";

test("只接受 DSH 报告的 127.0.0.1 随机端口", () => {
  assert.equal(
    extractDshWebUrl("booting\ndsh web: http://127.0.0.1:58961\n")?.href,
    "http://127.0.0.1:58961/",
  );
  assert.throws(() => validateDshWebUrl("http://0.0.0.0:58961"), /invalid loopback/u);
  assert.throws(() => validateDshWebUrl("http://localhost:58961"), /invalid loopback/u);
  assert.throws(() => validateDshWebUrl("https://127.0.0.1:58961"), /invalid loopback/u);
});

test("DSH URL 还不能访问时继续探测，成功后才进入 ready", async () => {
  let attempts = 0;
  await waitForHttpReady(new URL("http://127.0.0.1:58961"), {
    timeoutMs: 1_000,
    intervalMs: 1,
    fetcher: async () => {
      attempts += 1;
      return new Response("", { status: attempts < 3 ? 503 : 200 });
    },
  });
  assert.equal(attempts, 3);
});

test("HTTP 4xx 不是可交互的 DSH ready 状态", async () => {
  let attempts = 0;
  await waitForHttpReady(new URL("http://127.0.0.1:58961"), {
    timeoutMs: 1_000,
    intervalMs: 1,
    fetcher: async () => {
      attempts += 1;
      return new Response("", { status: attempts < 3 ? 404 : 302 });
    },
  });
  assert.equal(attempts, 3);
});
