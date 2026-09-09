import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repositoryRoot, "scripts", "platform-lock.mjs");

test("正式准备只消费 platform-lock 中已校验的制品", () => {
  const result = run(["prepare", "--mode", "release"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Platform inputs prepared for release: 5 module\(s\)\./u);
});

test("正式准备把 Core 和 Runtime Adapter 物化为可搬运的 App 依赖", () => {
  const result = run(["prepare", "--mode", "release"]);
  assert.equal(result.status, 0, result.stderr);
  const nodeModules = path.join(repositoryRoot, ".hermit", "runtime", "app-dependencies", "node_modules");
  for (const packageName of ["@platform/agent-desktop-core", "@platform/dsh-runtime-adapter"]) {
    const expected = readFixture().modules.find((module) => module.packageName === packageName)
    assert.ok(expected, `platform-lock 缺少 ${packageName}`)
    const packageRoot = path.join(nodeModules, ...packageName.split("/"));
    const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
    assert.equal(manifest.name, packageName);
    assert.equal(manifest.version, expected.version);
    assert.equal(fs.lstatSync(packageRoot).isSymbolicLink(), false);
  }
});

test("正式模式拒绝 build-on-miss", () => {
  const result = run(["resolve", "--mode", "release", "--build-on-miss"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--build-on-miss is only available in dev mode/u);
});

test("正式模式遇到缺失制品直接失败", () => {
  const fixture = readFixture();
  const module = fixture.modules[0];
  module.artifact.path = `.hermit/missing-artifact/${module.id}/${module.artifact.sha256}.tgz`;
  withFixture(fixture, (fixturePath) => {
    const result = run(["resolve", "--mode", "release", "--module", module.id, "--lock", fixturePath]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Artifact missing/u);
  });
});

test("正式准备不要求 sibling 源码和生产仓 lockfile 存在", () => {
  const original = readFixture();
  for (const module of original.modules) {
    module.repoPath = `.hermit/missing-source/${module.id}`;
    module.lockfile = `.hermit/missing-source/${module.id}/pnpm-lock.yaml`;
  }
  withFixture(original, (fixturePath) => {
    const result = run(["prepare", "--mode", "release", "--lock", fixturePath]);
    assert.equal(result.status, 0, result.stderr);
  });
});

function readFixture() {
  return JSON.parse(fs.readFileSync(path.join(repositoryRoot, "platform-lock.json"), "utf8"));
}

function withFixture(value, action) {
  const fixtureDirectory = path.join(repositoryRoot, ".hermit", "artifacts", "platform-lock-tests");
  fs.mkdirSync(fixtureDirectory, { recursive: true });
  const caseDirectory = fs.mkdtempSync(path.join(fixtureDirectory, "case-"));
  const fixture = path.join(caseDirectory, "platform-lock.json");
  fs.writeFileSync(fixture, `${JSON.stringify(value, null, 2)}\n`);
  try {
    action(fixture);
  } finally {
    fs.rmSync(caseDirectory, { recursive: true, force: true });
  }
}

function run(args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}
