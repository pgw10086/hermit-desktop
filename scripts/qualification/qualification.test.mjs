import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { inspectClientModuleHostContract } from "./inspect-client-module-host.mjs";
import { inspectProductSurfaceContract } from "./inspect-product-surface.mjs";
import { qualificationExitCode } from "./qualification-status.mjs";
import { verifyPublicContracts } from "./verify-public-contracts.mjs";

test("DSH 资格认证依赖只使用已确认的公开入口", async () => {
  const result = await verifyPublicContracts();
  assert.equal(result.target, "0.1.1-rc.2");
  assert.equal(result.lockfile.dshPackageCount, 189);
  assert.deepEqual(result.lockfile.reactVersions, ["18.3.1"]);
  assert.deepEqual(result.lockfile.reactDomVersions, ["18.3.1"]);
  assert.ok(result.runtimeExports.length >= 9);
  assert.equal(result.typecheckedExports.length, 3);
});

test("Q-CMOD-01 对 rc.2 返回明确阻塞而不是 fallback", async () => {
  const result = await inspectClientModuleHostContract();
  assert.equal(result.gate, "Q-CMOD-01");
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.facts.registryInject, ["webServer", "loader"]);
  assert.equal(result.facts.stockWebServerListens, true);
});

test("Q-PRODUCT-SURFACE-01 明确拒绝用设置、浮层或会话页冒充全局业务页面", async () => {
  const result = await inspectProductSurfaceContract();
  assert.equal(result.gate, "Q-PRODUCT-SURFACE-01");
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.facts.productSurfaceCandidates, []);
  assert.deepEqual(
    result.facts.rootAdditive.map(({ name }) => name),
    [
      "settings.action",
      "settings.general.item",
      "settings.onboarding",
      "settings.plugins.tab",
      "settings.section",
      "shell.overlay",
      "sidebar.footer.action",
    ],
  );
  assert.equal(result.facts.rejectedSubstitutes.includes("private-router-or-dom-injection"), true);
});

test("资格认证状态只允许明确的非零退出码", () => {
  assert.equal(qualificationExitCode("blocked"), 2);
  assert.equal(qualificationExitCode("review-required"), 3);
  assert.throws(() => qualificationExitCode("qualified"), /未实现可执行验证/u);
  assert.throws(() => qualificationExitCode("unknown"), /未实现可执行验证/u);
});

test("当前 Q-CMOD-01 CLI 以退出码 2 fail closed", () => {
  const script = fileURLToPath(new URL("./verify-client-module-host.mjs", import.meta.url));
  const child = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(child.status, 2, child.stderr);
  assert.equal(JSON.parse(child.stdout).status, "blocked");
});

test("当前 Product Surface CLI 以退出码 2 fail closed", () => {
  const script = fileURLToPath(new URL("./verify-product-surface.mjs", import.meta.url));
  const child = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(child.status, 2, child.stderr);
  assert.equal(JSON.parse(child.stdout).status, "blocked");
});
