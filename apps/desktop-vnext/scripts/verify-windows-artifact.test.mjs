import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertPeArchitecture,
  expectedWindowsInstallerName,
} from "./verify-windows-artifact.mjs";

test("Windows installer name includes the desktop version and x64 target", () => {
  assert.equal(expectedWindowsInstallerName("0.2.2"), "Hermit-0.2.2-x64.exe");
});

test("Windows PE verifier accepts x64 and rejects other machine types", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-windows-artifact-"));
  try {
    const executable = path.join(root, "Hermit.exe");
    const bytes = Buffer.alloc(0x80);
    bytes.writeUInt32LE(0x40, 0x3c);
    bytes.write("PE\0\0", 0x40, "ascii");
    bytes.writeUInt16LE(0x8664, 0x44);
    fs.writeFileSync(executable, bytes);
    assert.doesNotThrow(() => assertPeArchitecture(executable, 0x8664));
    assert.throws(() => assertPeArchitecture(executable, 0x14c), /architecture mismatch/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
