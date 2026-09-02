import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createEvidenceSink } from "../lib/desktop/evidence.js";
import {
  createTrayMenuTemplate,
  loginItemLabel,
  setLoginItemEnabled,
} from "../lib/desktop/system-integration.js";

test("开机启动切换以系统读回状态为准，并保留 requires-approval 状态", () => {
  const writes = [];
  const states = [
    { openAtLogin: false, status: "not-registered" },
    { openAtLogin: false, status: "requires-approval" },
  ];
  const actual = setLoginItemEnabled(
    {
      read: () => states.shift(),
      write: (enabled) => writes.push(enabled),
    },
    true,
    { record: () => undefined },
  );

  assert.deepEqual(writes, [true]);
  assert.deepEqual(actual, { openAtLogin: false, status: "requires-approval" });
  assert.equal(loginItemLabel(actual), "开机启动（需在系统设置批准）");
});

test("Tray 菜单命令走唯一动作映射，checkbox 使用实际 login item 状态", () => {
  const calls = [];
  const template = createTrayMenuTemplate(
    {
      dshStatus: "正常",
      loginItem: { openAtLogin: false, status: "not-registered" },
    },
    {
      showMainWindow: () => calls.push("show-main"),
      setLoginItem: (enabled) => calls.push(`login:${String(enabled)}`),
      restartDsh: () => calls.push("restart-dsh"),
      quit: () => calls.push("quit"),
      recordCommand: (command) => calls.push(`record:${command}`),
    },
  );

  template.find(({ label }) => label === "打开 Hermit").click();
  template.find(({ label }) => label === "开机启动").click({ checked: true });
  template.find(({ label }) => label === "退出").click();

  assert.deepEqual(calls, [
    "record:open-main",
    "show-main",
    "record:login-item",
    "login:true",
    "record:quit",
    "quit",
  ]);
});

test("JSONL evidence 只写入当前 userData 且记录失败不接管生产流程", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-evidence-"));
  try {
    const file = path.join(root, "acceptance", "events.jsonl");
    const sink = createEvidenceSink(root, { HERMIT_EVIDENCE_FILE: file });
    sink.record("desktop.test", { ok: true });
    const entries = fs.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].schemaVersion, 1);
    assert.equal(entries[0].event, "desktop.test");
    assert.deepEqual(entries[0].details, { ok: true });

    const outside = path.join(path.dirname(root), "outside-evidence.jsonl");
    const originalError = console.error;
    const errors = [];
    console.error = (message) => errors.push(message);
    try {
      const rejected = createEvidenceSink(root, { HERMIT_EVIDENCE_FILE: outside });
      rejected.record("must-not-write");
    } finally {
      console.error = originalError;
    }
    assert.match(errors[0], /必须位于当前 Hermit userData/u);
    assert.equal(fs.existsSync(outside), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
