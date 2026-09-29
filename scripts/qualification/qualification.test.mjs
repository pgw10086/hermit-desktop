import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { inspectProductSurfaceContract } from "./inspect-product-surface.mjs";
import { readActiveDshCohort } from "../dsh-upstream.mjs";
import { qualificationExitCode } from "./qualification-status.mjs";
import { verifyPublicContracts } from "./verify-public-contracts.mjs";

const activeDshVersion = readActiveDshCohort(fileURLToPath(new URL("../..", import.meta.url))).packageVersion;

test("DSH 资格认证依赖只使用已确认的公开入口", async () => {
  const result = await verifyPublicContracts();
  assert.equal(result.target, activeDshVersion);
  assert.equal(result.lockfile.dshPackageCount, 268);
  assert.deepEqual(result.lockfile.reactVersions, ["18.3.1"]);
  assert.deepEqual(result.lockfile.reactDomVersions, ["18.3.1"]);
  assert.ok(result.runtimeExports.length >= 8);
  assert.equal(result.typecheckedExports.length, 3);
});

test("Q-PRODUCT-SURFACE-01 明确拒绝用设置、浮层或会话页冒充全局业务页面", async () => {
  const result = await inspectProductSurfaceContract();
  assert.equal(result.gate, "Q-PRODUCT-SURFACE-01");
  assert.equal(result.status, "review-required");
  assert.deepEqual(result.facts.productSurfaceCandidates.map(({ name }) => name), ["sidebar.panellist"]);
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
      "sidebar.panellist",
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

test("当前 Product Surface CLI 以退出码 3 标记公开候选待复核", () => {
  const script = fileURLToPath(new URL("./verify-product-surface.mjs", import.meta.url));
  const child = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(child.status, 3, child.stderr);
  assert.equal(JSON.parse(child.stdout).status, "review-required");
});
