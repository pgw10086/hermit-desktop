import { EventEmitter } from "node:events";
import type { RuntimeGenerationManager, RuntimeGeneration } from "./generation-manager.js";
import {
  DshSupervisor,
  type DshReadyEvent,
  type DshUnavailableEvent,
} from "./dsh-supervisor.js";

export interface DshRuntimeControllerOptions {
  /** 可选的 generation 持久化与切换管理器。 */
  readonly generationManager?: RuntimeGenerationManager;
  /** 为目标 generation 创建独立监督器。 */
  readonly createSupervisor: (generation: RuntimeGeneration | undefined) => DshSupervisor;
}

export interface DshActivationFailedEvent {
  /** 激活失败的根因。 */
  readonly cause: Error;
  /** 当前运行实例已恢复时的旧 URL。 */
  readonly restoredUrl?: URL;
}

/** 将 runtime 边界中的未知原因标准化为 Error。 */
function errorFrom(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

export class DshRuntimeController extends EventEmitter {
  readonly #options: DshRuntimeControllerOptions;
  #supervisor: DshSupervisor | undefined;
  #switching = false;
  #lastReady: DshReadyEvent | undefined;

  constructor(options: DshRuntimeControllerOptions) {
    super();
    this.#options = options;
  }

  /** 选择启动 generation 并启动对应监督器。 */
  async start(): Promise<URL> {
    const generation = this.#options.generationManager?.selectStartupGeneration();
    return this.#startGeneration(generation);
  }

  /** 停止当前监督器并清除 ready 引用。 */
  async stop(): Promise<void> {
    const supervisor = this.#supervisor;
    if (supervisor === undefined) return;
    await supervisor.stop();
    if (this.#supervisor === supervisor) {
      this.#supervisor = undefined;
      this.#lastReady = undefined;
    }
  }

  /** 重启当前 generation；尚未启动时退化为 start。 */
  async restart(): Promise<URL> {
    const supervisor = this.#supervisor;
    if (supervisor === undefined) return this.start();
    return supervisor.restart();
  }

  /** 切换到目标 generation；失败时恢复旧实例并发出 activation-failed。 */
  async activate(generationId: string): Promise<URL> {
    const manager = this.#options.generationManager;
    if (manager === undefined) throw new Error("Runtime generation switching is unavailable");
    if (manager.initialize().committedGeneration === generationId) {
      if (this.#lastReady !== undefined) return this.#lastReady.url;
      return this.start();
    }
    let currentWasStopped = false;
    this.#switching = true;
    try {
      await manager.activate(generationId, {
        stopCurrent: async () => {
          await this.stop();
          currentWasStopped = true;
        },
        startGeneration: async (generation) => {
          await this.#startGeneration(generation);
        },
      });
      const ready = this.#lastReady;
      if (ready === undefined) throw new Error("Activated runtime generation has no ready URL");
      this.#switching = false;
      this.emit("ready", ready);
      return ready.url;
    } catch (cause) {
      const ready = this.#lastReady;
      this.#switching = false;
      if (currentWasStopped && ready !== undefined) this.emit("ready", ready);
      this.emit("activation-failed", {
        cause: errorFrom(cause),
        ...(ready === undefined ? {} : { restoredUrl: ready.url }),
      } satisfies DshActivationFailedEvent);
      throw cause;
    }
  }

  /** 激活 generation manager 记录的上一版本。 */
  async rollback(): Promise<URL> {
    const manager = this.#options.generationManager;
    if (manager === undefined) throw new Error("Runtime generation switching is unavailable");
    const state = manager.initialize();
    if (state.previousGeneration === undefined) {
      throw new Error("No previous runtime generation is available for rollback");
    }
    return this.activate(state.previousGeneration);
  }

  /** 为一个 generation 绑定事件转发，并确保旧 supervisor 的迟到事件被忽略。 */
  async #startGeneration(generation: RuntimeGeneration | undefined): Promise<URL> {
    const supervisor = this.#options.createSupervisor(generation);
    this.#supervisor = supervisor;
    supervisor.on("ready", (event: DshReadyEvent) => {
      if (this.#supervisor !== supervisor) return;
      this.#lastReady = event;
      if (!this.#switching) this.emit("ready", event);
    });
    supervisor.on("crash", (event) => {
      if (this.#supervisor === supervisor && !this.#switching) this.emit("crash", event);
    });
    supervisor.on("unavailable", (event: DshUnavailableEvent) => {
      if (this.#supervisor === supervisor && !this.#switching) this.emit("unavailable", event);
    });
    return supervisor.start();
  }
}
