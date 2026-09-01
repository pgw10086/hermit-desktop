import fs from "node:fs";
import path from "node:path";
import {
  assertGenerationId,
  type GenerationStateStore,
  type RuntimeActivationState,
} from "./generation-state-store.js";

export interface RuntimeGenerationManifest {
  /** manifest schema 版本。 */
  readonly schemaVersion: 1;
  /** generation 稳定身份，与目录名一致。 */
  readonly generationId: string;
  /** Hermit runtime 版本。 */
  readonly runtimeVersion: string;
  /** bundled Node 版本。 */
  readonly nodeVersion: string;
  /** DSH 版本。 */
  readonly dshVersion: string;
  /** 上游 DSH provenance 信息。 */
  readonly dshUpstream: DshUpstreamCohort;
  /** 数据 schema epoch，跨 epoch 不能直接切换。 */
  readonly dataEpoch: number;
}

export interface DshUpstreamCohort {
  /** 上游仓库地址。 */
  readonly repository: string;
  /** 上游 tag。 */
  readonly tag: string;
  /** 上游精确 commit。 */
  readonly commit: string;
  /** 实际包版本。 */
  readonly packageVersion: string;
  /** 上游源码快照路径。 */
  readonly snapshotPath: string;
  /** 源码快照校验和。 */
  readonly snapshotChecksum: string;
}

export interface RuntimeGeneration {
  /** generation 制品根目录。 */
  readonly root: string;
  /** 已校验的 generation manifest。 */
  readonly manifest: RuntimeGenerationManifest;
}

export interface GenerationSwitchOperations {
  /** 停止当前 committed runtime。 */
  stopCurrent(): Promise<void>;
  /** 启动候选 generation。 */
  startGeneration(generation: RuntimeGeneration): Promise<void>;
}

export class RuntimeGenerationCatalog {
  readonly #roots: readonly string[];

  constructor(roots: readonly string[]) {
    this.#roots = roots.map((root) => path.resolve(root));
  }

  /** 查找并校验唯一 generation 制品。 */
  get(generationId: string): RuntimeGeneration {
    assertGenerationId(generationId);
    const matches = this.#roots
      .map((root) => path.join(root, generationId))
      .filter((root) => fs.existsSync(path.join(root, "generation.json")));
    if (matches.length === 0) throw new Error(`Runtime generation is missing: ${generationId}`);
    if (matches.length > 1) throw new Error(`Runtime generation id is ambiguous: ${generationId}`);
    const root = matches[0];
    if (root === undefined) throw new Error(`Runtime generation is missing: ${generationId}`);
    const manifest = parseGenerationManifest(
      JSON.parse(fs.readFileSync(path.join(root, "generation.json"), "utf8")),
    );
    if (manifest.generationId !== generationId) {
      throw new Error(`Runtime generation manifest id does not match its directory: ${generationId}`);
    }
    return { root, manifest };
  }
}

export class RuntimeGenerationManager {
  readonly #catalog: RuntimeGenerationCatalog;
  readonly #store: GenerationStateStore;
  readonly #initialGeneration: string;

  constructor(options: {
    readonly catalog: RuntimeGenerationCatalog;
    readonly store: GenerationStateStore;
    readonly initialGeneration: string;
  }) {
    this.#catalog = options.catalog;
    this.#store = options.store;
    this.#initialGeneration = assertGenerationId(options.initialGeneration);
  }

  /** 读取或建立 committed generation 状态。 */
  initialize(): RuntimeActivationState {
    const existing = this.#store.read();
    if (existing !== undefined) {
      this.#assertStateReferences(existing);
      return existing;
    }
    const initial = this.#catalog.get(this.#initialGeneration);
    const state: RuntimeActivationState = {
      schemaVersion: 1,
      committedGeneration: initial.manifest.generationId,
      dataEpoch: initial.manifest.dataEpoch,
    };
    this.#store.write(state);
    return state;
  }

  /** 启动时清理未完成 pending 状态，并返回 committed generation。 */
  selectStartupGeneration(): RuntimeGeneration {
    const state = this.initialize();
    if (state.pendingGeneration !== undefined) {
      // 上次切换没有形成 committed 事实；重启时保守返回旧 generation，不再赌候选。
      this.#store.write(withoutPending(state));
    }
    return this.#catalog.get(state.committedGeneration);
  }

  /** 按 prepared -> trial -> committed 阶段切换 generation，失败时恢复旧实例。 */
  async activate(
    candidateId: string,
    operations: GenerationSwitchOperations,
  ): Promise<RuntimeGeneration> {
    const state = this.initialize();
    const current = this.#catalog.get(state.committedGeneration);
    const candidate = this.#catalog.get(candidateId);
    if (candidate.manifest.generationId === current.manifest.generationId) return current;
    if (candidate.manifest.dataEpoch !== state.dataEpoch) {
      throw new Error(
        `UPDATE_UNSUPPORTED_SCHEMA_TRANSITION: current=${String(state.dataEpoch)}, ` +
          `candidate=${String(candidate.manifest.dataEpoch)}`,
      );
    }

    this.#store.write({
      ...withoutPending(state),
      pendingGeneration: candidate.manifest.generationId,
      pendingPhase: "prepared",
    });
    try {
      await operations.stopCurrent();
    } catch (stopCause) {
      let failure: unknown = stopCause;
      try {
        this.#store.write(withoutPending(state));
      } catch (stateCause) {
        failure = new AggregateError(
          [stopCause, stateCause],
          "Failed to stop the committed runtime and clear its pending activation",
        );
      }
      throw failure;
    }
    try {
      this.#store.write({
        ...withoutPending(state),
        pendingGeneration: candidate.manifest.generationId,
        pendingPhase: "trial",
      });
    } catch (trialCause) {
      await this.#restartCommitted(current, operations, trialCause);
    }

    try {
      await operations.startGeneration(candidate);
    } catch (candidateCause) {
      let failure: unknown = candidateCause;
      try {
        this.#store.write(withoutPending(state));
      } catch (stateCause) {
        failure = new AggregateError(
          [candidateCause, stateCause],
          "Candidate runtime failed and pending activation cleanup also failed",
        );
      }
      await this.#restartCommitted(current, operations, failure);
    }

    try {
      this.#store.write({
        schemaVersion: 1,
        committedGeneration: candidate.manifest.generationId,
        previousGeneration: current.manifest.generationId,
        dataEpoch: state.dataEpoch,
      });
    } catch (commitCause) {
      try {
        await operations.stopCurrent();
      } catch (stopCause) {
        throw new AggregateError(
          [commitCause, stopCause],
          "Candidate runtime commit failed and the candidate could not be stopped",
        );
      }
      await this.#restartCommitted(current, operations, commitCause);
    }
    return candidate;
  }

  async rollback(operations: GenerationSwitchOperations): Promise<RuntimeGeneration> {
    const state = this.initialize();
    if (state.previousGeneration === undefined) {
      throw new Error("No previous runtime generation is available for rollback");
    }
    return this.activate(state.previousGeneration, operations);
  }

  async #restartCommitted(
    committed: RuntimeGeneration,
    operations: GenerationSwitchOperations,
    activationCause: unknown,
  ): Promise<never> {
    try {
      await operations.startGeneration(committed);
    } catch (rollbackCause) {
      throw new AggregateError(
        [activationCause, rollbackCause],
        `Candidate and committed runtime generations both failed: ${committed.manifest.generationId}`,
      );
    }
    throw new Error(
      `Candidate runtime generation failed; restored ${committed.manifest.generationId}`,
      { cause: activationCause },
    );
  }

  #assertStateReferences(state: RuntimeActivationState): void {
    const committed = this.#catalog.get(state.committedGeneration);
    if (committed.manifest.dataEpoch !== state.dataEpoch) {
      throw new Error("Committed runtime generation data epoch does not match activation state");
    }
    if (state.previousGeneration !== undefined) this.#catalog.get(state.previousGeneration);
    if (state.pendingGeneration !== undefined) this.#catalog.get(state.pendingGeneration);
  }
}

function withoutPending(state: RuntimeActivationState): RuntimeActivationState {
  return {
    schemaVersion: 1,
    committedGeneration: state.committedGeneration,
    ...(state.previousGeneration === undefined
      ? {}
      : { previousGeneration: state.previousGeneration }),
    dataEpoch: state.dataEpoch,
  };
}

export function parseGenerationManifest(value: unknown): RuntimeGenerationManifest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Runtime generation manifest must be an object");
  }
  const manifest = value as Record<string, unknown>;
  if (manifest.schemaVersion !== 1) throw new Error("Unsupported runtime generation schema");
  const generationId = assertGenerationId(String(manifest.generationId ?? ""));
  const runtimeVersion = nonEmptyString(manifest.runtimeVersion, "runtimeVersion");
  const nodeVersion = nonEmptyString(manifest.nodeVersion, "nodeVersion");
  const dshVersion = nonEmptyString(manifest.dshVersion, "dshVersion");
  const dshUpstream = parseDshUpstream(manifest.dshUpstream);
  if (dshUpstream.packageVersion !== dshVersion) {
    throw new Error("Runtime generation upstream cohort does not match dshVersion");
  }
  const dataEpoch = Number(manifest.dataEpoch);
  if (!Number.isSafeInteger(dataEpoch) || dataEpoch < 1) {
    throw new Error("Runtime generation data epoch must be a positive integer");
  }
  return { schemaVersion: 1, generationId, runtimeVersion, nodeVersion, dshVersion, dshUpstream, dataEpoch };
}

function parseDshUpstream(value: unknown): DshUpstreamCohort {
  if (typeof value !== "object" || value === null) {
    throw new Error("Runtime generation dshUpstream must be an object");
  }
  const cohort = value as Record<string, unknown>;
  const repository = nonEmptyString(cohort.repository, "dshUpstream.repository");
  const tag = nonEmptyString(cohort.tag, "dshUpstream.tag");
  const commit = nonEmptyString(cohort.commit, "dshUpstream.commit");
  const packageVersion = nonEmptyString(cohort.packageVersion, "dshUpstream.packageVersion");
  const snapshotPath = nonEmptyString(cohort.snapshotPath, "dshUpstream.snapshotPath");
  const snapshotChecksum = nonEmptyString(cohort.snapshotChecksum, "dshUpstream.snapshotChecksum");
  if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error("Runtime generation dshUpstream.commit must be a full SHA");
  if (!/^[a-f0-9]{64}$/u.test(snapshotChecksum)) throw new Error("Runtime generation dshUpstream.snapshotChecksum must be SHA-256");
  return { repository, tag, commit, packageVersion, snapshotPath, snapshotChecksum };
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Runtime generation ${field} must be a non-empty string`);
  }
  return value;
}
