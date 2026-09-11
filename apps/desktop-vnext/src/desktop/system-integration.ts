import type { MenuItemConstructorOptions } from "electron";
import type { EvidenceSink } from "@tianbuyv/agent-desktop-core";

/** Quick Panel 的全局快捷键；主进程和资格测试共用该固定值。 */
export const QUICK_PANEL_SHORTCUT = "CommandOrControl+Shift+Space";

export interface LoginItemState {
  /** 是否请求系统在登录时启动应用。 */
  readonly openAtLogin: boolean;
  /** 系统登录项返回的细分状态。 */
  readonly status?: string;
}

export interface LoginItemPort {
  /** 读取系统登录项状态。 */
  read(): LoginItemState;
  /** 写入系统登录项开关。 */
  write(openAtLogin: boolean): void;
}

export interface TrayMenuState {
  /** DSH 当前状态展示文本。 */
  readonly dshStatus: string;
  /** 系统登录项状态。 */
  readonly loginItem: LoginItemState;
}

export interface TrayMenuActions {
  /** 打开主窗口。 */
  readonly showMainWindow: () => void;
  /** 修改登录项开关。 */
  readonly setLoginItem: (openAtLogin: boolean) => void;
  /** 请求重启 DSH runtime。 */
  readonly restartDsh: () => void;
  /** 请求退出应用。 */
  readonly quit: () => void;
  /** 记录托盘命令，供诊断使用。 */
  readonly recordCommand: (command: string) => void;
}

/** 写入登录项设置并回读系统最终状态。 */
export function setLoginItemEnabled(
  port: LoginItemPort,
  requested: boolean,
  evidence: EvidenceSink,
): LoginItemState {
  const before = port.read();
  evidence.record("desktop.login-item-before", loginItemEvidence(before));
  evidence.record("desktop.login-item-requested", { openAtLogin: requested });
  port.write(requested);
  const after = port.read();
  evidence.record("desktop.login-item-after", loginItemEvidence(after));
  return after;
}

/** 将系统登录项状态转换为托盘菜单标签。 */
export function loginItemLabel(state: LoginItemState): string {
  if (state.status === "requires-approval") return "开机启动（需在系统设置批准）";
  if (state.openAtLogin && state.status !== undefined && state.status !== "enabled") {
    return "开机启动（系统状态异常）";
  }
  return "开机启动";
}

/** 构造托盘菜单；每个动作都先记录命令再调用业务回调。 */
export function createTrayMenuTemplate(
  state: TrayMenuState,
  actions: TrayMenuActions,
): MenuItemConstructorOptions[] {
  const command = (name: string, action: () => void): (() => void) => () => {
    actions.recordCommand(name);
    action();
  };
  return [
    { label: `Hermit DSH · ${state.dshStatus}`, enabled: false },
    { type: "separator" },
    { label: "打开 Hermit", click: command("open-main", actions.showMainWindow) },
    {
      label: loginItemLabel(state.loginItem),
      type: "checkbox",
      checked: state.loginItem.openAtLogin,
      click: (item) => {
        actions.recordCommand("login-item");
        actions.setLoginItem(item.checked);
      },
    },
    { label: "重新启动 DSH", click: command("restart-dsh", actions.restartDsh) },
    { type: "separator" },
    { label: "退出", click: command("quit", actions.quit) },
  ];
}

/** 生成不含敏感信息的登录项诊断详情。 */
function loginItemEvidence(state: LoginItemState): Record<string, string | boolean> {
  return {
    openAtLogin: state.openAtLogin,
    status: state.status ?? "unknown",
  };
}
