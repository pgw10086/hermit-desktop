import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const KNOWN_BLOCKED_TARGETS = new Set(["0.1.1-rc.2"]);

function packageRoot(packageName) {
  return path.dirname(require.resolve(`${packageName}/package.json`));
}

async function packageManifest(packageName) {
  const file = path.join(packageRoot(packageName), "package.json");
  return JSON.parse(await readFile(file, "utf8"));
}

function exportKeys(manifest) {
  if (manifest.exports === undefined) return [];
  return Object.keys(manifest.exports);
}

export async function inspectClientModuleHostContract() {
  const modulesManifest = await packageManifest("@deepseek-ai/dsh-client-modules");
  const webServerManifest = await packageManifest("@deepseek-ai/dsh-host-webserver");
  const modules = await import("@deepseek-ai/dsh-client-modules");
  const webServerSource = await readFile(
    path.join(packageRoot("@deepseek-ai/dsh-host-webserver"), "lib", "index.js"),
    "utf8",
  );

  const moduleExports = exportKeys(modulesManifest);
  const registryInject = [...(modules.ClientModuleRegistry?.inject ?? [])];
  const webServerListens = /\.listen\s*\(/u.test(webServerSource);
  const blocked = KNOWN_BLOCKED_TARGETS.has(modulesManifest.version)
    && registryInject.includes("webServer")
    && webServerListens;

  return {
    schemaVersion: 1,
    gate: "Q-CMOD-01",
    target: {
      clientModules: modulesManifest.version,
      hostWebServer: webServerManifest.version,
    },
    facts: {
      clientModuleExports: moduleExports,
      registryInject,
      stockWebServerListens: webServerListens,
      graphReaderExported: typeof modules.ClientModuleRegistry?.prototype?.graph === "function",
      bundleLookupExported: typeof modules.ClientModuleRegistry?.prototype?.clientPath === "function",
      bootInjectionsExported: typeof modules.bootInjections === "function",
    },
    status: blocked ? "blocked" : "review-required",
    blocker: blocked
      ? "发布物没有 transport-neutral Client module Host 入口，现有 Registry 依赖会监听端口的 webServer。"
      : undefined,
  };
}
