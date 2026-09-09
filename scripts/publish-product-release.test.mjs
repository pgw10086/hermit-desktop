import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  publishProductRelease,
  stageProductRelease,
  verifyProductRelease,
} from "./publish-product-release.mjs";

test("Product Release 首次创建 Draft、上传全部资产并发布", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-product-publisher-"));
  try {
    const assets = createAssets(root);
    const fake = createFakeGitHub({ absent: true });
    const result = publishProductRelease({ repository: "example/hermit", tag: "v0.2.2", assetDirectory: assets, gh: fake.gh });
    assert.equal(result.action, "published");
    assert.equal(fake.isDraft, false);
    assert.equal(fake.calls.some((args) => args.includes("--clobber")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Product Release 已发布且摘要一致时幂等，不上传覆盖", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-product-publisher-"));
  try {
    const assets = createAssets(root);
    const fake = createFakeGitHub({ absent: false, isDraft: false, remoteAssets: readAssets(assets) });
    const result = verifyProductRelease({ repository: "example/hermit", tag: "v0.2.2", assetDirectory: assets, gh: fake.gh });
    assert.equal(result.isDraft, false);
    assert.equal(fake.calls.some((args) => args[1] === "upload"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Product Release 已发布且资产摘要不同会硬失败", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-product-publisher-"));
  try {
    const assets = createAssets(root);
    const remote = readAssets(assets);
    remote.set("Hermit-0.2.2-x64.exe", Buffer.from("different"));
    const fake = createFakeGitHub({ absent: false, isDraft: false, remoteAssets: remote });
    assert.throws(
      () => stageProductRelease({ repository: "example/hermit", tag: "v0.2.2", assetDirectory: assets, gh: fake.gh }),
      /SHA mismatch/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createAssets(root) {
  const assets = path.join(root, "assets");
  fs.mkdirSync(assets);
  fs.writeFileSync(path.join(assets, "Hermit-0.2.2-arm64.dmg"), "mac");
  fs.writeFileSync(path.join(assets, "Hermit-0.2.2-x64.exe"), "win");
  fs.writeFileSync(path.join(assets, "release-manifest.json"), "manifest");
  fs.writeFileSync(path.join(assets, "SHA256SUMS"), "checksums");
  return assets;
}

function readAssets(directory) {
  return new Map(fs.readdirSync(directory).map((name) => [name, fs.readFileSync(path.join(directory, name))]));
}

function createFakeGitHub({ absent, isDraft, remoteAssets = new Map() }) {
  const calls = [];
  let currentDraft = Boolean(isDraft);
  let missingRelease = Boolean(absent);
  function gh(args) {
    calls.push(args);
    if (args[1] === "view") {
      if (missingRelease) {
        const error = new Error("release not found");
        error.stderr = "release not found";
        throw error;
      }
      return JSON.stringify({ isDraft: currentDraft, assets: [...remoteAssets.keys()].map((name) => ({ name })) });
    }
    if (args[1] === "create") {
      missingRelease = false;
      currentDraft = true;
      return "";
    }
    if (args[1] === "upload") {
      const separator = args.indexOf("--repo");
      for (const file of args.slice(3, separator)) remoteAssets.set(path.basename(file), fs.readFileSync(file));
      return "";
    }
    if (args[1] === "download") {
      const name = args[args.indexOf("--pattern") + 1];
      const directory = args[args.indexOf("--dir") + 1];
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, name), remoteAssets.get(name));
      return "";
    }
    if (args[1] === "edit") {
      if (args.includes("--draft=false")) currentDraft = false;
      return "";
    }
    throw new Error("unexpected command: " + args.join(" "));
  }
  return { gh, calls, remoteAssets, get isDraft() { return currentDraft; } };
}
