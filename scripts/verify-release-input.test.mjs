import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertReleaseInput } from "./verify-release-input.mjs";

test("正式发布输入必须是干净的 main 当前版本 tag", () => {
  const root = createRepository("0.2.2");
  try {
    const commit = git(root, ["rev-parse", "HEAD"]);
    git(root, ["tag", "v0.2.2"]);
    git(root, ["update-ref", "refs/remotes/origin/main", commit]);

    const result = assertReleaseInput({ repositoryRoot: root });
    assert.deepEqual(result, {
      version: "0.2.2",
      tag: "v0.2.2",
      commit,
      mainRef: "origin/main",
      mainCommit: commit,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("正式发布输入拒绝脏工作区、版本不匹配和非 main 提交", () => {
  const root = createRepository("0.2.2");
  try {
    const head = git(root, ["rev-parse", "HEAD"]);
    git(root, ["tag", "v0.2.2"]);
    git(root, ["update-ref", "refs/remotes/origin/main", head]);
    fs.writeFileSync(path.join(root, "dirty.txt"), "dirty\n");
    assert.throws(
      () => assertReleaseInput({ repositoryRoot: root }),
      /clean Git working tree/u,
    );
    fs.rmSync(path.join(root, "dirty.txt"));

    assert.throws(
      () => assertReleaseInput({ repositoryRoot: root, tag: "v0.2.3" }),
      /Release tag must be v0\.2\.2/u,
    );

    const later = path.join(root, "later.txt");
    fs.writeFileSync(later, "later\n");
    git(root, ["add", later]);
    git(root, ["commit", "-m", "later commit"]);
    assert.throws(
      () => assertReleaseInput({ repositoryRoot: root }),
      /must point to current commit/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("正式发布输入拒绝 main ref 不存在或不一致", () => {
  const root = createRepository("0.2.2");
  try {
    git(root, ["tag", "v0.2.2"]);
    assert.throws(
      () => assertReleaseInput({ repositoryRoot: root }),
      /Git command failed: git rev-parse origin\/main/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createRepository(version) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-release-input-"));
  fs.mkdirSync(path.join(root, "apps", "desktop-vnext"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "apps", "desktop-vnext", "package.json"),
    `${JSON.stringify({ version }, null, 2)}\n`,
  );
  git(root, ["init"]);
  git(root, ["config", "user.name", "Hermit Test"]);
  git(root, ["config", "user.email", "hermit@example.invalid"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "initial"]);
  return root;
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
