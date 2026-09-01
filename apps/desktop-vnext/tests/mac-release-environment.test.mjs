import assert from "node:assert/strict";
import test from "node:test";
import {
  assertMacReleaseReady,
  macReleaseSigningMode,
  resolveMacReleaseSigning,
  withoutMacReleaseSecrets,
} from "../scripts/mac-release-environment.mjs";

test("macOS smoke 构建不会继承签名和公证凭据", () => {
  const sanitized = withoutMacReleaseSecrets({
    PATH: "/usr/bin",
    CSC_LINK: "secret-certificate",
    CSC_KEY_PASSWORD: "secret-password",
    APPLE_API_KEY: "secret-api-key",
  });
  assert.deepEqual(sanitized, { PATH: "/usr/bin" });
});

test("macOS release 接受 Keychain Developer ID 和完整 API key 公证凭据", () => {
  assert.deepEqual(
    assertMacReleaseReady({
      platform: "darwin",
      environment: {
        APPLE_API_KEY: "key",
        APPLE_API_KEY_ID: "key-id",
        APPLE_API_ISSUER: "issuer",
      },
      listCodeSigningIdentities: () =>
        '  1) ABCDEF "Developer ID Application: Hermit Example (TEAM123456)"\n',
    }),
    {
      identity: "Developer ID Application: Hermit Example (TEAM123456)",
      signing: "keychain",
      notarization: "api-key",
    },
  );
});

test("macOS release 拒绝缺证书或不完整公证凭据", () => {
  assert.throws(
    () => assertMacReleaseReady({
      platform: "darwin",
      environment: {
        APPLE_ID: "developer@example.test",
      },
      listCodeSigningIdentities: () => "0 valid identities found\n",
    }),
    /Developer ID Application/u,
  );
  assert.throws(
    () => assertMacReleaseReady({
      platform: "darwin",
      environment: {
        APPLE_ID: "developer@example.test",
      },
      listCodeSigningIdentities: () =>
        '  1) ABCDEF "Developer ID Application: Hermit Example (TEAM123456)"\n',
    }),
    /Incomplete macOS notarization credentials/u,
  );
});

test("macOS release 必须显式选择 skip 或 required", () => {
  assert.throws(() => macReleaseSigningMode({}), /HERMIT_MAC_RELEASE_SIGNING/u);
  assert.throws(
    () => macReleaseSigningMode({ HERMIT_MAC_RELEASE_SIGNING: "auto" }),
    /HERMIT_MAC_RELEASE_SIGNING/u,
  );
  assert.equal(macReleaseSigningMode({ HERMIT_MAC_RELEASE_SIGNING: "skip" }), "skip");
  assert.equal(macReleaseSigningMode({ HERMIT_MAC_RELEASE_SIGNING: "required" }), "required");
});

test("skip 是显式发布状态，不读取签名或公证凭据", () => {
  assert.deepEqual(
    resolveMacReleaseSigning({
      platform: "linux",
      environment: { HERMIT_MAC_RELEASE_SIGNING: "skip" },
      listCodeSigningIdentities: () => {
        throw new Error("不应读取 Keychain");
      },
    }),
    {
      mode: "skip",
      signing: "SKIPPED",
      notarization: "SKIPPED",
      stapling: "SKIPPED",
    },
  );
});
