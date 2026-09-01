import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { execFile } from "node:child_process";
import { extractDshWebUrl, waitForHttpReady } from "./dsh-readiness.js";
import type { DshCommand } from "./dsh-command.js";

/** DSH 子进程监督器状态；unavailable 是达到重试预算后的明确终态。 */
export type DshRuntimeState =
  | "idle"
  | "starting"
  | "ready"
  | "stopping"
  | "stopped"
  | "recovering"
  | "unavailable";

export interface DshReadyEvent {
  /** 产生 ready 事件的监督 generation。 */
  readonly generation: number;
  /** 已通过 HTTP probe 的 DSH Web 地址。 */
  readonly url: URL;
}

export interface DshUnavailableEvent {
  /** 进入 unavailable 的监督 generation。 */
  readonly generation: number;
  /** 最终导致不可用的原因。 */
  readonly cause: Error;
}

export interface DshSupervisorOptions {
  /** 由上层解析好的 DSH 启动命令。 */
  readonly command: DshCommand;
  /** 等待 DSH readiness 的超时时间。 */
  readonly readyTimeoutMs?: number;
  /** 停止子进程树的超时时间。 */
  readonly shutdownTimeoutMs?: number;
  /** 崩溃恢复之间的等待时间。 */
  readonly restartDelayMs?: number;
  /** 单次启动允许的最大恢复次数。 */
  readonly maxRestarts?: number;
  /** 注入的 spawn 实现。 */
  readonly spawnProcess?: typeof spawn;
  /** 注入的 loopback readiness 探测器。 */
  readonly probe?: typeof waitForHttpReady;
  /** 注入的进程树终止器。 */
  readonly terminateTree?: (child: ChildProcessWithoutNullStreams) => Promise<void>;
}

/** 将未知原因收窄成 Error，保证事件和日志拥有稳定错误类型。 */
function errorFrom(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

class DshCleanupError extends Error {
  constructor(message: string, causes: readonly unknown[]) {
    super(message, { cause: new AggregateError(causes, message) });
    this.name = "DshCleanupError";
  }
}

/** 终止子进程及其进程组，防止 DSH carrier 留下孤儿进程。 */
async function terminateProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.pid === undefined) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (cause) {
      const error = errorFrom(cause) as NodeJS.ErrnoException;
      if (error.code !== "ESRCH") throw error;
    }
    return;
  }

  await new Promise<void>((resolve, reject) => {
    execFile(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true },
      (cause) => {
        if (cause === null) resolve();
        else reject(cause);
      },
    );
  });
}

/** 判断子进程是否已经收到退出信号或退出码。 */
function childHasExited(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** 等待单个子进程退出，已退出时立即完成。 */
function waitForChildExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (childHasExited(child)) return Promise.resolve();
  return once(child, "exit").then(() => undefined);
}

/** 判断指定进程组是否仍存在。 */
function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (cause) {
    const error = errorFrom(cause) as NodeJS.ErrnoException;
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

/** 在有限时间内等待进程组完全退出。 */
async function waitForProcessGroupExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (processGroupExists(pid)) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(25, remainingMs)));
  }
  return true;
}

export class DshSupervisor extends EventEmitter {
  readonly #options: Required<
    Pick<
      DshSupervisorOptions,
      "readyTimeoutMs" | "shutdownTimeoutMs" | "restartDelayMs" | "maxRestarts"
    >
  > &
    Pick<DshSupervisorOptions, "command"> & {
      readonly spawnProcess: typeof spawn;
      readonly probe: typeof waitForHttpReady;
      readonly terminateTree: (child: ChildProcessWithoutNullStreams) => Promise<void>;
    };

  #child: ChildProcessWithoutNullStreams | undefined;
  #desiredRunning = false;
  #generation = 0;
  #state: DshRuntimeState = "idle";
  #transition: Promise<URL> | undefined;
  #readyUrl: URL | undefined;
  #crashRestarts = 0;

  constructor(options: DshSupervisorOptions) {
    super();
    this.#options = {
      command: options.command,
      readyTimeoutMs: options.readyTimeoutMs ?? 30_000,
      shutdownTimeoutMs: options.shutdownTimeoutMs ?? 5_000,
      restartDelayMs: options.restartDelayMs ?? 300,
      maxRestarts: options.maxRestarts ?? 2,
      spawnProcess: options.spawnProcess ?? spawn,
      probe: options.probe ?? waitForHttpReady,
      terminateTree: options.terminateTree ?? terminateProcessTree,
    };
  }

  get state(): DshRuntimeState {
    return this.#state;
  }

  get generation(): number {
    return this.#generation;
  }

  /** 幂等启动 DSH，并在 readiness probe 通过后返回 Web URL。 */
  async start(): Promise<URL> {
    if (this.#desiredRunning && this.#transition !== undefined) return this.#transition;
    if (this.#desiredRunning && this.#state === "ready") {
      if (this.#readyUrl !== undefined) return this.#readyUrl;
      throw new Error("DSH runtime is ready without a URL");
    }
    if (!this.#desiredRunning) this.#crashRestarts = 0;
    this.#desiredRunning = true;
    this.#transition = this.#launchWithRetries("starting");
    try {
      return await this.#transition;
    } finally {
      this.#transition = undefined;
    }
  }

  /** 先完成停止，再启动新的监督 generation。 */
  async restart(): Promise<URL> {
    await this.stop();
    return this.start();
  }

  /** 停止当前 DSH 进程树并将状态置为 stopped。 */
  async stop(): Promise<void> {
    this.#desiredRunning = false;
    this.#setState("stopping");
    const child = this.#child;
    if (child !== undefined) {
      await this.#stopChild(child);
      if (this.#child === child) this.#child = undefined;
    }
    this.#readyUrl = undefined;
    this.#setState("stopped");
  }

  /** 更新监督状态并通知观察者。 */
  #setState(state: DshRuntimeState): void {
    this.#state = state;
    this.emit("state", state);
  }

  /** 在明确的重试预算内启动；耗尽预算后发出 unavailable。 */
  async #launchWithRetries(initialState: "starting" | "recovering"): Promise<URL> {
    this.#setState(initialState);
    let lastCause: Error | undefined;
    for (let attempt = 0; attempt <= this.#options.maxRestarts; attempt += 1) {
      if (!this.#desiredRunning) throw new Error("DSH startup was cancelled");
      if (attempt > 0) {
        this.#setState("recovering");
        await new Promise((resolve) => setTimeout(resolve, this.#options.restartDelayMs));
      }
      try {
        return await this.#launchOnce();
      } catch (cause) {
        lastCause = errorFrom(cause);
        if (!this.#desiredRunning) throw new Error("DSH startup was cancelled", { cause: lastCause });
        if (lastCause instanceof DshCleanupError) break;
      }
    }

    if (!this.#desiredRunning) throw new Error("DSH startup was cancelled", { cause: lastCause });
    const unavailable = lastCause ?? new Error("DSH runtime is unavailable");
    this.#setState("unavailable");
    this.#readyUrl = undefined;
    this.emit("unavailable", {
      generation: this.#generation,
      cause: unavailable,
    } satisfies DshUnavailableEvent);
    throw unavailable;
  }

  /** 启动单个子进程并将 stdout/stderr readiness 输出连接到 HTTP probe。 */
  async #launchOnce(): Promise<URL> {
    this.#generation += 1;
    const generation = this.#generation;
    const command = this.#options.command;
    const child = this.#options.spawnProcess(command.executable, [...command.args], {
      cwd: command.cwd,
      env: command.env,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child = child;

    return await new Promise<URL>((resolve, reject) => {
      let output = "";
      let ready = false;
      let probing = false;
      let settled = false;
      const timeout = setTimeout(() => {
        finishFailure(new Error("Timed out waiting for DSH readiness"));
      }, this.#options.readyTimeoutMs);

      const finishFailure = (cause: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        void this.#stopChild(child).then(
          () => {
            if (this.#child === child) this.#child = undefined;
            reject(errorFrom(cause));
          },
          (cleanupCause: unknown) => {
            reject(
              new DshCleanupError("DSH startup failed and its process tree was not reclaimed", [
                cause,
                cleanupCause,
              ]),
            );
          },
        );
      };

      const inspectOutput = (chunk: Buffer): void => {
        if (ready || probing || settled) return;
        output = `${output}${chunk.toString("utf8")}`.slice(-65_536);
        let url: URL | undefined;
        try {
          url = extractDshWebUrl(output);
        } catch (cause) {
          finishFailure(cause);
          return;
        }
        if (url === undefined) return;
        probing = true;
        void this.#options
          .probe(url, { timeoutMs: this.#options.readyTimeoutMs })
          .then(() => {
            if (settled || !this.#desiredRunning) return;
            settled = true;
            ready = true;
            clearTimeout(timeout);
            this.#readyUrl = url;
            this.#setState("ready");
            this.emit("ready", { generation, url } satisfies DshReadyEvent);
            resolve(url);
          })
          .catch(finishFailure);
      };

      child.stdout.on("data", inspectOutput);
      child.stderr.on("data", inspectOutput);
      child.once("error", finishFailure);
      child.once("exit", (code, signal) => {
        if (!ready) {
          finishFailure(
            new Error(
              `DSH exited before readiness (code=${String(code)}, signal=${String(signal)})`,
            ),
          );
          return;
        }
        if (!this.#desiredRunning) return;
        this.#readyUrl = undefined;
        if (this.#crashRestarts >= this.#options.maxRestarts) {
          this.#desiredRunning = false;
          const unavailable = new Error(
            `DSH crashed too many times (code=${String(code)}, signal=${String(signal)})`,
          );
          void this.#finishUnavailableAfterCleanup(child, generation, unavailable);
          return;
        }
        this.#crashRestarts += 1;
        this.emit("crash", { generation, code, signal });
        if (this.#transition === undefined) {
          this.#transition = this.#recoverAfterCrash(child);
          void this.#transition
            .catch(() => undefined)
            .finally(() => {
              this.#transition = undefined;
            });
        }
      });
    });
  }

  async #recoverAfterCrash(child: ChildProcessWithoutNullStreams): Promise<URL> {
    try {
      await this.#stopChild(child);
      if (this.#child === child) this.#child = undefined;
    } catch (cause) {
      this.#desiredRunning = false;
      const cleanupError = new DshCleanupError(
        "DSH crashed and its remaining process tree could not be reclaimed",
        [cause],
      );
      this.#setState("unavailable");
      this.emit("unavailable", {
        generation: this.#generation,
        cause: cleanupError,
      } satisfies DshUnavailableEvent);
      throw cleanupError;
    }
    return this.#launchWithRetries("recovering");
  }

  async #finishUnavailableAfterCleanup(
    child: ChildProcessWithoutNullStreams,
    generation: number,
    unavailable: Error,
  ): Promise<void> {
    let cause = unavailable;
    try {
      await this.#stopChild(child);
      if (this.#child === child) this.#child = undefined;
    } catch (cleanupCause) {
      cause = new DshCleanupError(
        "DSH exceeded its restart limit and its process tree could not be reclaimed",
        [unavailable, cleanupCause],
      );
    }
    this.#setState("unavailable");
    this.emit("unavailable", { generation, cause } satisfies DshUnavailableEvent);
  }

  async #stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
    const pid = child.pid;
    if (process.platform === "win32") {
      if (childHasExited(child)) return;
      const exited = waitForChildExit(child);
      if (this.#options.command.stopViaStdin === true) {
        child.stdin.end("STOP\n");
        const stopped = await Promise.race([
          exited.then(() => true),
          new Promise<false>((resolve) => setTimeout(
            () => resolve(false),
            this.#options.shutdownTimeoutMs,
          )),
        ]);
        if (stopped) return;
      }
      // Windows 的 Node signal 不是 POSIX 优雅退出协议；直接使用系统整树终止语义。
      await this.#options.terminateTree(child);
      await exited;
      return;
    }

    if (pid === undefined) {
      if (!childHasExited(child)) child.kill("SIGTERM");
      await waitForChildExit(child);
      return;
    }

    const exited = waitForChildExit(child);
    if (!childHasExited(child)) {
      if (this.#options.command.stopViaStdin === true) child.stdin.end("STOP\n");
      else child.kill("SIGTERM");
    }
    const treeExited = await waitForProcessGroupExit(pid, this.#options.shutdownTimeoutMs);
    if (treeExited) {
      await exited;
      return;
    }
    await this.#options.terminateTree(child);
    await exited;
    if (!(await waitForProcessGroupExit(pid, this.#options.shutdownTimeoutMs))) {
      throw new Error(`DSH process group ${String(pid)} did not exit after forced termination`);
    }
  }
}
