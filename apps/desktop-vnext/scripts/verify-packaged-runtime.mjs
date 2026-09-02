import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateProductSurfacePatch, validateRuntimeClosure } from "./after-pack.mjs";
import { validateForegroundSessionNavigationPatch } from "./dsh-foreground-session-navigation-patch.mjs";
import { bundledGenerationRoot, defaultResourcesPath } from "./runtime-paths.mjs";
import { readDshUpstreamRegistry } from "../../../scripts/dsh-upstream.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
const repositoryRoot = path.resolve(appRoot, "..", "..");
const explicitResourcesPath = process.argv[2] === "--" ? process.argv[3] : process.argv[2];
const resourcesPath = path.resolve(
  explicitResourcesPath ?? defaultResourcesPath(appRoot, process.platform, process.arch),
);
const runtimeRoot = bundledGenerationRoot(resourcesPath);
const carrierEntry = path.join(resourcesPath, "runtime", "carrier", "dsh-carrier.js");
const generationManifest = JSON.parse(
  fs.readFileSync(path.join(runtimeRoot, "generation.json"), "utf8"),
);
if (generationManifest.generationId !== "bundled" || generationManifest.dataEpoch !== 1) {
  throw new Error("Packaged runtime generation manifest is invalid");
}
const nodeBinary = path.join(
  runtimeRoot,
  "node",
  process.platform === "win32" ? "node.exe" : path.join("bin", "node"),
);
const dshEntry = validateRuntimeClosure(path.join(runtimeRoot, "dsh")).entry;
const productSurfacePatch = validateProductSurfacePatch(path.join(runtimeRoot, "dsh"));
if (JSON.stringify(generationManifest.productSurfacePatch) !== JSON.stringify(productSurfacePatch)) {
  throw new Error("Packaged Product Surface patch does not match generation.json");
}
const foregroundSessionNavigationPatch = validateForegroundSessionNavigationPatch(path.join(runtimeRoot, "dsh"));
if (
  JSON.stringify(generationManifest.foregroundSessionNavigationPatch) !==
  JSON.stringify(foregroundSessionNavigationPatch)
) {
  throw new Error("Packaged foreground session navigation patch does not match generation.json");
}
const runtimeManifest = JSON.parse(
  fs.readFileSync(path.join(runtimeRoot, "dsh", "hermit-runtime.json"), "utf8"),
);
const dshUpstream = readDshUpstreamRegistry(repositoryRoot);
if (
  JSON.stringify(generationManifest.dshUpstream) !== JSON.stringify(runtimeManifest.dshUpstream) ||
  runtimeManifest.artifactMode !== "packed-tarball-v1" ||
  generationManifest.dshUpstream?.packageVersion !== generationManifest.dshVersion ||
  generationManifest.dshUpstream?.commit !== dshUpstream.upstreamCommit ||
  generationManifest.dshUpstream?.snapshotChecksum !== dshUpstream.snapshotChecksum
) {
  throw new Error("Packaged DSH upstream cohort does not match the runtime closure");
}
const nativeAddon = path.join(resourcesPath, "runtime", "native", "hermit_macos_clipboard_bridge.node");
if (process.platform === "darwin") {
  const nativeManifestPath = path.join(resourcesPath, "runtime", "native", "manifest.json");
  const nativeManifest = JSON.parse(fs.readFileSync(nativeManifestPath, "utf8"));
  const expectedNativeEvidence = {
    electronVersion: nativeManifest.electronVersion,
    napiVersion: nativeManifest.napiVersion,
    architecture: nativeManifest.architecture,
    preSignSha256: nativeManifest.sha256,
  };
  if (JSON.stringify(generationManifest.macosClipboardBridge) !== JSON.stringify(expectedNativeEvidence)) {
    throw new Error("Packaged macOS Clipboard bridge evidence does not match generation.json");
  }
}
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "hermit-m1-packaged-"));

const requiredFiles = [
  ["bundled Node", nodeBinary],
  ["bundled DSH", dshEntry],
  ["Hermit DSH carrier", carrierEntry],
];
if (process.platform === "darwin") requiredFiles.push(["macOS Clipboard bridge", nativeAddon]);
for (const [label, file] of requiredFiles) {
  if (!fs.existsSync(file)) throw new Error(`${label} is missing: ${file}`);
}

const env = {
  ...process.env,
  DSH_HOME: path.join(cwd, "dsh-home"),
  PATH: [
    path.dirname(nodeBinary),
    path.join(runtimeRoot, "dsh", "node_modules", ".bin"),
  ].join(path.delimiter),
};
delete env.Path;
delete env.NODE_PATH;
delete env.node_path;
delete env.PNPM_HOME;
delete env.NODE_OPTIONS;
delete env.COREPACK_HOME;
for (const key of Object.keys(env)) {
  const normalized = key.toLowerCase();
  if (
    normalized === "npm_execpath" ||
    normalized === "npm_node_execpath" ||
    normalized.startsWith("npm_config_") ||
    normalized.startsWith("pnpm_config_")
  ) {
    delete env[key];
  }
}

const child = spawn(
  nodeBinary,
  [dshEntry, "web", "--host", "127.0.0.1", "--port", "0", "--no-open"],
  {
    cwd,
    env,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let output = "";
let settled = false;
const deadline = Date.now() + 30_000;
const readyPattern = /\bdsh web:\s+(http:\/\/127\.0\.0\.1:\d+)/u;

function stop() {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  if (process.platform === "win32" && child.pid !== undefined) {
    const killer = spawn(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true },
    );
    killer.unref();
  } else {
    child.kill("SIGTERM");
  }
  return Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 6_000)),
  ]).then(async () => {
    if (process.platform === "win32" || child.pid === undefined) return;
    try {
      process.kill(-child.pid, 0);
    } catch (cause) {
      if (cause?.code === "ESRCH") return;
      throw cause;
    }
    process.kill(-child.pid, "SIGKILL");
    if (!(await waitForProcessGroupExit(child.pid, 2_000))) {
      throw new Error(`Packaged DSH process group ${String(child.pid)} is still running`);
    }
  });
}

async function waitForProcessGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(-pid, 0);
    } catch (cause) {
      if (cause?.code === "ESRCH") return true;
      throw cause;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

let ready;
try {
  ready = await new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (Date.now() >= deadline) {
        clearInterval(timer);
        reject(new Error(`Packaged DSH did not become ready. Output: ${output}`));
      }
    }, 100);

    const inspect = (chunk) => {
      output += chunk.toString("utf8");
      const match = readyPattern.exec(output);
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
      if (settled) return;
      clearInterval(timer);
      reject(
        new Error(
          `Packaged DSH exited before ready (code=${String(code)}, signal=${String(signal)}). Output: ${output}`,
        ),
      );
    });
  });

  const response = await fetch(ready);
  if (response.status < 200 || response.status >= 400) {
    throw new Error(`Packaged DSH returned unexpected HTTP status ${String(response.status)}`);
  }
  await response.body?.cancel();
  console.log(`Packaged DSH ready at ${ready.origin}`);
} finally {
  settled = true;
  await stop();
  try {
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    console.warn(`Unable to remove smoke directory ${cwd}: ${error.message}`);
  }
}
