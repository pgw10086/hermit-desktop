import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveWindowsReleaseSigning,
  windowsReleaseSigningMode,
  withoutWindowsReleaseSecrets,
} from "./windows-release-environment.mjs";

test("Windows candidate 只允许显式 skip 且不保留证书环境", () => {
  const environment = {
    HERMIT_WINDOWS_RELEASE_SIGNING: "skip",
    WIN_CSC_LINK: "secret.pfx",
    WIN_CSC_KEY_PASSWORD: "secret",
  };
  assert.equal(windowsReleaseSigningMode(environment), "skip");
  assert.deepEqual(withoutWindowsReleaseSecrets(environment), {
      HERMIT_WINDOWS_RELEASE_SIGNING: "skip",
    });
  assert.deepEqual(resolveWindowsReleaseSigning({ environment, platform: "win32" }), {
    mode: "skip",
    signing: "SKIPPED",
  });
});

test("Windows required release 拒绝缺失证书并接受明确的 PFX 环境", () => {
  assert.throws(
    () => resolveWindowsReleaseSigning({
      environment: { HERMIT_WINDOWS_RELEASE_SIGNING: "required" },
      platform: "win32",
    }),
    /WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD/u,
  );
  assert.deepEqual(resolveWindowsReleaseSigning({
    environment: {
      HERMIT_WINDOWS_RELEASE_SIGNING: "required",
      WIN_CSC_LINK: "secret.pfx",
      WIN_CSC_KEY_PASSWORD: "secret",
      WINDOWS_SIGNER_SUBJECT: "Hermit Test",
    },
    platform: "win32",
  }), {
    mode: "required",
    signing: "PASS",
    certificateSource: "WIN_CSC_LINK",
    signerSubject: "Hermit Test",
  });
});
