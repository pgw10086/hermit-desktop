export interface QualificationDisposable {
  /** 停止监听或注销平台资源；可异步等待资源完成释放。 */
  dispose(): void | Promise<void>;
}

export interface ClipboardSnapshot {
  /** 平台剪贴板 generation，用于判断快照是否稳定且未被并发修改。 */
  readonly generation: number;
  /** 资格测试读取的文本内容；非文本内容统一为空。 */
  readonly text: string | null;
}

export interface ClipboardWriteResult {
  /** 平台写入结果。 */
  readonly status: "written" | "denied";
  /** 写入完成后平台返回的 generation。 */
  readonly generation: number;
}

export interface ClipboardSourceIdentity {
  /** 当前前台应用名称；无法识别时为空。 */
  readonly applicationName: string | null;
}

export interface AutoPasteResult {
  /** 显式粘贴是否完成；copy-only 表示只保证复制成功。 */
  readonly status: "pasted" | "copy-only";
  /** copy-only 时的可观察原因。 */
  readonly reason?: string;
}

export interface ClipboardQualificationPort {
  /** 监听平台剪贴板 generation 变化。 */
  observe(listener: (generation: number) => void): QualificationDisposable;
  /** 读取当前稳定快照。 */
  snapshot(): Promise<ClipboardSnapshot>;
  /** 写入资格测试文本。 */
  write(text: string): Promise<ClipboardWriteResult>;
  /** 读取当前前台应用身份。 */
  sourceIdentity(): Promise<ClipboardSourceIdentity>;
  /** 请求显式粘贴并返回平台能力结果。 */
  autoPaste(): Promise<AutoPasteResult>;
}

export type ShortcutRegistration =
  /** 快捷键注册成功并返回可撤销绑定。 */
  | { readonly status: "registered"; readonly binding: QualificationDisposable }
  /** 快捷键不可用及其原因。 */
  | { readonly status: "unavailable"; readonly reason: string };

export interface ShortcutQualificationPort {
  /** 注册资格测试快捷键；失败必须返回明确 unavailable。 */
  register(accelerator: string, listener: () => void): ShortcutRegistration;
}

export interface LockQualificationPort {
  /** 获取当前系统锁定状态。 */
  isLocked(): boolean;
  /** 监听锁定状态变化。 */
  observe(listener: (locked: boolean) => void): QualificationDisposable;
}
