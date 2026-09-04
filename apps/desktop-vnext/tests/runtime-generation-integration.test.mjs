import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createDshCommand } from "../lib/runtime/dsh-command.js";
import {
  DshRuntimeController,
  DshSupervisor,
  FileGenerationStateStore,
  RuntimeGenerationCatalog,
  RuntimeGenerationManager,
} from "@platform/desktop-core";

const appRoot = path.resolve(".");
const repositoryRoot = path.resolve(appRoot, "..", "..");
const runtimeSource = path.join(repositoryRoot, ".hermit", "runtime");
const sourceNode = path.join(runtimeSource, "node");
const sourceDsh = path.join(runtimeSource, "dsh");
const bundledNode = path.join(
  sourceNode,
  process.platform === "win32" ? "node.exe" : path.join("bin", "node"),
);
const bundledDsh = path.join(
  sourceDsh,
  "node_modules",
  "@deepseek-ai",
  "dsh",
  "lib",
  "bin.js",
);
const pluginRoot = path.resolve("tests", "fixtures", "hermit-test-plugin");
const pluginMarker = "hermit-test-plugin-active";

function runtimeEnvironment(nodeBinary, dshRoot, home) {
  const environment = {
    ...process.env,
    DSH_HOME: home,
    PATH: [
      path.dirname(nodeBinary),
      path.join(dshRoot, "node_modules", ".bin"),
      process.env.PATH ?? process.env.Path ?? "",
    ].filter(Boolean).join(path.delimiter),
  };
  delete environment.Path;
  delete environment.NODE_OPTIONS;
  delete environment.NODE_PATH;
  delete environment.node_path;
  delete environment.PNPM_HOME;
  delete environment.COREPACK_HOME;
  for (const key of Object.keys(environment)) {
    const normalized = key.toLowerCase();
    if (
      normalized === "npm_execpath" ||
      normalized === "npm_node_execpath" ||
      normalized.startsWith("npm_config_") ||
      normalized.startsWith("pnpm_config_")
    ) {
      delete environment[key];
    }
  }
  return environment;
}

function writeGeneration(generationsRoot, generationId) {
  const root = path.join(generationsRoot, generationId);
  fs.mkdirSync(root, { recursive: true });
  const linkType = process.platform === "win32" ? "junction" : "dir";
  fs.symlinkSync(sourceNode, path.join(root, "node"), linkType);
  fs.symlinkSync(sourceDsh, path.join(root, "dsh"), linkType);
  fs.writeFileSync(
    path.join(root, "generation.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      generationId,
      runtimeVersion: `m1-${generationId}`,
      nodeVersion: "24.19.0",
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
    }, null, 2)}\n`,
  );
  return root;
}

function packPlugin(output) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(
    npmCommand,
    ["pack", "--pack-destination", output, "--ignore-scripts"],
    { cwd: pluginRoot, encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  const tarball = fs.readdirSync(output).find((name) => name.endsWith(".tgz"));
  assert.ok(tarball !== undefined);
  return path.join(output, tarball);
}

async function assertPluginActive(url) {
  const response = await fetch(new URL("/__hermit_test_plugin__", url));
  assert.equal(await response.text(), pluginMarker);
}

test("真实 bundled DSH 在 A→B→重启→A 回滚中保留同一个 DSH_HOME 数据", {
  timeout: 180_000,
  skip: fs.existsSync(bundledNode) && fs.existsSync(bundledDsh)
    ? false
    : "bundled runtime 未准备；先运行 prepare:runtime",
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-generation-integration-"));
  let controller;
  try {
    const generationsRoot = path.join(root, "generations");
    const generationA = writeGeneration(generationsRoot, "gen-a");
    writeGeneration(generationsRoot, "gen-b");
    const home = path.join(root, "dsh-home");
    const workspace = path.join(root, "workspace");
    const packageOutput = path.join(root, "package");
    fs.mkdirSync(workspace, { recursive: true });
    fs.mkdirSync(packageOutput, { recursive: true });

    const packagePath = packPlugin(packageOutput);
    const nodeA = path.join(
      generationA,
      "node",
      process.platform === "win32" ? "node.exe" : path.join("bin", "node"),
    );
    const dshA = path.join(
      generationA,
      "dsh",
      "node_modules",
      "@deepseek-ai",
      "dsh",
      "lib",
      "bin.js",
    );
    const add = spawnSync(
      nodeA,
      [dshA, "plugin", "--profile", "web", "add", packagePath],
      {
        cwd: workspace,
        env: runtimeEnvironment(nodeA, path.join(generationA, "dsh"), home),
        encoding: "utf8",
        windowsHide: true,
      },
    );
    assert.equal(add.status, 0, `${add.stdout}\n${add.stderr}`);

    const manager = new RuntimeGenerationManager({
      catalog: new RuntimeGenerationCatalog([generationsRoot]),
      store: new FileGenerationStateStore(path.join(root, "activation-state.json")),
      initialGeneration: "gen-a",
    });
    const createController = () =>
      new DshRuntimeController({
        generationManager: manager,
        createSupervisor: (generation) =>
          new DshSupervisor({
            command: createDshCommand({
              isPackaged: true,
              resourcesPath: root,
              runtimeRoot: generation.root,
              profileHome: home,
              workspacePath: workspace,
              carrierEntry: path.resolve("lib", "runtime", "dsh-carrier.js"),
              environment: runtimeEnvironment(
                path.join(
                  generation.root,
                  "node",
                  process.platform === "win32" ? "node.exe" : path.join("bin", "node"),
                ),
                path.join(generation.root, "dsh"),
                home,
              ),
            }),
            readyTimeoutMs: 30_000,
            shutdownTimeoutMs: 6_000,
            maxRestarts: 0,
          }),
      });

    controller = createController();
    await assertPluginActive(await controller.start());
    await assertPluginActive(await controller.activate("gen-b"));
    assert.equal(manager.initialize().committedGeneration, "gen-b");

    await controller.stop();
    controller = createController();
    await assertPluginActive(await controller.start());
    await assertPluginActive(await controller.rollback());
    assert.equal(manager.initialize().committedGeneration, "gen-a");
  } finally {
    await controller?.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
