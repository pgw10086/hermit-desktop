/** activation 所拥有资源的异步或同步回收函数。 */
export type ActivationDisposer = () => void | Promise<void>;

/** 异步结果在 generation 仍有效时才允许提交。 */
export type CompletionOutcome = "applied" | "stale";

/**
 * 一次 activation generation 的资源所有权边界。
 *
 * dispose 会先让 generation 失效，再按资源注册的逆序回收，避免晚到事件继续产生副作用。
 */
export class ActivationLease {
  readonly generation: string;
  readonly #disposers: ActivationDisposer[] = [];
  #active = true;
  #completion: Promise<void> | undefined;

  constructor(generation: string) {
    if (generation.trim().length === 0) throw new Error("activation generation 不能为空");
    this.generation = generation;
  }

  get active(): boolean {
    return this.#active;
  }

  /** 注册由该 generation 独占的资源；失效后禁止继续接管资源。 */
  own(disposer: ActivationDisposer): void {
    if (!this.#active) throw new Error(`activation generation ${this.generation} 已失效`);
    this.#disposers.push(disposer);
  }

  /** 包装事件回调，只让有效 generation 产生副作用。 */
  guard<Args extends readonly unknown[]>(
    callback: (...args: Args) => void,
  ): (...args: Args) => void {
    return (...args) => {
      if (this.#active) callback(...args);
    };
  }

  /** 等待异步结果并在提交前检查 generation，过期结果返回 stale。 */
  async applyCompletion<T>(
    operation: Promise<T>,
    apply: (value: T) => void,
  ): Promise<CompletionOutcome> {
    const value = await operation;
    if (!this.#active) return "stale";
    apply(value);
    return "applied";
  }

  /** 使 generation 失效并按注册逆序回收全部资源，重复调用共享同一 Promise。 */
  dispose(): Promise<void> {
    if (this.#completion !== undefined) return this.#completion;
    this.#active = false;
    this.#completion = this.#disposeOwnedResources();
    return this.#completion;
  }

  async #disposeOwnedResources(): Promise<void> {
    const failures: unknown[] = [];
    for (const disposer of this.#disposers.reverse()) {
      try {
        await disposer();
      } catch (cause) {
        failures.push(cause);
      }
    }
    this.#disposers.length = 0;
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `activation generation ${this.generation} 资源回收失败`,
      );
    }
  }
}
