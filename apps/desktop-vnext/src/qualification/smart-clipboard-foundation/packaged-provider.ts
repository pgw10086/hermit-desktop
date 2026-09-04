import {
  app,
  globalShortcut,
  powerMonitor,
  systemPreferences,
} from "electron";
import { createRequire } from "node:module";
import path from "node:path";
import { ActivationLease } from "@platform/agent-desktop-core";
import { FOUNDATION_SHORTCUT } from "./fixture.js";
import type {
  QualificationResult,
  SmartClipboardPackagedQualificationReport,
} from "./qualification-result.js";

/**
 * 只运行不会读取或改写 General Pasteboard 的成品资格。
 * Clipboard read/write/observe 必须进入用户明确确认的 disposable clipboard 测试。
 */
export async function runNonDisruptivePackagedQualification(
  generation: string,
): Promise<SmartClipboardPackagedQualificationReport> {
  if (!app.isPackaged) throw new Error("该资格只能在 packaged Hermit 主进程中运行");

  const lease = new ActivationLease(generation);
  const results: QualificationResult[] = [];
  const lockListenerCount = powerMonitor.listenerCount("lock-screen");
  const unlockListenerCount = powerMonitor.listenerCount("unlock-screen");
  const onLock = lease.guard(() => undefined);
  const onUnlock = lease.guard(() => undefined);
  powerMonitor.on("lock-screen", onLock);
  powerMonitor.on("unlock-screen", onUnlock);
  lease.own(() => {
    powerMonitor.removeListener("unlock-screen", onUnlock);
    powerMonitor.removeListener("lock-screen", onLock);
  });

  results.push(result("lock-listener-ownership", "qualified", {
    lockListenersBefore: lockListenerCount,
    lockListenersDuring: powerMonitor.listenerCount("lock-screen"),
    unlockListenersBefore: unlockListenerCount,
    unlockListenersDuring: powerMonitor.listenerCount("unlock-screen"),
  }));

  const shortcutRegisteredBefore = globalShortcut.isRegistered(FOUNDATION_SHORTCUT);
  const shortcutAccepted = globalShortcut.register(FOUNDATION_SHORTCUT, lease.guard(() => undefined));
  const shortcutRegistered = shortcutAccepted && globalShortcut.isRegistered(FOUNDATION_SHORTCUT);
  if (shortcutRegistered) {
    lease.own(() => globalShortcut.unregister(FOUNDATION_SHORTCUT));
    results.push(result("shortcut-registration", "qualified", {
      accelerator: FOUNDATION_SHORTCUT,
      accepted: shortcutAccepted,
      registered: shortcutRegistered,
    }));
  } else {
    results.push(result("shortcut-registration", "blocked", {
      accelerator: FOUNDATION_SHORTCUT,
      accepted: shortcutAccepted,
      registered: shortcutRegistered,
    }, "shortcut-conflict-or-system-rejection"));
  }

  const accessibilityTrusted = process.platform === "darwin"
    ? systemPreferences.isTrustedAccessibilityClient(false)
    : false;
  results.push(accessibilityTrusted
    ? result("accessibility-trust", "qualified", { trusted: true })
    : result(
        "accessibility-trust",
        "blocked",
        { trusted: false },
        "accessibility-not-trusted",
      ));
  results.push(accessibilityTrusted
    ? result(
        "auto-paste-policy",
        "pending",
        { senderInvoked: false },
        "trusted-sender-not-qualified",
      )
    : result("auto-paste-policy", "qualified", {
        senderInvoked: false,
        selectedBehavior: "copy-only-required",
      }));

  const nativeModulePath = path.join(
    process.resourcesPath,
    "runtime",
    "native",
    "hermit_macos_clipboard_bridge.node",
  );
  const nativeAddon = createRequire(import.meta.url)(nativeModulePath) as Record<string, unknown>;
  const nativeOperations = [
    "readStableSnapshot",
    "writeSnapshot",
    "captureFrontmostApplication",
    "requestActivate",
    "postPasteIfCurrent",
  ];
  const nativeLoaded = nativeOperations.every((operation) => typeof nativeAddon[operation] === "function");
  results.push(result(
    "macos-native-bridge-load",
    nativeLoaded ? "qualified" : "blocked",
    { modulePath: nativeModulePath, operations: nativeOperations.join(",") },
    nativeLoaded ? undefined : "native-exports-incomplete",
  ));

  results.push(result(
    "clipboard-source-identity",
    "pending",
    { nativeBridgeLoaded: nativeLoaded, basis: "explicit-marker-or-frontmost-sample" },
    "requires-disposable-clipboard-session",
  ));
  results.push(result(
    "clipboard-snapshot",
    "pending",
    undefined,
    "requires-disposable-clipboard-session",
  ));
  results.push(result(
    "clipboard-write-readback",
    "pending",
    undefined,
    "would-mutate-user-general-pasteboard",
  ));
  results.push({
    ...result(
      "clipboard-observe",
      "pending",
      undefined,
      "diagnostic-polling-not-exercised",
    ),
    semantics: "diagnostic",
  });
  results.push(result(
    "nspasteboard-change-count",
    "pending",
    { nativeBridgeLoaded: nativeLoaded },
    "would-read-user-general-pasteboard",
  ));
  results.push(result(
    "nspasteboard-access-behavior",
    "pending",
    { nativeBridgeLoaded: nativeLoaded },
    "requires-disposable-clipboard-session",
  ));
  results.push(result(
    "shortcut-physical-dispatch",
    "pending",
    undefined,
    "physical-key-event-not-exercised",
  ));
  results.push(result(
    "os-lock-event-delivery",
    "pending",
    undefined,
    "real-lock-not-triggered",
  ));

  await lease.dispose();
  const shortcutRegisteredAfter = globalShortcut.isRegistered(FOUNDATION_SHORTCUT);
  const activationRestored = powerMonitor.listenerCount("lock-screen") === lockListenerCount
    && powerMonitor.listenerCount("unlock-screen") === unlockListenerCount
    && shortcutRegisteredAfter === shortcutRegisteredBefore;
  results.push(result("activation-dispose", activationRestored ? "qualified" : "blocked", {
    generation,
    leaseActive: lease.active,
    lockListenersAfter: powerMonitor.listenerCount("lock-screen"),
    unlockListenersAfter: powerMonitor.listenerCount("unlock-screen"),
    shortcutRegisteredBefore,
    shortcutRegisteredAfter,
  }, activationRestored ? undefined : "activation-state-not-restored"));

  return {
    schemaVersion: 1,
    generation,
    executablePath: app.getPath("exe"),
    results,
  };
}

/** 构造 packaged 资格报告中的精确或阻塞结果。 */
function result(
  operation: string,
  outcome: QualificationResult["outcome"],
  details?: QualificationResult["details"],
  reason?: string,
): QualificationResult {
  return {
    operation,
    outcome,
    semantics: "exact",
    subject: "hermit-packaged-process",
    ...(reason === undefined ? {} : { reason }),
    ...(details === undefined ? {} : { details }),
  };
}
