import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const authorityPath = path.join(root, "docs", "document-authority.yaml");
const failures = [];

function rel(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function fail(message) {
  failures.push(message);
}

if (!fs.existsSync(authorityPath)) {
  fail("missing docs/document-authority.yaml");
} else {
  let document;
  try {
    document = YAML.parse(fs.readFileSync(authorityPath, "utf8"));
  } catch (error) {
    fail(`authority YAML cannot be parsed: ${error.message}`);
  }

  const topics = document?.topics ?? {};
  const authorities = new Set();
  for (const [topic, entry] of Object.entries(topics)) {
    const authority = entry?.authority;
    if (typeof authority !== "string" || authority.length === 0) {
      fail(`topic ${topic} has no authority path`);
      continue;
    }
    const target = path.resolve(root, authority);
    if (!target.startsWith(`${root}${path.sep}`) || !fs.existsSync(target)) {
      fail(`topic ${topic} points to missing or out-of-root file: ${authority}`);
    }
    authorities.add(authority);
  }

  const superseded = document?.superseded ?? {};
  const supersedeGraph = new Map();
  for (const [oldPath, entry] of Object.entries(superseded)) {
    const oldFile = path.resolve(root, oldPath);
    const newPath = entry?.by;
    const newFile = typeof newPath === "string" ? path.resolve(root, newPath) : null;
    if (!fs.existsSync(oldFile)) fail(`superseded file does not exist: ${oldPath}`);
    if (!newFile || !newFile.startsWith(`${root}${path.sep}`) || !fs.existsSync(newFile)) {
      fail(`superseding ADR does not exist for ${oldPath}: ${newPath ?? "missing"}`);
    }
    if (authorities.has(oldPath)) fail(`superseded file is still a current authority: ${oldPath}`);
    if (typeof newPath === "string") supersedeGraph.set(oldPath, newPath);
    if (fs.existsSync(oldFile)) {
      const oldText = fs.readFileSync(oldFile, "utf8");
      if (!/状态：`superseded by ADR-\d{4}`/u.test(oldText)) {
        fail(`superseded ADR has no explicit replacement status: ${oldPath}`);
      }
    }
  }

  for (const start of supersedeGraph.keys()) {
    const visited = new Set();
    let current = start;
    while (supersedeGraph.has(current)) {
      if (visited.has(current)) {
        fail(`ADR supersede cycle detected from: ${start}`);
        break;
      }
      visited.add(current);
      current = supersedeGraph.get(current);
    }
  }

  const currentArchitecture = [
    "docs/architecture/system-boundaries.md",
    "docs/contracts/dsh-integration.md",
  ];
  const legacyTerms = /\bTauri\b|\bRust\b|zero TCP|零 TCP|custom protocol/iu;
  for (const file of currentArchitecture) {
    const target = path.join(root, file);
    if (fs.existsSync(target) && legacyTerms.test(fs.readFileSync(target, "utf8"))) {
      fail(`legacy desktop carrier terminology found in current authority: ${file}`);
    }
  }
}

function walkMarkdown(directory, visitor) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if ([".git", ".hermit", "node_modules", "dist", "lib", "build", "out", "coverage"].includes(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walkMarkdown(fullPath, visitor);
    if (entry.isFile() && entry.name.endsWith(".md")) visitor(fullPath);
  }
}

walkMarkdown(root, (markdownPath) => {
  if (rel(markdownPath).startsWith("docs/provenance/deepseek-harness/snapshots/")) return;
  const text = fs.readFileSync(markdownPath, "utf8").replace(/```[\s\S]*?```/gu, "");
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
    let target = match[1].trim();
    if (/^(?:https?:|mailto:|#)/u.test(target)) continue;
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    target = target.split("#", 1)[0];
    if (!target) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(target);
    } catch {
      fail(`invalid encoded Markdown link in ${rel(markdownPath)}: ${target}`);
      continue;
    }
    const resolved = path.resolve(path.dirname(markdownPath), decoded);
    if (!resolved.startsWith(`${root}${path.sep}`) || !fs.existsSync(resolved)) {
      fail(`broken relative Markdown link in ${rel(markdownPath)}: ${target}`);
    }
  }
});

if (failures.length > 0) {
  console.error("Document governance check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Document governance check passed.");
