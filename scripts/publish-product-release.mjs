#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = path.resolve(path.dirname(scriptPath), "..");

/**
 * Product Release 的 Draft/回验/发布生命周期。构建 job 不调用此脚本；只有 publisher job
 * 可以写 Release，且任何同名不同 SHA 的远端资产都会硬失败。
 */
export function stageProductRelease({
  repository = process.env.GITHUB_REPOSITORY,
  tag = process.env.GITHUB_REF_NAME,
  assetDirectory,
  gh = runGh,
} = {}) {
  const assets = listAssets(assetDirectory);
  const existing = readRelease(gh, repository, tag);
  if (existing === null) {
    gh([
      "release",
      "create",
      tag,
      "--repo",
      repository,
      "--draft",
      "--verify-tag",
      "--title",
      "Hermit " + tag,
      "--notes",
      "Hermit Desktop " + tag + "：macOS arm64 和 Windows x64 安装包，详情见 release-manifest.json。",
    ]);
    gh(["release", "upload", tag].concat(assets, ["--repo", repository]));
    verifyRemoteAssets(gh, repository, tag, assets);
    return { action: "staged", tag, assets: assetNames(assets) };
  }
  const missing = verifyExistingOrListMissing(gh, repository, tag, existing, assets);
  if (missing.length > 0) {
    if (!existing.isDraft) throw new Error("Published Product Release is missing asset: " + assetNames(missing).join(", "));
    gh(["release", "upload", tag].concat(missing, ["--repo", repository]));
  }
  verifyRemoteAssets(gh, repository, tag, assets);
  return { action: existing.isDraft ? "restaged" : "already-published", tag, assets: assetNames(assets) };
}

/** 从 GitHub 下载并逐个校验 Draft/Release 资产，确认远端字节等于聚合结果。 */
export function verifyProductRelease({
  repository = process.env.GITHUB_REPOSITORY,
  tag = process.env.GITHUB_REF_NAME,
  assetDirectory,
  gh = runGh,
} = {}) {
  const assets = listAssets(assetDirectory);
  const existing = readRelease(gh, repository, tag);
  if (existing === null) throw new Error("Product Release does not exist: " + tag);
  const missing = verifyExistingOrListMissing(gh, repository, tag, existing, assets);
  if (missing.length > 0) throw new Error("Product Release is missing assets: " + assetNames(missing).join(", "));
  const remoteNames = existing.assets.map((asset) => asset.name).sort();
  const expectedNames = assetNames(assets).sort();
  if (JSON.stringify(remoteNames) !== JSON.stringify(expectedNames)) {
    throw new Error("Product Release asset set mismatch: expected " + expectedNames.join(", ") + ", got " + remoteNames.join(", "));
  }
  verifyRemoteAssets(gh, repository, tag, assets);
  return { action: "verified", isDraft: Boolean(existing.isDraft), tag, assets: expectedNames };
}

/** 在回验通过后把 Draft 发布；已发布且摘要一致时幂等返回，不修改任何 asset。 */
export function publishProductRelease(options = {}) {
  const gh = options.gh ?? runGh;
  const staged = stageProductRelease(options);
  const verified = verifyProductRelease(options);
  if (verified.isDraft) {
    gh(["release", "edit", verified.tag, "--repo", options.repository, "--draft=false", "--latest"]);
    const afterPublish = verifyProductRelease({ ...options, gh });
    if (afterPublish.isDraft) throw new Error("Product Release remained draft after publish: " + verified.tag);
    return { ...staged, action: "published", tag: verified.tag, assets: afterPublish.assets };
  }
  return { ...staged, action: "already-published", tag: verified.tag, assets: verified.assets };
}

function listAssets(directory) {
  if (typeof directory !== "string" || directory.length === 0) throw new Error("assetDirectory is required");
  const assets = fs.readdirSync(directory)
    .filter((name) => !name.startsWith("."))
    .map((name) => path.join(directory, name))
    .filter((file) => fs.statSync(file).isFile())
    .sort();
  if (assets.length === 0) throw new Error("No Product Release assets found: " + directory);
  return assets;
}

function assetNames(files) {
  return files.map((file) => path.basename(file));
}

function verifyExistingOrListMissing(gh, repository, tag, existing, assets) {
  const missing = [];
  for (const asset of assets) {
    const name = path.basename(asset);
    if (existing.assets.some((candidate) => candidate.name === name)) verifyRemoteAsset(gh, repository, tag, asset);
    else missing.push(asset);
  }
  return missing;
}

function readRelease(gh, repository, tag) {
  if (typeof repository !== "string" || repository.length === 0) throw new Error("GITHUB_REPOSITORY is required");
  if (typeof tag !== "string" || !/^v[0-9]+\.[0-9]+\.[0-9]+(?:[-.][0-9A-Za-z.-]+)?$/u.test(tag)) {
    throw new Error("A valid Product Release tag is required; received " + String(tag));
  }
  try {
    return JSON.parse(gh(["release", "view", tag, "--repo", repository, "--json", "isDraft,assets"]));
  } catch (error) {
    const detail = error instanceof Error && "stderr" in error ? String(error.stderr) : "";
    const message = (error instanceof Error ? error.message : String(error)) + " " + detail;
    if (/release not found|HTTP 404|not found/iu.test(message)) return null;
    throw error;
  }
}

function verifyRemoteAssets(gh, repository, tag, assets) {
  for (const asset of assets) verifyRemoteAsset(gh, repository, tag, asset);
}

function verifyRemoteAsset(gh, repository, tag, localFile) {
  const name = path.basename(localFile);
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-release-"));
  try {
    gh(["release", "download", tag, "--repo", repository, "--pattern", name, "--dir", temporaryDirectory]);
    const remoteFile = path.join(temporaryDirectory, name);
    if (!fs.existsSync(remoteFile)) throw new Error("Downloaded Product Release asset is missing: " + name);
    const localSha = sha256File(localFile);
    const remoteSha = sha256File(remoteFile);
    if (localSha !== remoteSha) {
      throw new Error("Product Release asset SHA mismatch for " + name + ": local=" + localSha + ", remote=" + remoteSha);
    }
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function runGh(args) {
  try {
    return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    const detail = error instanceof Error && "stderr" in error ? String(error.stderr).trim() : "";
    throw new Error("GitHub CLI command failed: gh " + args.join(" ") + (detail === "" ? "" : ": " + detail), { cause: error });
  }
}

function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const mode = process.argv[2] ?? "stage";
    const options = {
      repository: process.env.GITHUB_REPOSITORY,
      tag: process.env.GITHUB_REF_NAME,
      assetDirectory: path.resolve(optionValue("--assets") ?? process.argv[3] ?? path.join(defaultRepositoryRoot, "release-assets")),
    };
    const result = mode === "stage"
      ? stageProductRelease(options)
      : mode === "verify"
        ? verifyProductRelease(options)
        : mode === "publish"
          ? publishProductRelease(options)
          : (() => { throw new Error("Usage: publish-product-release.mjs <stage|verify|publish> [asset-directory]"); })();
    console.log("Product Release action: " + result.action + " " + result.tag);
  } catch (cause) {
    console.error("[product-publisher] " + (cause instanceof Error ? cause.message : String(cause)));
    process.exitCode = 1;
  }
}
