#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = path.resolve(path.dirname(scriptPath), "..");

/**
 * 校验正式发布的源码身份。正式构建只能从一个已经合入 main 的干净 tag 开始，不能用
 * 任意 workflow ref 或带有未提交修改的开发工作区生成公开版本。
 */
export function assertReleaseInput({
  repositoryRoot = defaultRepositoryRoot,
  tag,
  mainRef = "origin/main",
  git = (args) => runGit(repositoryRoot, args),
} = {}) {
  const version = readDesktopVersion(repositoryRoot);
  const expectedTag = `v${version}`;
  if (tag !== undefined && tag !== expectedTag) {
    throw new Error(`Release tag must be ${expectedTag}; received ${tag}`);
  }
  const releaseTag = tag ?? expectedTag;
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+(?:[-.][0-9A-Za-z.-]+)?$/u.test(releaseTag)) {
    throw new Error(`Invalid release tag: ${releaseTag}`);
  }

  const status = git(["status", "--porcelain", "--untracked-files=all"]);
  if (status !== "") throw new Error("Release input requires a clean Git working tree");

  const head = git(["rev-parse", "HEAD"]);
  const tagCommit = git(["rev-list", "-n", "1", releaseTag]);
  if (tagCommit !== head) {
    throw new Error(`Tag ${releaseTag} must point to current commit ${head}; received ${tagCommit}`);
  }

  const mainCommit = git(["rev-parse", mainRef]);
  if (mainCommit !== head) {
    throw new Error(`Release tag ${releaseTag} must point to ${mainRef} ${mainCommit}; received ${head}`);
  }

  return { version, tag: releaseTag, commit: head, mainRef, mainCommit };
}

function readDesktopVersion(repositoryRoot) {
  const manifestPath = path.join(repositoryRoot, "apps", "desktop-vnext", "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error(`Desktop manifest has no version: ${manifestPath}`);
  }
  return manifest.version;
}

function runGit(repositoryRoot, args) {
  try {
    return execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const detail = error instanceof Error && "stderr" in error ? String(error.stderr).trim() : "";
    throw new Error(`Git command failed: git ${args.join(" ")}${detail === "" ? "" : `: ${detail}`}`, {
      cause: error,
    });
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const result = assertReleaseInput({
      tag: process.argv[2] ?? process.env.GITHUB_REF_NAME,
      mainRef: process.env.HERMIT_RELEASE_MAIN_REF ?? "origin/main",
    });
    console.log(`Release input verified: ${result.tag} -> ${result.commit}`);
  } catch (cause) {
    console.error(`[release-input] ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 1;
  }
}
