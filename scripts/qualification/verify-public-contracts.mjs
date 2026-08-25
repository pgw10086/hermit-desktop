import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const require = createRequire(import.meta.url);
const EXPECTED_VERSION = "0.1.1-rc.2";
const EXPECTED_NODE = "v24.19.0";
const EXPECTED_PNPM = "11.7.0";
const EXPECTED_REACT = "18.3.1";
const EXPECTED_LOCK_SHA256 = "1d69a486fdd19457cdbbdaad62bacb8b431fdc0981f21f9765a1de5542800a45";
const EXPECTED_DSH_PACKAGE_COUNT = 189;

const PACKAGES = [
  "@deepseek-ai/dsh",
  "@deepseek-ai/dsh-app-boot",
  "@deepseek-ai/dsh-client-connection",
  "@deepseek-ai/dsh-client-modules",
  "@deepseek-ai/dsh-client-web",
  "@deepseek-ai/dsh-host-apiproxy",
  "@deepseek-ai/dsh-host-webserver",
  "@deepseek-ai/dsh-web-app",
  "@deepseek-ai/dsh-web-frontend",
];

async function manifest(packageName) {
  const file = require.resolve(`${packageName}/package.json`);
  return JSON.parse(await readFile(file, "utf8"));
}

function packageRoot(packageName) {
  return path.dirname(require.resolve(`${packageName}/package.json`));
}

function parseDshPackageKey(key) {
  const match = /^(@deepseek-ai\/dsh(?:-[^@]+)?)@([^()]+)(?:\(|$)/u.exec(key);
  return match === null ? undefined : { name: match[1], version: match[2] };
}

async function verifyLockfile() {
  const lockPath = path.resolve("pnpm-lock.yaml");
  const source = await readFile(lockPath, "utf8");
  const lock = parseYaml(source);
  const packageEntries = Object.entries(lock.packages ?? {});
  const dshPackages = [];
  const reactVersions = new Set();
  const reactDomVersions = new Set();

  for (const [key, value] of packageEntries) {
    const dsh = parseDshPackageKey(key);
    if (dsh !== undefined) {
      assert.equal(dsh.version, EXPECTED_VERSION, `${dsh.name} left the release train`);
      assert.match(
        value.resolution?.integrity ?? "",
        /^sha512-[A-Za-z0-9+/]{86}==$/u,
        `${dsh.name} has no valid SHA-512 integrity`,
      );
      dshPackages.push(dsh.name);
    }
    const react = /^react@([^()]+)(?:\(|$)/u.exec(key)?.[1];
    const reactDom = /^react-dom@([^()]+)(?:\(|$)/u.exec(key)?.[1];
    if (react !== undefined) reactVersions.add(react);
    if (reactDom !== undefined) reactDomVersions.add(reactDom);
  }

  assert.equal(dshPackages.length, EXPECTED_DSH_PACKAGE_COUNT, "DSH closure package count drifted");
  assert.deepEqual([...reactVersions], [EXPECTED_REACT]);
  assert.deepEqual([...reactDomVersions], [EXPECTED_REACT]);

  const sha256 = createHash("sha256").update(source).digest("hex");
  assert.equal(sha256, EXPECTED_LOCK_SHA256, "qualification lockfile drifted");

  return {
    sha256,
    dshPackageCount: dshPackages.length,
    reactVersions: [...reactVersions],
    reactDomVersions: [...reactDomVersions],
  };
}

export async function verifyPublicContracts() {
  assert.equal(process.version, EXPECTED_NODE, "qualification must use the pinned Node runtime");
  const pnpmVersion = /pnpm\/([^\s]+)/u.exec(process.env.npm_config_user_agent ?? "")?.[1];
  assert.equal(pnpmVersion, EXPECTED_PNPM, "qualification must use the pinned pnpm runtime");
  const workspaceManifest = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
  assert.equal(workspaceManifest.packageManager, `pnpm@${EXPECTED_PNPM}`);
  assert.equal(workspaceManifest.engines?.node, EXPECTED_NODE.slice(1));
  for (const packageName of PACKAGES) {
    assert.equal(
      workspaceManifest.devDependencies?.[packageName],
      EXPECTED_VERSION,
      `${packageName} must be an exact direct qualification dependency`,
    );
  }
  assert.equal(workspaceManifest.devDependencies?.react, EXPECTED_REACT);
  assert.equal(workspaceManifest.devDependencies?.["react-dom"], EXPECTED_REACT);

  const versions = {};
  for (const packageName of PACKAGES) {
    const pkg = await manifest(packageName);
    assert.equal(pkg.version, EXPECTED_VERSION, `${packageName} version drifted`);
    versions[packageName] = pkg.version;
  }

  const appBoot = await import("@deepseek-ai/dsh-app-boot");
  const modules = await import("@deepseek-ai/dsh-client-modules");
  const apiProxy = await import("@deepseek-ai/dsh-host-apiproxy");
  const apiProxyClient = await import("@deepseek-ai/dsh-host-apiproxy/client");
  const webServer = await import("@deepseek-ai/dsh-host-webserver");
  const react = await manifest("react");
  const reactDom = await manifest("react-dom");

  assert.equal(typeof appBoot.boot, "function");
  assert.equal(typeof modules.bootInjections, "function");
  assert.equal(typeof modules.orderByModuleGraph, "function");
  assert.equal(typeof apiProxy.createApiProxy, "function");
  assert.equal(typeof apiProxy.toFetchHandler, "function");
  assert.equal(typeof apiProxyClient.AbstractApiClient, "function");
  assert.equal(typeof apiProxyClient.InProcessApiClient, "function");
  assert.equal(typeof webServer.WebServer, "function");
  assert.equal(typeof webServer.renderIndexInjections, "function");
  assert.equal(react.version, EXPECTED_REACT);
  assert.equal(reactDom.version, EXPECTED_REACT);

  const lockfile = await verifyLockfile();

  return {
    schemaVersion: 1,
    target: EXPECTED_VERSION,
    toolchain: {
      node: process.version,
      pnpm: pnpmVersion,
      react: react.version,
      reactDom: reactDom.version,
    },
    lockfile,
    versions,
    runtimeExports: [
      "app-boot.boot",
      "client-modules.bootInjections",
      "client-modules.orderByModuleGraph",
      "host-apiproxy.createApiProxy",
      "host-apiproxy.toFetchHandler",
      "host-apiproxy/client.AbstractApiClient",
      "host-apiproxy/client.InProcessApiClient",
      "host-webserver.WebServer",
      "host-webserver.renderIndexInjections",
    ],
    typecheckedExports: [
      "client-connection/client.ClientTransportHooks",
      "client-modules/client.createClientModuleSystem",
      "client-web.AppWebEntry",
    ],
  };
}

if (process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyPublicContracts();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
