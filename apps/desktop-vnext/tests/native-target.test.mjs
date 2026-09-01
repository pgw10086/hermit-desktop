import assert from "node:assert/strict";
import test from "node:test";
import { assertNativeTarget } from "../scripts/assert-native-target.mjs";

test("桌面 release 只接受与构建机一致的平台和架构", () => {
  assert.deepEqual(
    assertNativeTarget({
      hostPlatform: "darwin",
      hostArchitecture: "arm64",
      targetPlatform: "darwin",
      targetArchitecture: "arm64",
    }),
    { platform: "darwin", architecture: "arm64" },
  );
  assert.throws(
    () =>
      assertNativeTarget({
        hostPlatform: "darwin",
        hostArchitecture: "arm64",
        targetPlatform: "win32",
        targetArchitecture: "x64",
      }),
    /native-only/u,
  );
});
