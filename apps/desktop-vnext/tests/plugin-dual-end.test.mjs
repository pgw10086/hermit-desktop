import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const appRoot = path.resolve(".");
const repositoryRoot = path.resolve(appRoot, "..", "..");
const pluginRoot = path.resolve("tests", "fixtures", "hermit-test-plugin");
const marker = "hermit-test-plugin-active";
const bundledNode = path.join(
  repositoryRoot,
  ".hermit",
  "runtime",
  "node",
  process.platform === "win32" ? "node.exe" : path.join("bin", "node"),
);
const bundledDsh = path.join(
  repositoryRoot,
  ".hermit",
  "runtime",
  "dsh",
  "node_modules",
  "@deepseek-ai",
  "dsh",
  "lib",
  "bin.js",
);
const bundledPnpm = path.join(
  repositoryRoot,
  ".hermit",
  "runtime",
  "dsh",
  "node_modules",
  ".bin",
  process.platform === "win32" ? "pnpm.CMD" : "pnpm",
);

function runPluginCommand(nodeBinary, dshEntry, home, workspace, args) {
  const result = spawnSync(nodeBinary, [dshEntry, "plugin", "--profile", "web", ...args], {
    cwd: workspace,
    env: runtimeEnv(nodeBinary, home),
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function runtimeEnv(nodeBinary, home) {
  const dshRoot = path.join(repositoryRoot, ".hermit", "runtime", "dsh");
  const inheritedPath = process.env.PATH ?? process.env.Path ?? "";
  const environment = {
    ...process.env,
    DSH_HOME: home,
    PATH: [
      path.dirname(nodeBinary),
      path.join(dshRoot, "node_modules", ".bin"),
      inheritedPath,
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

async function waitForReady(child) {
  let output = "";
  const deadline = Date.now() + 30_000;
  return await new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (Date.now() >= deadline) {
        clearInterval(timer);
        reject(new Error(`DSH did not become ready. Output: ${output}`));
      }
    }, 100);
    const inspect = (chunk) => {
      output += chunk.toString("utf8");
      const match = /\bdsh web:\s+(http:\/\/127\.0\.0\.1:\d+)/u.exec(output);
      if (match?.[1] === undefined) return;
      clearInterval(timer);
      resolve(new URL(match[1]));
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.once("error", (cause) => {
      clearInterval(timer);
      reject(cause);
    });
    child.once("exit", (code, signal) => {
      clearInterval(timer);
      reject(new Error(`DSH exited before ready (code=${String(code)}, signal=${String(signal)}). Output: ${output}`));
    });
  });
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  if (process.platform === "win32" && child.pid !== undefined) {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    await once(killer, "exit");
  } else {
    child.kill("SIGTERM");
  }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, 0);
      process.kill(-child.pid, "SIGKILL");
    } catch (cause) {
      if (cause?.code !== "ESRCH") throw cause;
    }
  }
}

async function assertPluginLifecycle({ label, nodeBinary, dshEntry, packagePath, root }) {
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });

  runPluginCommand(nodeBinary, dshEntry, home, workspace, ["add", packagePath]);
  const profilePath = path.join(home, "profiles", "web", "package.json");
  const installed = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  const dependencySpec = installed.dependencies["hermit-test-plugin"];
  assert.equal(typeof dependencySpec, "string");
  assert.ok(dependencySpec.startsWith("file:"), `${label} plugin dependency is not a file spec`);
  assert.ok(dependencySpec.endsWith(path.basename(packagePath)), `${label} plugin dependency points at another artifact`);
  assert.deepEqual(installed.dsh.profile.bundles, ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "hermit-test-plugin"]);

  const start = () => spawn(nodeBinary, [dshEntry, "web", "--host", "127.0.0.1", "--port", "0", "--no-open"], {
    cwd: workspace,
    env: runtimeEnv(nodeBinary, home),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });

  const first = start();
  try {
    const firstUrl = await waitForReady(first);
    const activeResponse = await fetch(new URL("/__hermit_test_plugin__", firstUrl));
    assert.equal(await activeResponse.text(), marker);
  } finally {
    await stopProcess(first);
  }

  const disabled = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  disabled.dsh.profile.bundles = disabled.dsh.profile.bundles.filter((name) => name !== "hermit-test-plugin");
  fs.writeFileSync(profilePath, `${JSON.stringify(disabled, null, 2)}\n`);
  const second = start();
  try {
    const secondUrl = await waitForReady(second);
    const disabledResponse = await fetch(new URL("/__hermit_test_plugin__", secondUrl));
    assert.notEqual(await disabledResponse.text(), marker);
  } finally {
    await stopProcess(second);
  }

  runPluginCommand(nodeBinary, dshEntry, home, workspace, ["remove", "hermit-test-plugin"]);
  const removed = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  assert.equal(removed.dependencies?.["hermit-test-plugin"], undefined);
  assert.equal(removed.dsh.profile.bundles.includes("hermit-test-plugin"), false);
}

test("同一个 .tgz 插件在 stock DSH 和 Hermit bundled DSH 完成安装、启动、停用、卸载", {
  timeout: 180_000,
  skip: fs.existsSync(bundledNode) && fs.existsSync(bundledDsh)
    ? false
    : "bundled runtime 未准备；先运行 prepare:node-runtime 和 prepare:dsh-runtime",
}, async () => {
  assert.equal(
    fs.existsSync(bundledPnpm),
    true,
    "Hermit bundled DSH 必须携带 pnpm，安装后才能执行公开的 dsh plugin 命令",
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-plugin-dual-end-"));
  try {
    const packageOutput = path.join(root, "package");
    fs.mkdirSync(packageOutput, { recursive: true });
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    const packed = spawnSync(npmCommand, ["pack", "--pack-destination", packageOutput, "--ignore-scripts"], {
      cwd: pluginRoot,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(packed.status, 0, `plugin pack failed: ${packed.stderr}`);
    const tarball = fs.readdirSync(packageOutput).find((name) => name.endsWith(".tgz"));
    assert.ok(tarball !== undefined, "plugin pack did not produce a tarball");
    const packagePath = path.join(packageOutput, tarball);

    await assertPluginLifecycle({
      label: "stock DSH",
      nodeBinary: process.execPath,
      dshEntry: path.join(repositoryRoot, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
      packagePath,
      root: path.join(root, "stock"),
    });
    await assertPluginLifecycle({
      label: "Hermit bundled DSH",
      nodeBinary: bundledNode,
      dshEntry: bundledDsh,
      packagePath,
      root: path.join(root, "hermit"),
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
