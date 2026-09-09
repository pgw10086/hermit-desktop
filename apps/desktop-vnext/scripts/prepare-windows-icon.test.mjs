import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareWindowsIcon } from "./prepare-windows-icon.mjs";

test("Windows icon 将合法 PNG 封装为单图标 ICO", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-windows-icon-"));
  try {
    const source = path.join(root, "icon.png");
    const output = path.join(root, "icon.ico");
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.write("IHDR", 12, "ascii");
    png.writeUInt32BE(256, 16);
    png.writeUInt32BE(256, 20);
    fs.writeFileSync(source, png);
    const result = prepareWindowsIcon({ sourcePath: source, outputPath: output });
    assert.deepEqual({ width: result.width, height: result.height }, { width: 256, height: 256 });
    const ico = fs.readFileSync(output);
    assert.equal(ico.readUInt16LE(0), 0);
    assert.equal(ico.readUInt16LE(2), 1);
    assert.equal(ico.readUInt16LE(4), 1);
    assert.equal(ico.readUInt8(6), 0);
    assert.equal(ico.readUInt32LE(18), 22);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
