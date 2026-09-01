import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  parseQuickPanelRequest,
  QUICK_PANEL_IPC_CHANNEL,
} from "../lib/desktop/quick-panel-contract.js";
import { quickPanelPageUrl } from "../lib/desktop/quick-panel-page.js";

test("Quick Panel 只接受明确且非空的请求 schema", () => {
  assert.deepEqual(parseQuickPanelRequest({ kind: "draft", text: "  写入草稿  " }), {
    kind: "draft",
    text: "  写入草稿  ",
  });
  assert.deepEqual(parseQuickPanelRequest({ kind: "search", query: "项目" }), {
    kind: "search",
    query: "项目",
  });
  assert.throws(() => parseQuickPanelRequest({ kind: "draft", text: "" }), /请求内容无效/u);
  assert.throws(() => parseQuickPanelRequest({ kind: "search", query: " " }), /请求内容无效/u);
  assert.throws(() => parseQuickPanelRequest({ kind: "run-code" }), /请求内容无效/u);
});

test("Quick Panel 使用本地受控页面，不把 DSH Web 当作第二套对话", () => {
  const url = quickPanelPageUrl();
  assert.match(url, /^data:text\/html;charset=utf-8,/u);
  const html = decodeURIComponent(url.slice("data:text/html;charset=utf-8,".length));
  assert.match(html, /Quick Panel/u);
  assert.match(html, /不会直接写入 DSH Session/u);
  assert.doesNotMatch(html, /dsh web/u);
  assert.equal(QUICK_PANEL_IPC_CHANNEL, "hermit:quick-panel");
});

test("Quick Panel 页面文案明确不承诺自动写入 Session", () => {
  const html = decodeURIComponent(quickPanelPageUrl().slice("data:text/html;charset=utf-8,".length));
  assert.match(html, /不会直接写入 DSH Session/u);
  assert.match(html, /不会伪造搜索结果/u);
  assert.match(html, /bridge\.submitDraft/u);
  assert.match(html, /bridge\.search/u);
});

test("M1 桌面壳不挂载待独立设计的 Quick Panel", () => {
  const source = fs.readFileSync(path.resolve("src/main.ts"), "utf8");
  assert.doesNotMatch(source, /createQuickPanel|QUICK_PANEL_IPC_CHANNEL|registerQuickPanelShortcut/u);
  assert.match(source, /mainWindow\.loadURL\(event\.url\.href\)/u);
});
