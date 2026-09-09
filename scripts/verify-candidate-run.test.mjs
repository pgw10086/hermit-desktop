import assert from "node:assert/strict";
import test from "node:test";
import { assertSuccessfulCandidateRun } from "./verify-candidate-run.mjs";

test("正式发布输入必须有同一 commit 的成功 candidate", () => {
  const run = { databaseId: 123, headSha: "abc123", status: "completed", conclusion: "success" };
  assert.deepEqual(assertSuccessfulCandidateRun([run], "abc123"), run);
});

test("candidate 未完成或 commit 不同都会拒绝正式发布", () => {
  assert.throws(
    () => assertSuccessfulCandidateRun([
      { databaseId: 1, headSha: "abc123", status: "in_progress", conclusion: null },
      { databaseId: 2, headSha: "def456", status: "completed", conclusion: "success" },
    ], "abc123"),
    /No successful desktop candidate run/u,
  );
});
