import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("无人值守 packaged provider 不读取、轮询或写入 General Pasteboard", () => {
  const source = fs.readFileSync(
    new URL(
      "../src/qualification/smart-clipboard-foundation/packaged-provider.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(source, /\bclipboard\b.*from ["']electron["']/u);
  assert.doesNotMatch(source, /readText|writeText|readBuffer|writeBuffer|availableFormats/u);
  assert.doesNotMatch(source, /NSPasteboard|AppKit|Swift/u);
  assert.match(source, /requires-disposable-clipboard-session/u);
  assert.match(source, /would-mutate-user-general-pasteboard/u);
});
