import { contextBridge, ipcRenderer } from "electron";
import {
  QUICK_PANEL_IPC_CHANNEL,
  type QuickPanelResponse,
} from "./quick-panel-contract.js";

export interface QuickPanelBridge {
  /** 将草稿交给主窗口继续检查。 */
  readonly submitDraft: (text: string) => Promise<QuickPanelResponse>;
  /** 将搜索词交给主窗口继续处理。 */
  readonly search: (query: string) => Promise<QuickPanelResponse>;
}

/** 只暴露经过 IPC contract 校验的 Quick Panel bridge。 */
const bridge: QuickPanelBridge = {
  submitDraft: (text) => ipcRenderer.invoke(QUICK_PANEL_IPC_CHANNEL, { kind: "draft", text }),
  search: (query) => ipcRenderer.invoke(QUICK_PANEL_IPC_CHANNEL, { kind: "search", query }),
};

contextBridge.exposeInMainWorld("hermitQuickPanel", bridge);
