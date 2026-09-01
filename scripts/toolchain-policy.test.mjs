import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyNodeVersion,
  classifyPnpmVersion,
  evaluateEnvironment,
} from "./toolchain-policy.mjs";

test("版本状态区分观察可运行、候选、项目已验证和实验线", () => {
  assert.deepEqual(classifyNodeVersion("v24.19.0"), {
    status: "project-verified",
    projectEligible: true,
  });
  assert.equal(classifyNodeVersion("22.13.1").status, "candidate");
  assert.equal(classifyNodeVersion("25.6.1").status, "observed-only-eol");
  assert.equal(classifyNodeVersion("26.1.0").status, "experimental");
  assert.equal(classifyPnpmVersion("10.32.1").status, "diagnostics-only");
  assert.equal(classifyPnpmVersion("11.7.0").projectEligible, true);
  assert.equal(classifyPnpmVersion("12.0.0").status, "experimental");
});

test("资格门禁同时要求已验证工具链和原生目标", () => {
  assert.equal(
    evaluateEnvironment({
      nodeVersion: "24.19.0",
      pnpmVersion: "11.7.0",
      hostPlatform: "darwin",
      hostArchitecture: "arm64",
      targetPlatform: "darwin",
      targetArchitecture: "arm64",
    }).qualificationEligible,
    true,
  );
  assert.equal(
    evaluateEnvironment({
      nodeVersion: "24.19.0",
      pnpmVersion: "11.7.0",
      hostPlatform: "darwin",
      hostArchitecture: "arm64",
      targetPlatform: "win32",
      targetArchitecture: "x64",
    }).qualificationEligible,
    false,
  );
});
