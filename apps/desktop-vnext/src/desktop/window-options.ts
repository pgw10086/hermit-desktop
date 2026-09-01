import type { WebPreferences } from "electron";

/** 返回所有 Hermit renderer 共用的最小安全 Electron 配置。 */
export function hardenedWebPreferences(): WebPreferences {
  return {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
  };
}
