import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  RuntimeGenerationCatalog,
  RuntimeGenerationManager,
} from "../lib/runtime/generation-manager.js";
import { FileGenerationStateStore } from "../lib/runtime/generation-state-store.js";

function writeGeneration(root, generationId, dataEpoch = 1) {
  const generationRoot = path.join(root, generationId);
  fs.mkdirSync(generationRoot, { recursive: true });
  fs.writeFileSync(
    path.join(generationRoot, "generation.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      generationId,
      runtimeVersion: `test-${generationId}`,
      nodeVersion: "24.x-test",
      dshVersion: "0.1.1-rc.2",
      dshUpstream: {
        repository: "https://github.com/deepseek-ai/deepseek-harness",
        tag: "dsh-v0.1.1-rc.2",
        commit: "b150a551b8d465e31e418e1b2eaf5e79bbb7d28e",
        packageVersion: "0.1.1-rc.2",
        snapshotPath: "docs/provenance/deepseek-harness/snapshots/0.1.1-rc.2__b150a551",
        snapshotChecksum: "0b295e1ff88eb443c5fd16cb3e9b23938606706d4377a2d94f45c1bdff08af25",
      },
      dataEpoch,
    }, null, 2)}\n`,
  );
}

function createManager(root, providedStore) {
  const store = providedStore ?? new FileGenerationStateStore(path.join(root, "activation-state.json"));
  return {
    manager: new RuntimeGenerationManager({
      catalog: new RuntimeGenerationCatalog([path.join(root, "generations")]),
      store,
      initialGeneration: "gen-a",
    }),
    store,
  };
}

function failingStore(failWrites) {
  return {
    state: undefined,
    writes: 0,
    read() {
      return this.state;
    },
    write(state) {
      this.writes += 1;
      if (failWrites.has(this.writes)) throw new Error(`state write ${String(this.writes)} failed`);
      this.state = structuredClone(state);
    },
  };
}

test("候选 generation 成功后持久提交，重启和显式回滚都使用同一状态事实", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-generation-success-"));
  try {
    const generations = path.join(root, "generations");
    writeGeneration(generations, "gen-a");
    writeGeneration(generations, "gen-b");
    const { manager, store } = createManager(root);
    const starts = [];
    const operations = {
      stopCurrent: async () => undefined,
      startGeneration: async (generation) => starts.push(generation.manifest.generationId),
    };

    assert.equal(manager.selectStartupGeneration().manifest.generationId, "gen-a");
    assert.equal((await manager.activate("gen-b", operations)).manifest.generationId, "gen-b");
    assert.deepEqual(store.read(), {
      schemaVersion: 1,
      committedGeneration: "gen-b",
      previousGeneration: "gen-a",
      dataEpoch: 1,
    });
    assert.equal(manager.selectStartupGeneration().manifest.generationId, "gen-b");
    assert.equal((await manager.rollback(operations)).manifest.generationId, "gen-a");
    assert.deepEqual(starts, ["gen-b", "gen-a"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("候选 ready 后提交状态失败时停止候选并恢复旧 generation", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-generation-commit-failure-"));
  try {
    const generations = path.join(root, "generations");
    writeGeneration(generations, "gen-a");
    writeGeneration(generations, "gen-b");
    const store = failingStore(new Set([4]));
    const { manager } = createManager(root, store);
    const starts = [];
    let stops = 0;
    await assert.rejects(
      manager.activate("gen-b", {
        stopCurrent: async () => {
          stops += 1;
        },
        startGeneration: async (generation) => starts.push(generation.manifest.generationId),
      }),
      /restored gen-a/u,
    );
    assert.deepEqual(starts, ["gen-b", "gen-a"]);
    assert.equal(stops, 2);
    assert.equal(store.state.pendingPhase, "trial");
    assert.equal(manager.selectStartupGeneration().manifest.generationId, "gen-a");
    assert.equal(store.state.pendingGeneration, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("状态主文件损坏时读取上一个完整状态，不把损坏误判成首次启动", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-generation-state-fallback-"));
  try {
    const statePath = path.join(root, "activation-state.json");
    const store = new FileGenerationStateStore(statePath);
    store.write({ schemaVersion: 1, committedGeneration: "gen-a", dataEpoch: 1 });
    store.write({
      schemaVersion: 1,
      committedGeneration: "gen-b",
      previousGeneration: "gen-a",
      dataEpoch: 1,
    });
    fs.writeFileSync(statePath, "{broken", "utf8");
    assert.deepEqual(store.read(), {
      schemaVersion: 1,
      committedGeneration: "gen-a",
      dataEpoch: 1,
    });
    store.write({
      schemaVersion: 1,
      committedGeneration: "gen-c",
      previousGeneration: "gen-a",
      dataEpoch: 1,
    });
    fs.writeFileSync(statePath, "{broken-again", "utf8");
    assert.deepEqual(store.read(), {
      schemaVersion: 1,
      committedGeneration: "gen-a",
      dataEpoch: 1,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("旧 generation 已停但 trial 状态写失败时立即重启旧 generation", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-generation-trial-write-"));
  try {
    const generations = path.join(root, "generations");
    writeGeneration(generations, "gen-a");
    writeGeneration(generations, "gen-b");
    const store = failingStore(new Set([3]));
    const { manager } = createManager(root, store);
    const starts = [];
    await assert.rejects(
      manager.activate("gen-b", {
        stopCurrent: async () => undefined,
        startGeneration: async (generation) => starts.push(generation.manifest.generationId),
      }),
      /restored gen-a/u,
    );
    assert.deepEqual(starts, ["gen-a"]);
    assert.equal(store.state.pendingPhase, "prepared");
    assert.equal(manager.selectStartupGeneration().manifest.generationId, "gen-a");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("候选失败且 pending 清理写失败时仍先恢复旧 generation", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-generation-cleanup-write-"));
  try {
    const generations = path.join(root, "generations");
    writeGeneration(generations, "gen-a");
    writeGeneration(generations, "gen-b");
    const store = failingStore(new Set([4]));
    const { manager } = createManager(root, store);
    const starts = [];
    await assert.rejects(
      manager.activate("gen-b", {
        stopCurrent: async () => undefined,
        startGeneration: async (generation) => {
          starts.push(generation.manifest.generationId);
          if (generation.manifest.generationId === "gen-b") throw new Error("candidate failed");
        },
      }),
      /restored gen-a/u,
    );
    assert.deepEqual(starts, ["gen-b", "gen-a"]);
    assert.equal(store.state.pendingPhase, "trial");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("停止旧 generation 失败时清掉 prepared 状态且不启动候选", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-generation-stop-failure-"));
  try {
    const generations = path.join(root, "generations");
    writeGeneration(generations, "gen-a");
    writeGeneration(generations, "gen-b");
    const { manager, store } = createManager(root);
    let starts = 0;
    await assert.rejects(
      manager.activate("gen-b", {
        stopCurrent: async () => {
          throw new Error("stop failed");
        },
        startGeneration: async () => {
          starts += 1;
        },
      }),
      /stop failed/u,
    );
    assert.equal(starts, 0);
    assert.equal(store.read()?.pendingGeneration, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("候选启动失败时恢复 committed generation，且不提交候选", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-generation-failure-"));
  try {
    const generations = path.join(root, "generations");
    writeGeneration(generations, "gen-a");
    writeGeneration(generations, "gen-b");
    const { manager, store } = createManager(root);
    const starts = [];
    await assert.rejects(
      manager.activate("gen-b", {
        stopCurrent: async () => undefined,
        startGeneration: async (generation) => {
          starts.push(generation.manifest.generationId);
          if (generation.manifest.generationId === "gen-b") throw new Error("candidate failed");
        },
      }),
      /restored gen-a/u,
    );
    assert.deepEqual(starts, ["gen-b", "gen-a"]);
    assert.equal(store.read()?.committedGeneration, "gen-a");
    assert.equal(store.read()?.pendingGeneration, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("上次 trial 中断后重启只选择 committed generation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-generation-recovery-"));
  try {
    const generations = path.join(root, "generations");
    writeGeneration(generations, "gen-a");
    writeGeneration(generations, "gen-b");
    const { manager, store } = createManager(root);
    store.write({
      schemaVersion: 1,
      committedGeneration: "gen-a",
      pendingGeneration: "gen-b",
      pendingPhase: "trial",
      dataEpoch: 1,
    });
    assert.equal(manager.selectStartupGeneration().manifest.generationId, "gen-a");
    assert.equal(store.read()?.pendingGeneration, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("M1 拒绝跨 dataEpoch 激活，不偷做 schema migration", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-generation-epoch-"));
  try {
    const generations = path.join(root, "generations");
    writeGeneration(generations, "gen-a", 1);
    writeGeneration(generations, "gen-b", 2);
    const { manager } = createManager(root);
    await assert.rejects(
      manager.activate("gen-b", {
        stopCurrent: async () => undefined,
        startGeneration: async () => undefined,
      }),
      /UPDATE_UNSUPPORTED_SCHEMA_TRANSITION/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
