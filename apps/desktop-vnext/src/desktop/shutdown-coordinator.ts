import type { EvidenceSink } from "@hermit/desktop-core";

export type ShutdownSource =
  | "app-quit"
  | "system-shutdown"
  | "windows-query-session-end"
  | "windows-session-end";

export interface ShutdownCoordinatorOptions {
  /** 进入退出流程前冻结新任务或窗口操作。 */
  readonly prepare: () => void;
  /** 停止 DSH runtime 并等待其清理。 */
  readonly stopRuntime: () => Promise<void>;
  /** 通知 Electron 可以继续退出。 */
  readonly allowQuit: () => void;
  /** 发起实际应用退出。 */
  readonly quit: () => void;
  /** 记录退出阶段和结果。 */
  readonly evidence: EvidenceSink;
  /** 等待 runtime 清理的最长时间。 */
  readonly timeoutMs?: number;
  /** 向用户或诊断面报告清理问题。 */
  readonly reportProblem?: (message: string) => void;
}

export class ShutdownCoordinator {
  readonly #options: ShutdownCoordinatorOptions & {
    readonly timeoutMs: number;
    readonly reportProblem: (message: string) => void;
  };
  #completion: Promise<void> | undefined;

  constructor(options: ShutdownCoordinatorOptions) {
    this.#options = {
      ...options,
      timeoutMs: options.timeoutMs ?? 8_000,
      reportProblem: options.reportProblem ?? console.error,
    };
  }

  get started(): boolean {
    return this.#completion !== undefined;
  }

  /** 请求一次幂等退出流程，重复请求复用同一个 Promise。 */
  request(source: ShutdownSource): Promise<void> {
    if (this.#completion !== undefined) {
      this.#options.evidence.record("lifecycle.shutdown-duplicate", { source });
      return this.#completion;
    }
    this.#completion = this.#run(source);
    return this.#completion;
  }

  /** 按 prepare -> stop -> allowQuit 顺序执行退出，并显式记录超时或失败。 */
  async #run(source: ShutdownSource): Promise<void> {
    const { evidence } = this.#options;
    evidence.record("lifecycle.shutdown-requested", { source });
    try {
      this.#options.prepare();
    } catch (cause) {
      const message = `桌面退出准备失败: ${errorMessage(cause)}`;
      evidence.record("lifecycle.prepare-failed", { message });
      this.#options.reportProblem(message);
    }

    evidence.record("lifecycle.dsh-stop-started");
    const stopResult = this.#options.stopRuntime().then(
      () => ({ outcome: "completed" as const }),
      (cause: unknown) => ({ outcome: "failed" as const, cause }),
    );
    let timeout: NodeJS.Timeout | undefined;
    const result = await Promise.race([
      stopResult,
      new Promise<{ outcome: "timed-out" }>((resolve) => {
        timeout = setTimeout(() => resolve({ outcome: "timed-out" }), this.#options.timeoutMs);
      }),
    ]);
    if (timeout !== undefined) clearTimeout(timeout);

    if (result.outcome === "completed") {
      evidence.record("lifecycle.dsh-stop-completed");
    } else if (result.outcome === "failed") {
      const message = `DSH 退出清理失败: ${errorMessage(result.cause)}`;
      evidence.record("lifecycle.dsh-stop-failed", { message });
      this.#options.reportProblem(message);
    } else {
      evidence.record("lifecycle.dsh-stop-timed-out", { timeoutMs: this.#options.timeoutMs });
      this.#options.reportProblem(
        `DSH 退出清理超过 ${String(this.#options.timeoutMs)}ms，交由 carrier 继续回收`,
      );
    }

    this.#options.allowQuit();
    evidence.record("lifecycle.app-quit-requested");
    this.#options.quit();
  }
}

/** 将退出清理异常转换为诊断消息。 */
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
