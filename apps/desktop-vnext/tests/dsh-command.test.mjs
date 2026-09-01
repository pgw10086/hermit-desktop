import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDshCommand } from "../lib/runtime/dsh-command.js";

test("打包运行时使用 bundled Node 和标准 node_modules，并清理开发环境路径", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-dsh-command-"));
  const resources = path.join(root, "resources");
  const runtimeRoot = path.join(resources, "runtime", "generations", "bundled");
  const nodeRoot = path.join(runtimeRoot, "node");
  const dshRoot = path.join(runtimeRoot, "dsh");
  const carrierEntry = path.join(resources, "runtime", "carrier", "dsh-carrier.js");
  const nodeBinary = process.platform === "win32" ? path.join(nodeRoot, "node.exe") : path.join(nodeRoot, "bin", "node");
  fs.mkdirSync(path.dirname(nodeBinary), { recursive: true });
  fs.mkdirSync(path.join(dshRoot, "node_modules", "@deepseek-ai", "dsh", "lib"), {
    recursive: true,
  });
  fs.writeFileSync(nodeBinary, "bundled node");
  fs.mkdirSync(path.dirname(carrierEntry), { recursive: true });
  fs.writeFileSync(carrierEntry, "carrier");
  fs.writeFileSync(
    path.join(dshRoot, "node_modules", "@deepseek-ai", "dsh", "package.json"),
    JSON.stringify({ bin: { dsh: "lib/bin.js" } }),
  );
  fs.writeFileSync(
    path.join(dshRoot, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
    "",
  );

  const command = createDshCommand({
    isPackaged: true,
    resourcesPath: resources,
    profileHome: path.join(root, "profile"),
    workspacePath: path.join(root, "workspace"),
    runtimeRoot,
    environment: {
      PATH: "/usr/bin",
      NODE_OPTIONS: "--inspect",
      NODE_PATH: "/tmp/injected-node-path",
      PNPM_HOME: "/tmp/pnpm-home",
      COREPACK_HOME: "/tmp/corepack-home",
      npm_config_registry: "https://example.invalid",
      pnpm_config_store_dir: "/tmp/pnpm-store",
      HTTP_PROXY: "http://127.0.0.1:7897",
    },
  });

  assert.equal(command.executable, nodeBinary);
  assert.equal(command.args[0], carrierEntry);
  assert.equal(command.args[1], path.join(dshRoot, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"));
  assert.equal(command.args.slice(2).join(" "), "web --host 127.0.0.1 --port 0 --no-open");
  assert.equal(command.stopViaStdin, true);
  assert.equal(command.env.DSH_HOME, path.join(root, "profile"));
  assert.equal(command.env.NODE_PATH, undefined);
  assert.equal(command.env.NODE_OPTIONS, undefined);
  assert.equal(command.env.PNPM_HOME, undefined);
  assert.equal(command.env.COREPACK_HOME, undefined);
  assert.equal(command.env.npm_config_registry, undefined);
  assert.equal(command.env.pnpm_config_store_dir, undefined);
  assert.equal(command.env.HTTP_PROXY, "http://127.0.0.1:7897");
  assert.equal(command.env.Path, undefined);
  assert.deepEqual((command.env.PATH ?? "").split(path.delimiter), [
    path.dirname(nodeBinary),
    path.join(dshRoot, "node_modules", ".bin"),
    "/usr/bin",
  ]);

  fs.rmSync(root, { recursive: true, force: true });
});
