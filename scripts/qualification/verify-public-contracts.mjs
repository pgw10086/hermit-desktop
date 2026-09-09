import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const require = createRequire(import.meta.url);
const EXPECTED_VERSION = "0.1.1-rc.2";
const QUALIFIED_REACT_VERSION = "18.3.1";
const EXPECTED_NODE_SPEC = ">=22.13.0 <23 || >=24.0.0 <27";
const EXPECTED_PNPM_SPEC = ">=10.0.0 <13";
const EXPECTED_REACT_SPEC = ">=18.3.0 <19";
const EXPECTED_PNPM_PACKAGE_SPEC = "11.24.0";
const EXPECTED_ELECTRON_SPEC = ">=43.0.0 <44";
const EXPECTED_ELECTRON_BUILDER_SPEC = ">=26.0.0 <27";
const EXPECTED_TYPESCRIPT_SPEC = ">=6.0.0 <7";
const EXPECTED_NODE_TYPES_SPEC = ">=24.0.0 <25";
const EXPECTED_DSH_CLOSURE_SHA256 = "7afbcc4845573a1745dde5f3ed0f99380ae105f664f80d310a94961ba6419fa4";
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

function parsePackageCoordinate(key) {
  const match = /^(@[^/]+\/[^@]+|[^@]+)@([^()]+)(?:\(|$)/u.exec(key);
  return match === null ? undefined : `${match[1]}@${match[2]}`;
}

function dependencySnapshotKey(name, descriptor) {
  const version = typeof descriptor === "string" ? descriptor : descriptor?.version;
  assert.equal(typeof version, "string", `lockfile dependency ${name} has no version`);
  return `${name}@${version}`;
}

function reachablePackageCoordinates(lock, dependencies) {
  const pending = Object.entries(dependencies).map(([name, descriptor]) =>
    dependencySnapshotKey(name, descriptor),
  );
  const visited = new Set();
  const coordinates = new Set();

  while (pending.length > 0) {
    const key = pending.pop();
    if (visited.has(key)) continue;
    visited.add(key);

    const coordinate = parsePackageCoordinate(key);
    assert.notEqual(coordinate, undefined, `invalid lockfile snapshot key: ${key}`);
    coordinates.add(coordinate);

    const snapshot = lock.snapshots?.[key];
    assert.notEqual(snapshot, undefined, `lockfile snapshot is missing: ${key}`);
    for (const section of [snapshot.dependencies, snapshot.optionalDependencies]) {
      for (const [name, descriptor] of Object.entries(section ?? {})) {
        pending.push(dependencySnapshotKey(name, descriptor));
      }
    }
  }

  return coordinates;
}

function normalizedDependency(name, descriptor) {
  assert.equal(typeof descriptor?.specifier, "string", `lockfile dependency ${name} has no specifier`);
  const coordinate = parsePackageCoordinate(dependencySnapshotKey(name, descriptor));
  assert.notEqual(coordinate, undefined, `invalid lockfile dependency coordinate: ${name}`);
  return {
    specifier: descriptor.specifier,
    version: coordinate.slice(`${name}@`.length),
  };
}

async function verifyLockfile() {
  const lockPath = path.resolve("pnpm-lock.yaml");
  const source = await readFile(lockPath, "utf8");
  const lock = parseYaml(source);
  const rootImporter = lock.importers?.["."];
  assert.notEqual(rootImporter, undefined, "root lockfile importer is missing");
  const qualificationImporterDependencies = Object.fromEntries(
    [...PACKAGES, "react", "react-dom"].sort().map((name) => [
      name,
      rootImporter.devDependencies?.[name],
    ]),
  );
  const qualificationDependencies = Object.fromEntries(
    Object.entries(qualificationImporterDependencies).map(([name, descriptor]) => [
      name,
      normalizedDependency(name, descriptor),
    ]),
  );
  const reachableCoordinates = reachablePackageCoordinates(lock, qualificationImporterDependencies);
  // workspace 中其他插件可以拥有自己的 DSH 依赖，根资格证据只统计根 importer 的可达闭包。
  const packageEntries = Object.entries(lock.packages ?? {}).filter(([key]) => {
    const coordinate = parsePackageCoordinate(key);
    return coordinate !== undefined && reachableCoordinates.has(coordinate);
  });
  const dshPackages = [];
  const closurePackages = [];
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
      closurePackages.push({ key, integrity: value.resolution.integrity });
    }
    const react = /^react@([^()]+)(?:\(|$)/u.exec(key)?.[1];
    const reactDom = /^react-dom@([^()]+)(?:\(|$)/u.exec(key)?.[1];
    if (react !== undefined) reactVersions.add(react);
    if (reactDom !== undefined) reactDomVersions.add(reactDom);
  }

  assert.equal(dshPackages.length, EXPECTED_DSH_PACKAGE_COUNT, "DSH closure package count drifted");
  assert.deepEqual([...reactVersions], [QUALIFIED_REACT_VERSION]);
  assert.deepEqual([...reactDomVersions], [QUALIFIED_REACT_VERSION]);

  const closureSource = JSON.stringify({
    qualificationDependencies,
    packages: closurePackages.sort((left, right) => left.key.localeCompare(right.key)),
    reactVersions: [...reactVersions].sort(),
    reactDomVersions: [...reactDomVersions].sort(),
  });
  const closureSha256 = createHash("sha256").update(closureSource).digest("hex");
  assert.equal(
    closureSha256,
    EXPECTED_DSH_CLOSURE_SHA256,
    "qualified DSH/React closure drifted",
  );

  return {
    closureSha256,
    dshPackageCount: dshPackages.length,
    reactVersions: [...reactVersions],
    reactDomVersions: [...reactDomVersions],
  };
}

export async function verifyPublicContracts() {
  const pnpmVersion = /pnpm\/([^\s]+)/u.exec(process.env.npm_config_user_agent ?? "")?.[1];
  const workspaceManifest = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
  assert.equal(workspaceManifest.engines?.node, EXPECTED_NODE_SPEC);
  assert.equal(workspaceManifest.engines?.pnpm, EXPECTED_PNPM_SPEC);
  for (const packageName of PACKAGES) {
    assert.equal(
      workspaceManifest.devDependencies?.[packageName],
      EXPECTED_VERSION,
      `${packageName} must be an exact direct qualification dependency`,
    );
  }
  assert.equal(workspaceManifest.devDependencies?.react, EXPECTED_REACT_SPEC);
  assert.equal(workspaceManifest.devDependencies?.["react-dom"], EXPECTED_REACT_SPEC);

  const desktopManifest = JSON.parse(
    await readFile(path.resolve("apps/desktop-vnext/package.json"), "utf8"),
  );
  assert.equal(desktopManifest.dependencies?.["@deepseek-ai/dsh"], EXPECTED_VERSION);
  assert.equal(desktopManifest.dependencies?.pnpm, EXPECTED_PNPM_PACKAGE_SPEC);
  assert.equal(desktopManifest.devDependencies?.electron, EXPECTED_ELECTRON_SPEC);
  assert.equal(desktopManifest.devDependencies?.["electron-builder"], EXPECTED_ELECTRON_BUILDER_SPEC);
  assert.equal(desktopManifest.devDependencies?.typescript, EXPECTED_TYPESCRIPT_SPEC);
  assert.equal(desktopManifest.devDependencies?.["@types/node"], EXPECTED_NODE_TYPES_SPEC);

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
  assert.equal(react.version, QUALIFIED_REACT_VERSION);
  assert.equal(reactDom.version, QUALIFIED_REACT_VERSION);

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
