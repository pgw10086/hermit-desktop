import { app, BrowserWindow, globalShortcut, ipcMain, screen } from "electron";
import { fileURLToPath } from "node:url";
import {
  FOUNDATION_SHORTCUT,
} from "../../lib/qualification/smart-clipboard-foundation/fixture.js";
import {
  QUICK_RETRIEVAL_CANCEL_CHANNEL,
  QUICK_RETRIEVAL_INTERACTIVE_CHANNEL,
  QUICK_RETRIEVAL_SELECT_CHANNEL,
  QUICK_RETRIEVAL_SHOW_CHANNEL,
} from "../../lib/qualification/smart-clipboard-foundation/quick-retrieval-contract.js";
import {
  quickRetrievalFixturePageUrl,
} from "../../lib/qualification/smart-clipboard-foundation/quick-retrieval-page.js";

const items = [
  { id: "clip-1", text: "会议纪要：周五前提交交付物", source: "文档编辑器" },
  { id: "clip-2", text: "项目风险：接口联调时间不足", source: "浏览器" },
  { id: "clip-3", text: "客户沟通要点", source: "聊天工具" },
  { id: "clip-4", text: "接口地址：http://127.0.0.1:8080", source: "终端" },
  { id: "clip-5", text: "下次评审时间：周二 14:00", source: "日历" },
  { id: "clip-6", text: "验收清单：安装、启动、搜索、取回", source: "文档编辑器" },
  { id: "clip-7", text: "release/clipboard-foundation", source: "代码编辑器" },
  { id: "clip-8", text: "请确认本周交付范围", source: "聊天工具" },
];
const preload = fileURLToPath(new URL(
  "./quick-retrieval-preload.cjs",
  import.meta.url,
));

void app.whenReady().then(startQualification).catch((cause) => {
  console.error(cause);
  app.exit(1);
});

async function startQualification() {
const target = new BrowserWindow({ width: 480, height: 320, show: true });
await target.loadURL("data:text/html,<title>Qualification Target</title><input autofocus>");
target.focus();

const panel = new BrowserWindow({
  width: 480,
  height: 520,
  show: false,
  frame: false,
  resizable: false,
  maximizable: false,
  minimizable: false,
  fullscreenable: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
    // Warm 浮层隐藏时不运行定时任务，只避免 Chromium 把恢复后的首个可交互帧节流到 500ms。
    backgroundThrottling: false,
    preload,
  },
});
await panel.loadURL(quickRetrievalFixturePageUrl(items));

const state = {
  registered: false,
  latencies: [],
  selections: [],
  cancelled: 0,
  lockHides: 0,
  triggerStartedAt: undefined,
  anchor: undefined,
};

function restoreTargetFocus() {
  panel.hide();
  if (!target.isDestroyed()) target.focus();
}

function triggerShortcut() {
  state.triggerStartedAt = performance.now();
  state.anchor = positionNearCursor(panel);
  panel.show();
  app.focus({ steal: true });
  panel.focus();
  panel.webContents.send(QUICK_RETRIEVAL_SHOW_CHANNEL);
}

ipcMain.on(QUICK_RETRIEVAL_INTERACTIVE_CHANNEL, () => {
  if (state.triggerStartedAt !== undefined) {
    state.latencies.push(performance.now() - state.triggerStartedAt);
    state.triggerStartedAt = undefined;
  }
});
ipcMain.on(QUICK_RETRIEVAL_SELECT_CHANNEL, (_event, id) => {
  if (typeof id !== "string" || !items.some((item) => item.id === id)) return;
  state.selections.push(id);
  restoreTargetFocus();
});
ipcMain.on(QUICK_RETRIEVAL_CANCEL_CHANNEL, () => {
  state.cancelled += 1;
  restoreTargetFocus();
});

state.registered = globalShortcut.register(FOUNDATION_SHORTCUT, triggerShortcut)
  && globalShortcut.isRegistered(FOUNDATION_SHORTCUT);

globalThis.__hermitQuickRetrievalQualification = {
  triggerShortcut,
  simulateLock() {
    if (panel.isVisible()) {
      state.lockHides += 1;
      restoreTargetFocus();
    }
  },
  report() {
    return {
      ...state,
      targetFocused: target.isFocused(),
      panelFocused: panel.isFocused(),
      panelVisible: panel.isVisible(),
      panelBounds: panel.getBounds(),
    };
  },
};

app.on("will-quit", () => globalShortcut.unregister(FOUNDATION_SHORTCUT));
}

function positionNearCursor(panel) {
  const cursor = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  const bounds = panel.getBounds();
  const gap = 10;
  const right = cursor.x + gap;
  const below = cursor.y + gap;
  const x = right + bounds.width <= workArea.x + workArea.width
    ? right
    : Math.max(workArea.x, cursor.x - bounds.width - gap);
  const y = below + bounds.height <= workArea.y + workArea.height
    ? below
    : Math.max(workArea.y, cursor.y - bounds.height - gap);
  panel.setPosition(x, y, false);
  return { cursor, workArea, sideX: x >= cursor.x ? "right" : "left", sideY: y >= cursor.y ? "below" : "above" };
}
