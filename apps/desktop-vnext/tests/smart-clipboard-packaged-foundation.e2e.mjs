import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { _electron as electron } from "playwright-core";

const appRoot = path.resolve(new URL("..", import.meta.url).pathname);
const executablePath = process.platform === "darwin"
  ? path.join(
      appRoot,
      "dist",
      process.arch === "arm64" ? "mac-arm64" : "mac",
      "Hermit.app",
      "Contents",
      "MacOS",
      "Hermit",
    )
  : "";

test("packaged Hermit 通过资格端口验证非侵入式 Clipboard foundation", {
  skip: process.platform !== "darwin"
    ? "当前只验证 macOS packaged foundation"
    : process.env.HERMIT_RUN_PACKAGED_CLIPBOARD_QUALIFICATION !== "1"
      ? "设置 HERMIT_RUN_PACKAGED_CLIPBOARD_QUALIFICATION=1 才运行 packaged 资格"
      : false,
  timeout: 90_000,
}, async () => {
  assert.equal(fs.existsSync(executablePath), true, `packaged Hermit 不存在: ${executablePath}`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-clipboard-foundation-"));
  const userData = path.join(root, "user-data");
  const application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userData}`, "--lang=zh-CN"],
    cwd: root,
    timeout: 60_000,
  });

  try {
    const appState = await application.evaluate(({ app }) => ({
      appPath: app.getAppPath(),
      executablePath: app.getPath("exe"),
      packaged: app.isPackaged,
    }));
    assert.equal(appState.packaged, true);
    assert.equal(fs.realpathSync(appState.executablePath), fs.realpathSync(executablePath));
    const providerPath = path.join(
      appState.appPath,
      "lib",
      "qualification",
      "smart-clipboard-foundation",
      "packaged-provider.js",
    );
    const report = await application.evaluate(async (_electron, input) => {
      const { createRequire } = process.getBuiltinModule("node:module");
      const requireFromApp = createRequire(`${input.appPath}/package.json`);
      const provider = requireFromApp(input.providerPath);
      return await provider.runNonDisruptivePackagedQualification(input.generation);
    }, {
      appPath: appState.appPath,
      providerPath,
      generation: "packaged-foundation-1",
    });

    assert.equal(report.schemaVersion, 1);
    assert.equal(report.generation, "packaged-foundation-1");
    assert.equal(fs.realpathSync(report.executablePath), fs.realpathSync(executablePath));
    const results = new Map(report.results.map((result) => [result.operation, result]));
    assert.equal(results.get("lock-listener-ownership").outcome, "qualified");
    assert.equal(
      results.get("lock-listener-ownership").details.lockListenersDuring,
      results.get("lock-listener-ownership").details.lockListenersBefore + 1,
    );
    assert.equal(results.get("activation-dispose").outcome, "qualified");
    assert.equal(results.get("activation-dispose").details.leaseActive, false);
    assert.equal(
      results.get("activation-dispose").details.shortcutRegisteredAfter,
      results.get("activation-dispose").details.shortcutRegisteredBefore,
    );
    assert.equal(results.get("macos-native-bridge-load").outcome, "qualified");
    assert.equal(results.get("clipboard-source-identity").outcome, "pending");
    assert.equal(results.get("clipboard-snapshot").outcome, "pending");
    assert.equal(results.get("clipboard-write-readback").outcome, "pending");
    assert.equal(results.get("clipboard-observe").semantics, "diagnostic");
    assert.equal(results.get("clipboard-observe").outcome, "pending");
    assert.equal(results.get("nspasteboard-access-behavior").outcome, "pending");
    assert.ok(new Set(["qualified", "blocked"]).has(
      results.get("accessibility-trust").outcome,
    ));
    assert.ok(new Set(["qualified", "blocked"]).has(
      results.get("shortcut-registration").outcome,
    ));

    const artifactDirectory = path.resolve(appRoot, "..", "..", ".hermit", "artifacts");
    fs.mkdirSync(artifactDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(
        artifactDirectory,
        `smart-clipboard-foundation-packaged-${process.platform}-${process.arch}.json`,
      ),
      `${JSON.stringify({
        ...report,
        generatedAt: new Date().toISOString(),
        candidate: { role: "unsigned-local-qualification", executablePath },
      }, null, 2)}\n`,
      "utf8",
    );
  } finally {
    await application.close().catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
