import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const APPROVED_PACKAGE_VERSION = "0.1.1-rc.2";
const UPSTREAM_COMMIT = "b150a551b8d465e31e418e1b2eaf5e79bbb7d28e";
const PATCH_VERSION = 1;
const CLOSE_SURFACE_CALL = 'ctx.get("layout")?.closeProductSurface();';
const PATCH_TARGETS = Object.freeze([
  {
    packageName: "@deepseek-ai/dsh-client-ui-workspace",
    statements: [
      ["ctx.workspaces.startSession(workspaceId);", "startSession"],
      ["ctx.sessions.open(sessionId);", "open session"],
      ["ctx.sessions.open(childId);", "forked session"],
    ],
    marker: "/* hermit: primary-workspace-navigation-v1:workspace */",
  },
  {
    packageName: "@deepseek-ai/dsh-client-ui-sidebar",
    statements: [["ctx.workspaces.startSession(workspaceId);", "sidebar startSession"]],
    marker: "/* hermit: primary-workspace-navigation-v1:sidebar */",
  },
]);

export const foregroundSessionNavigationPatch = Object.freeze({
  patchVersion: PATCH_VERSION,
  upstreamCommit: UPSTREAM_COMMIT,
  packages: Object.freeze(PATCH_TARGETS.map(({ packageName }) => ({
    packageName,
    packageVersion: APPROVED_PACKAGE_VERSION,
  }))),
});

/**
 * 给固定版本的 DSH Workspace/Sidebar adapter 补上 Hermit 主工作区交接。
 * 适配层只依赖公开的 ctx.layout service；stock DSH 没有该 service 时自然不产生动作。
 */
export function installForegroundSessionNavigationPatch(runtimeRoot) {
  for (const patchTarget of PATCH_TARGETS) {
    const target = resolveClient(runtimeRoot, patchTarget);
    const text = fs.readFileSync(target.clientPath, "utf8");
    if (text.includes(patchTarget.marker)) continue;
    if (text.includes(CLOSE_SURFACE_CALL)) {
      throw new Error(`DSH ${patchTarget.packageName} foreground patch is partially applied`);
    }
    let patched = text;
    for (const [statement, label] of patchTarget.statements) {
      patched = injectAfterExactStatement(patched, statement, `${patchTarget.packageName} ${label}`);
    }
    fs.writeFileSync(target.clientPath, `${patched}\n${patchTarget.marker}\n`, "utf8");
  }
  return validateForegroundSessionNavigationPatch(runtimeRoot);
}

/** 校验 runtime 中的 DSH Workspace/Sidebar adapter 是否确实带有完整交接补丁。 */
export function validateForegroundSessionNavigationPatch(runtimeRoot) {
  const packages = PATCH_TARGETS.map((patchTarget) => {
    const target = resolveClient(runtimeRoot, patchTarget);
    const text = fs.readFileSync(target.clientPath, "utf8");
    const closeCallCount = countOccurrences(text, CLOSE_SURFACE_CALL);
    if (!text.includes(patchTarget.marker) || closeCallCount !== patchTarget.statements.length) {
      throw new Error(`DSH ${patchTarget.packageName} foreground patch is missing or incomplete`);
    }
    return {
      packageName: patchTarget.packageName,
      packageVersion: APPROVED_PACKAGE_VERSION,
      clientSha256: createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex"),
    };
  });
  return {
    ...foregroundSessionNavigationPatch,
    packages,
  };
}

function resolveClient(runtimeRoot, patchTarget) {
  const closureRoot = path.resolve(runtimeRoot);
  const packageRoot = path.join(
    closureRoot,
    "node_modules",
    ...patchTarget.packageName.split("/"),
  );
  const manifestPath = path.join(packageRoot, "package.json");
  const clientPath = path.join(packageRoot, "lib", "client.js");
  if (!fs.existsSync(manifestPath) || !fs.existsSync(clientPath)) {
    throw new Error(`Bundled DSH package ${patchTarget.packageName} is incomplete: ${packageRoot}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (
    manifest.name !== patchTarget.packageName ||
    manifest.version !== APPROVED_PACKAGE_VERSION
  ) {
    throw new Error(
      `Bundled DSH package ${patchTarget.packageName} is not the approved ${APPROVED_PACKAGE_VERSION} generation`,
    );
  }
  const realPackageRoot = fs.realpathSync(packageRoot);
  const realClosureRoot = fs.realpathSync(closureRoot);
  if (!realPackageRoot.startsWith(`${realClosureRoot}${path.sep}`)) {
    throw new Error(`Bundled DSH package ${patchTarget.packageName} escapes the runtime closure: ${realPackageRoot}`);
  }
  return { clientPath, packageRoot: realPackageRoot };
}

function injectAfterExactStatement(text, statement, label) {
  const pattern = new RegExp(`^([\\t ]*)${escapeRegExp(statement)}$`, "gmu");
  let matches = 0;
  const patched = text.replace(pattern, (line, indent) => {
    matches += 1;
    return `${line}\n${indent}${CLOSE_SURFACE_CALL}`;
  });
  if (matches !== 1) {
    throw new Error(`DSH foreground navigation patch anchor must match once (${label}), got ${matches}`);
  }
  return patched;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function countOccurrences(text, value) {
  return text.split(value).length - 1;
}
