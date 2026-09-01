import fs from "node:fs";
import path from "node:path";

/** generation 切换的持久化阶段。 */
export type PendingGenerationPhase = "prepared" | "trial";

export interface RuntimeActivationState {
  /** 状态文件 schema 版本。 */
  readonly schemaVersion: 1;
  /** 当前已提交且启动时优先使用的 generation。 */
  readonly committedGeneration: string;
  /** 上一个 committed generation，用于回滚。 */
  readonly previousGeneration?: string;
  /** 正在试运行的候选 generation。 */
  readonly pendingGeneration?: string;
  /** 候选切换当前所处阶段。 */
  readonly pendingPhase?: PendingGenerationPhase;
  /** Canonical 数据 schema epoch。 */
  readonly dataEpoch: number;
}

export interface GenerationStateStore {
  /** 读取主状态或有效 backup。 */
  read(): RuntimeActivationState | undefined;
  /** 校验并原子写入状态。 */
  write(state: RuntimeActivationState): void;
}

const GENERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

/** 校验 generation 身份可安全用于目录和状态文件。 */
export function assertGenerationId(value: string): string {
  if (!GENERATION_ID_PATTERN.test(value)) {
    throw new Error(`Invalid runtime generation id: ${value}`);
  }
  return value;
}

/** 校验外部状态 JSON，并保证 pending generation 与 phase 成对存在。 */
export function parseActivationState(value: unknown): RuntimeActivationState {
  if (typeof value !== "object" || value === null) {
    throw new Error("Runtime activation state must be an object");
  }
  const state = value as Record<string, unknown>;
  if (state.schemaVersion !== 1) throw new Error("Unsupported runtime activation state schema");
  const committedGeneration = assertGenerationId(String(state.committedGeneration ?? ""));
  const previousGeneration = state.previousGeneration === undefined
    ? undefined
    : assertGenerationId(String(state.previousGeneration));
  const pendingGeneration = state.pendingGeneration === undefined
    ? undefined
    : assertGenerationId(String(state.pendingGeneration));
  const pendingPhase = state.pendingPhase;
  if (
    (pendingGeneration === undefined) !== (pendingPhase === undefined) ||
    (pendingPhase !== undefined && pendingPhase !== "prepared" && pendingPhase !== "trial")
  ) {
    throw new Error("Runtime pending generation and phase must be recorded together");
  }
  const dataEpoch = Number(state.dataEpoch);
  if (!Number.isSafeInteger(dataEpoch) || dataEpoch < 1) {
    throw new Error("Runtime activation data epoch must be a positive integer");
  }
  return {
    schemaVersion: 1,
    committedGeneration,
    ...(previousGeneration === undefined ? {} : { previousGeneration }),
    ...(pendingGeneration === undefined
      ? {}
      : { pendingGeneration, pendingPhase: pendingPhase as PendingGenerationPhase }),
    dataEpoch,
  };
}

export class FileGenerationStateStore implements GenerationStateStore {
  readonly #statePath: string;
  readonly #backupPath: string;

  constructor(statePath: string) {
    this.#statePath = path.resolve(statePath);
    this.#backupPath = `${this.#statePath}.previous`;
  }

  /** 读取主状态；主文件损坏时回退到最后一个有效 backup。 */
  read(): RuntimeActivationState | undefined {
    if (!fs.existsSync(this.#statePath)) return this.#readFile(this.#backupPath);
    try {
      return this.#readFile(this.#statePath);
    } catch (primaryCause) {
      if (fs.existsSync(this.#backupPath)) return this.#readFile(this.#backupPath);
      throw primaryCause;
    }
  }

  /** 以临时文件和 backup 保护方式原子写入 generation 状态。 */
  write(state: RuntimeActivationState): void {
    const normalized = parseActivationState(state);
    const directory = path.dirname(this.#statePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = path.join(
      directory,
      `.${path.basename(this.#statePath)}.${String(process.pid)}.${Date.now().toString(36)}.tmp`,
    );
    let temporaryCreated = false;
    try {
      const descriptor = fs.openSync(temporaryPath, "wx", 0o600);
      temporaryCreated = true;
      try {
        fs.writeFileSync(descriptor, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
        // M1 只承诺进程崩溃边界：先刷入完整新状态，再替换可见状态文件。
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }

      const primaryIsValid = this.#isValidFile(this.#statePath);
      if (primaryIsValid) {
        fs.rmSync(this.#backupPath, { force: true });
        fs.renameSync(this.#statePath, this.#backupPath);
      } else if (fs.existsSync(this.#statePath)) {
        // 主文件已经损坏时保留最后一个有效 backup；不能让一次恢复写抹掉唯一权威。
        fs.rmSync(this.#statePath, { force: true });
      }
      fs.renameSync(temporaryPath, this.#statePath);
      temporaryCreated = false;
    } finally {
      if (temporaryCreated) fs.rmSync(temporaryPath, { force: true });
    }
  }

  /** 读取并解析单个状态文件。 */
  #readFile(file: string): RuntimeActivationState | undefined {
    if (!fs.existsSync(file)) return undefined;
    return parseActivationState(JSON.parse(fs.readFileSync(file, "utf8")));
  }

  /** 判断文件是否存在且包含可解析状态。 */
  #isValidFile(file: string): boolean {
    if (!fs.existsSync(file)) return false;
    try {
      this.#readFile(file);
      return true;
    } catch {
      return false;
    }
  }
}
