import { ActivationLease } from "@hermit/desktop-core";
import type {
  ClipboardQualificationPort,
  LockQualificationPort,
  ShortcutQualificationPort,
} from "./ports.js";

/** 资格测试使用的桌面快捷键，必须与 Quick Panel 入口保持一致。 */
export const FOUNDATION_SHORTCUT = "CommandOrControl+Shift+Space";

export interface SmartClipboardFoundationDependencies {
  /** 平台剪贴板能力提供者。 */
  readonly clipboard?: ClipboardQualificationPort;
  /** 全局快捷键能力提供者。 */
  readonly shortcut?: ShortcutQualificationPort;
  /** 系统锁定状态提供者。 */
  readonly lock?: LockQualificationPort;
}

export interface SmartClipboardFoundationObserver {
  /** 剪贴板 generation 发生变化时的通知。 */
  readonly clipboardChanged: (generation: number) => void;
  /** 资格快捷键被触发时的通知。 */
  readonly shortcutTriggered: () => void;
  /** 系统锁定状态变化时的通知。 */
  readonly lockChanged: (locked: boolean) => void;
}

export type SmartClipboardFoundationActivation =
  | {
      /** 三项平台能力都已注册并由 lease 统一拥有。 */
      readonly status: "active";
      /** 当前 generation 的资源租约。 */
      readonly lease: ActivationLease;
      /** 可供后续资格步骤读取的剪贴板端口。 */
      readonly clipboard: ClipboardQualificationPort;
      /** 激活时读取到的初始锁定状态。 */
      readonly initialLocked: boolean;
    }
  | {
      /** 平台能力缺失或快捷键注册失败。 */
      readonly status: "unavailable";
      /** 失败发生在哪一项能力。 */
      readonly reason: "clipboard-provider" | "shortcut-provider" | "lock-provider" | "shortcut-registration";
      /** 面向资格报告的明确原因。 */
      readonly detail: string;
    };

/** 注册资格测试所需的平台监听，并保证失败或停用时整组释放。 */
export async function activateSmartClipboardFoundation(
  generation: string,
  dependencies: SmartClipboardFoundationDependencies,
  observer: SmartClipboardFoundationObserver,
): Promise<SmartClipboardFoundationActivation> {
  if (dependencies.clipboard === undefined) {
    return unavailable("clipboard-provider", "Clipboard qualification provider 不存在");
  }
  if (dependencies.shortcut === undefined) {
    return unavailable("shortcut-provider", "Shortcut qualification provider 不存在");
  }
  if (dependencies.lock === undefined) {
    return unavailable("lock-provider", "Lock qualification provider 不存在");
  }

  const lease = new ActivationLease(generation);
  try {
    const clipboardObservation = dependencies.clipboard.observe(
      lease.guard(observer.clipboardChanged),
    );
    lease.own(() => clipboardObservation.dispose());

    const lockObservation = dependencies.lock.observe(lease.guard(observer.lockChanged));
    lease.own(() => lockObservation.dispose());

    const shortcut = dependencies.shortcut.register(
      FOUNDATION_SHORTCUT,
      lease.guard(observer.shortcutTriggered),
    );
    if (shortcut.status === "unavailable") {
      await lease.dispose();
      return unavailable("shortcut-registration", shortcut.reason);
    }
    lease.own(() => shortcut.binding.dispose());

    return {
      status: "active",
      lease,
      clipboard: dependencies.clipboard,
      initialLocked: dependencies.lock.isLocked(),
    };
  } catch (cause) {
    await lease.dispose();
    throw cause;
  }
}

/** 构造统一 unavailable 结果，避免调用方自行拼接原因结构。 */
function unavailable(
  reason: Extract<SmartClipboardFoundationActivation, { status: "unavailable" }>["reason"],
  detail: string,
): SmartClipboardFoundationActivation {
  return { status: "unavailable", reason, detail };
}
