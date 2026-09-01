import assert from "node:assert/strict";
import test from "node:test";
import {
  activateSmartClipboardFoundation,
  FOUNDATION_SHORTCUT,
} from "../lib/qualification/smart-clipboard-foundation/fixture.js";

test("无 provider 时返回确定性 unavailable，且不偷偷使用 Electron fallback", async () => {
  assert.deepEqual(
    await activateSmartClipboardFoundation("generation-1", {}, observer()),
    {
      status: "unavailable",
      reason: "clipboard-provider",
      detail: "Clipboard qualification provider 不存在",
    },
  );
});

test("activation 资源归属同一 generation，dispose 后晚到事件失效且不影响下一代", async () => {
  const firstEvents = [];
  const firstProviders = fakeProviders();
  const first = await activateSmartClipboardFoundation(
    "generation-1",
    firstProviders.dependencies,
    observer(firstEvents),
  );
  assert.equal(first.status, "active");
  assert.equal(first.lease.generation, "generation-1");
  assert.equal(first.initialLocked, false);
  assert.equal(firstProviders.shortcut.accelerator, FOUNDATION_SHORTCUT);

  firstProviders.clipboard.emit(1);
  firstProviders.shortcut.trigger();
  firstProviders.lock.emit(true);
  assert.deepEqual(firstEvents, ["clipboard:1", "shortcut", "lock:true"]);

  await first.lease.dispose();
  await first.lease.dispose();
  assert.deepEqual(firstProviders.disposals, ["shortcut", "lock", "clipboard"]);

  firstProviders.clipboard.emit(2);
  firstProviders.shortcut.trigger();
  firstProviders.lock.emit(false);
  assert.deepEqual(firstEvents, ["clipboard:1", "shortcut", "lock:true"]);

  const secondEvents = [];
  const secondProviders = fakeProviders();
  const second = await activateSmartClipboardFoundation(
    "generation-2",
    secondProviders.dependencies,
    observer(secondEvents),
  );
  assert.equal(second.status, "active");
  firstProviders.clipboard.emit(3);
  secondProviders.clipboard.emit(4);
  assert.deepEqual(firstEvents, ["clipboard:1", "shortcut", "lock:true"]);
  assert.deepEqual(secondEvents, ["clipboard:4"]);
  await second.lease.dispose();
});

test("shortcut 注册失败时清理此前已获得的 observer，不制造假 binding", async () => {
  const providers = fakeProviders({ shortcutAvailable: false });
  const activation = await activateSmartClipboardFoundation(
    "generation-1",
    providers.dependencies,
    observer(),
  );

  assert.deepEqual(activation, {
    status: "unavailable",
    reason: "shortcut-registration",
    detail: "快捷键被占用",
  });
  assert.deepEqual(providers.disposals, ["lock", "clipboard"]);
});

test("activation 中途抛错时仍回收已经注册的资源", async () => {
  const providers = fakeProviders({ lockThrows: true });
  await assert.rejects(
    activateSmartClipboardFoundation("generation-1", providers.dependencies, observer()),
    /lock observe failed/u,
  );
  assert.deepEqual(providers.disposals, ["clipboard"]);
});

function observer(events = []) {
  return {
    clipboardChanged: (generation) => events.push(`clipboard:${String(generation)}`),
    shortcutTriggered: () => events.push("shortcut"),
    lockChanged: (locked) => events.push(`lock:${String(locked)}`),
  };
}

function fakeProviders(options = {}) {
  const disposals = [];
  let clipboardListener = () => undefined;
  let shortcutListener = () => undefined;
  let lockListener = () => undefined;
  const clipboard = {
    observe(listener) {
      clipboardListener = listener;
      return { dispose: () => disposals.push("clipboard") };
    },
    snapshot: async () => ({ generation: 1, text: "fixture" }),
    write: async () => ({ status: "written", generation: 2 }),
    sourceIdentity: async () => ({ applicationName: "Fixture" }),
    autoPaste: async () => ({ status: "copy-only", reason: "fixture" }),
    emit: (generation) => clipboardListener(generation),
  };
  const shortcut = {
    accelerator: undefined,
    register(accelerator, listener) {
      this.accelerator = accelerator;
      shortcutListener = listener;
      return options.shortcutAvailable === false
        ? { status: "unavailable", reason: "快捷键被占用" }
        : { status: "registered", binding: { dispose: () => disposals.push("shortcut") } };
    },
    trigger: () => shortcutListener(),
  };
  const lock = {
    isLocked: () => false,
    observe(listener) {
      if (options.lockThrows === true) throw new Error("lock observe failed");
      lockListener = listener;
      return { dispose: () => disposals.push("lock") };
    },
    emit: (locked) => lockListener(locked),
  };
  return {
    dependencies: { clipboard, shortcut, lock },
    clipboard,
    shortcut,
    lock,
    disposals,
  };
}
