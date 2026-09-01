import { shell, type BrowserWindow } from "electron";

export interface NavigationActions {
  /** 返回最近一次通过 readiness 校验的 DSH origin。 */
  readonly getDshOrigin: () => string | undefined;
  /** 请求重启 DSH runtime。 */
  readonly restartDsh: () => void;
  /** 请求退出桌面应用。 */
  readonly quit: () => void;
}

/** 判断是否可交给系统浏览器打开的 HTTPS 地址。 */
function externalHttps(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** 只允许当前 DSH loopback origin 内部导航。 */
function allowedDshNavigation(value: string, origin: string | undefined): boolean {
  if (origin === undefined) return false;
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}

export function installNavigationPolicy(
  window: BrowserWindow,
  actions: NavigationActions,
): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (externalHttps(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (allowedDshNavigation(url, actions.getDshOrigin())) return;
    event.preventDefault();
    if (url === "hermit://runtime/restart") {
      actions.restartDsh();
      return;
    }
    if (url === "hermit://app/quit") {
      actions.quit();
      return;
    }
    if (externalHttps(url)) void shell.openExternal(url);
  });
}
