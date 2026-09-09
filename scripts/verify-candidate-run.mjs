#!/usr/bin/env node

import fs from "node:fs";

/**
 * 验证正式 tag 对应的 Product Desktop commit 已完成双平台 candidate。
 * GitHub workflow 只传入 API 返回的运行摘要；具体平台 job 是否齐全由 candidate workflow 自己汇总。
 */
export function assertSuccessfulCandidateRun(runs, commit) {
  if (!Array.isArray(runs)) throw new Error("Candidate run list must be an array");
  if (typeof commit !== "string" || commit.length === 0) throw new Error("Candidate commit is required");
  const successful = runs.find((run) => (
    run !== null && typeof run === "object" &&
    run.headSha === commit &&
    run.status === "completed" &&
    run.conclusion === "success"
  ));
  if (successful === undefined) {
    throw new Error(`No successful desktop candidate run found for commit ${commit}`);
  }
  return successful;
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("verify-candidate-run.mjs")) {
  try {
    const file = process.argv[2];
    const commit = process.argv[3] ?? process.env.GITHUB_SHA;
    if (file === undefined || commit === undefined) throw new Error("Usage: verify-candidate-run.mjs <runs.json> <commit>");
    const runs = JSON.parse(fs.readFileSync(file, "utf8"));
    const successful = assertSuccessfulCandidateRun(runs, commit);
    console.log(`Candidate run verified: ${String(successful.databaseId ?? successful.id ?? "unknown")} -> ${commit}`);
  } catch (cause) {
    console.error(`[candidate-run] ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 1;
  }
}
