import { BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import type { MainWindowBounds } from "./main-window-state.js";
import { installNavigationPolicy, type NavigationActions } from "./window-policy.js";
import { hardenedWebPreferences } from "./window-options.js";
import { quickPanelPageUrl } from "./quick-panel-page.js";

/** 创建主窗口，并应用统一的安全 webPreferences 和导航策略。 */
export function createMainWindow(
  actions: NavigationActions,
  restoredBounds?: MainWindowBounds,
): BrowserWindow {
  const window = new BrowserWindow({
    title: "Hermit",
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: "#202124",
    autoHideMenuBar: true,
    webPreferences: {
      ...hardenedWebPreferences(),
      preload: fileURLToPath(new URL('./smart-clipboard-preload.cjs', import.meta.url)),
    },
    ...restoredBounds,
  });
  keepNativeTitle(window, "Hermit");
  installNavigationPolicy(window, actions);
  return window;
}

/** 创建旧版 Quick Panel 窗口，输入通过 preload bridge 交接。 */
export function createQuickPanel(actions: NavigationActions): BrowserWindow {
  const window = new BrowserWindow({
    title: "Hermit Quick Panel",
    width: 680,
    height: 720,
    minWidth: 520,
    minHeight: 520,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#202124",
    autoHideMenuBar: true,
    webPreferences: {
      ...hardenedWebPreferences(),
      preload: fileURLToPath(new URL("./quick-panel-preload.js", import.meta.url)),
    },
  });
  keepNativeTitle(window, "Hermit Quick Panel");
  installNavigationPolicy(window, actions);
  window.on("blur", () => window.hide());
  void window.loadURL(quickPanelPageUrl()).catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`Quick Panel 本地页面加载失败: ${message}`);
  });
  return window;
}

/** 阻止远程页面修改桌面窗口标题。 */
function keepNativeTitle(window: BrowserWindow, title: string): void {
  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(title);
  });
}
