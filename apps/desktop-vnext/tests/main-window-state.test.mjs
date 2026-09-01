import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FileMainWindowStateStore,
  fitMainWindowBounds,
} from "../lib/desktop/main-window-state.js";

test("主窗口位置和尺寸使用原子文件持久化", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-main-window-"));
  try {
    const store = new FileMainWindowStateStore(root);
    assert.equal(store.read(), undefined);
    const bounds = { x: -1200, y: 48, width: 1360, height: 820 };
    store.write(bounds);
    assert.deepEqual(store.read(), bounds);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("显示器布局变化后把主窗口恢复到可见工作区", () => {
  const workArea = { x: -1440, y: 24, width: 1440, height: 876 };
  const minimum = { width: 900, height: 640 };
  assert.deepEqual(
    fitMainWindowBounds(
      { x: -1320, y: 80, width: 1280, height: 760 },
      workArea,
      minimum,
    ),
    { x: -1320, y: 80, width: 1280, height: 760 },
  );
  assert.deepEqual(
    fitMainWindowBounds(
      { x: 4200, y: -800, width: 2000, height: 1400 },
      workArea,
      minimum,
    ),
    { x: -1440, y: 24, width: 1440, height: 876 },
  );
});
