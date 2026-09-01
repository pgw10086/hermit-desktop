import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

/** 本次资格检查锁定的 DSH Web 版本；改变时必须重新审计公开契约。 */
const TARGET_DSH_VERSION = "0.1.1-rc.2";
const workspaceRequire = createRequire(import.meta.url);
const CLIENT_PACKAGES = [
  "@deepseek-ai/dsh-client-ui-layout",
  "@deepseek-ai/dsh-client-ui-sidebar",
  "@deepseek-ai/dsh-client-ui-conversation",
  "@deepseek-ai/dsh-client-ui-settings",
];
const NON_PRODUCT_ROOT_LIST_SLOTS = new Set([
  "settings.action",
  "settings.general.item",
  "settings.onboarding",
  "settings.plugins.tab",
  "settings.section",
  "shell.overlay",
  "sidebar.footer.action",
]);

/** 从 stock DSH 的公开 declaration inventory 判断 Product Surface 是否可追加。 */
export async function inspectProductSurfaceContract() {
  const webAppManifest = workspaceRequire.resolve(
    "@deepseek-ai/dsh-web-app/package.json",
  );
  // Resolve from the official Web App assembly, not the workspace root where
  // Hermit also keeps its source-built replacement package.
  const dshRequire = createRequire(webAppManifest);
  const slots = [];
  const inspectedPackages = [];

  for (const packageName of CLIENT_PACKAGES) {
    const manifestPath = dshRequire.resolve(`${packageName}/package.json`);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const clientTypes = manifest.exports?.["./client"]?.types;
    if (typeof clientTypes !== "string") {
      throw new Error(`${packageName} 没有公开 ./client types export`);
    }
    if (manifest.version !== TARGET_DSH_VERSION) {
      throw new Error(`${packageName} 版本漂移为 ${String(manifest.version)}`);
    }

    const entry = path.resolve(path.dirname(manifestPath), clientTypes);
    slots.push(...await collectPublicSlotDeclarations(entry, packageName));
    inspectedPackages.push({ name: packageName, version: manifest.version, clientTypes });
  }

  const inventory = deduplicateSlots(slots);
  const rootAdditive = inventory.filter(({ kind, scope }) => kind === "list" && scope === "root");
  const productSurfaceCandidates = rootAdditive.filter(({ name }) =>
    !NON_PRODUCT_ROOT_LIST_SLOTS.has(name),
  );
  const status = productSurfaceCandidates.length === 0 ? "blocked" : "review-required";

  return {
    schemaVersion: 1,
    gate: "Q-PRODUCT-SURFACE-01",
    status,
    target: TARGET_DSH_VERSION,
    decision: status === "blocked"
      ? "当前 stock DSH 公开契约没有可追加全局导航入口与插件持有持久页面；应检查上游公开能力或按 ADR-0003 资格化 Hermit bundled source patch，不能用运行时私有实现替代"
      : "发现新的 root additive slot，必须用同一 artifact 在 stock DSH/Hermit 完成真实导航与生命周期资格",
    facts: {
      inspectedPackages,
      rootAdditive,
      productSurfaceCandidates,
      requiredCapabilities: [
        "additive-root-navigation-destination",
        "plugin-owned-persistent-root-page",
      ],
      approvedResolution: "upstream-public-surface-or-hermit-bundled-source-patch",
      rejectedSubstitutes: [
        "settings",
        "session-scoped-conversation-view",
        "shell-overlay",
        "single-slot-replacement",
        "private-router-or-dom-injection",
      ],
    },
  };
}

async function collectPublicSlotDeclarations(entry, packageName) {
  const pending = [entry];
  const visited = new Set();
  const slots = [];

  while (pending.length > 0) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);

    const source = await readFile(file, "utf8");
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    collectSlots(parsed, packageName, slots);
    for (const specifier of relativeModuleSpecifiers(parsed)) {
      const resolved = await resolveDeclaration(file, specifier);
      if (resolved !== undefined) pending.push(resolved);
    }
  }

  return slots;
}

function collectSlots(sourceFile, packageName, slots) {
  const visit = (node) => {
    if (
      ts.isModuleDeclaration(node)
      && ts.isStringLiteral(node.name)
      && node.name.text === "@deepseek-ai/dsh-client-ui-slots"
    ) {
      const body = node.body;
      if (body !== undefined && ts.isModuleBlock(body)) {
        for (const statement of body.statements) {
          if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== "SlotMap") continue;
          for (const member of statement.members) {
            if (!ts.isPropertySignature(member) || member.type === undefined) continue;
            const name = propertyName(member.name);
            const kind = typeLiteralValue(member.type, "kind");
            const scope = typeLiteralValue(member.type, "scope");
            if (name !== undefined && kind !== undefined && scope !== undefined) {
              slots.push({ name, kind, scope, package: packageName });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function propertyName(node) {
  if (ts.isStringLiteral(node) || ts.isIdentifier(node)) return node.text;
  return undefined;
}

function typeLiteralValue(node, property) {
  if (!ts.isTypeLiteralNode(node)) return undefined;
  const member = node.members.find((candidate) =>
    ts.isPropertySignature(candidate) && propertyName(candidate.name) === property,
  );
  if (
    member === undefined
    || !ts.isPropertySignature(member)
    || member.type === undefined
    || !ts.isLiteralTypeNode(member.type)
    || !ts.isStringLiteral(member.type.literal)
  ) {
    return undefined;
  }
  return member.type.literal.text;
}

function relativeModuleSpecifiers(sourceFile) {
  const specifiers = [];
  for (const statement of sourceFile.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
      && statement.moduleSpecifier !== undefined
      && ts.isStringLiteral(statement.moduleSpecifier)
      && statement.moduleSpecifier.text.startsWith(".")
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

async function resolveDeclaration(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = specifier.endsWith(".ts")
    ? [`${base.slice(0, -3)}.d.ts`]
    : [`${base}.d.ts`, path.join(base, "index.d.ts")];
  for (const candidate of candidates) {
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch (cause) {
      if (cause?.code !== "ENOENT") throw cause;
    }
  }
  return undefined;
}

function deduplicateSlots(slots) {
  const byName = new Map();
  for (const slot of slots) {
    const current = byName.get(slot.name);
    if (current !== undefined && (
      current.kind !== slot.kind
      || current.scope !== slot.scope
      || current.package !== slot.package
    )) {
      throw new Error(`Slot ${slot.name} 存在冲突声明`);
    }
    byName.set(slot.name, slot);
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}
