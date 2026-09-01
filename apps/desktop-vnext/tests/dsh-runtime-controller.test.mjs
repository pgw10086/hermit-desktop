import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DshRuntimeController } from "../lib/runtime/dsh-runtime-controller.js";
import {
  RuntimeGenerationCatalog,
  RuntimeGenerationManager,
} from "../lib/runtime/generation-manager.js";
import { FileGenerationStateStore } from "../lib/runtime/generation-state-store.js";

class FakeSupervisor extends EventEmitter {
  constructor(generationId, events, failures) {
    super();
    this.generationId = generationId;
    this.events = events;
    this.failures = failures;
  }

  async start() {
    this.events.push(`start:${this.generationId}`);
    if (this.failures.has(this.generationId)) {
      const cause = new Error(`failed:${this.generationId}`);
      this.emit("unavailable", { generation: 1, cause });
      throw cause;
    }
    const url = new URL(`http://127.0.0.1:${this.generationId === "gen-a" ? "31001" : "31002"}`);
    this.emit("ready", { generation: 1, url });
    return url;
  }

  async stop() {
    this.events.push(`stop:${this.generationId}`);
  }

  async restart() {
    await this.stop();
    return this.start();
  }
}

function writeGeneration(root, generationId) {
  const target = path.join(root, generationId);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(
    path.join(target, "generation.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      generationId,
      runtimeVersion: generationId,
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
      dataEpoch: 1,
    })}\n`,
  );
}

test("真实 controller 用候选 supervisor 切换，失败时恢复旧 supervisor", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-controller-"));
  try {
    const generations = path.join(root, "generations");
    writeGeneration(generations, "gen-a");
    writeGeneration(generations, "gen-b");
    writeGeneration(generations, "gen-c");
    const manager = new RuntimeGenerationManager({
      catalog: new RuntimeGenerationCatalog([generations]),
      store: new FileGenerationStateStore(path.join(root, "activation-state.json")),
      initialGeneration: "gen-a",
    });
    const events = [];
    const failures = new Set(["gen-c"]);
    const controller = new DshRuntimeController({
      generationManager: manager,
      createSupervisor: (generation) =>
        new FakeSupervisor(generation?.manifest.generationId ?? "development", events, failures),
    });
    const readyEvents = [];
    controller.on("ready", ({ url }) => readyEvents.push(url.href));

    assert.equal((await controller.start()).port, "31001");
    assert.equal((await controller.activate("gen-b")).port, "31002");
    await assert.rejects(controller.activate("gen-c"), /restored gen-b/u);
    assert.deepEqual(events, [
      "start:gen-a",
      "stop:gen-a",
      "start:gen-b",
      "stop:gen-b",
      "start:gen-c",
      "start:gen-b",
    ]);
    assert.deepEqual(readyEvents, [
      "http://127.0.0.1:31001/",
      "http://127.0.0.1:31002/",
      "http://127.0.0.1:31002/",
    ]);
    await controller.stop();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("controller stop 失败时保留 supervisor，后续 restart 仍能继续回收", async () => {
  const events = [];
  let stopAttempts = 0;
  class RetrySupervisor extends FakeSupervisor {
    async stop() {
      stopAttempts += 1;
      events.push(`stop:${this.generationId}`);
      if (stopAttempts === 1) throw new Error("stop failed once");
    }
  }
  const controller = new DshRuntimeController({
    createSupervisor: () => new RetrySupervisor("development", events, new Set()),
  });
  await controller.start();
  await assert.rejects(controller.stop(), /stop failed once/u);
  assert.equal((await controller.restart()).port, "31002");
  assert.deepEqual(events, [
    "start:development",
    "stop:development",
    "stop:development",
    "start:development",
  ]);
});
