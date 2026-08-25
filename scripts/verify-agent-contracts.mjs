import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const failures = [];

const requiredFiles = [
  "AGENTS.md",
  "CLAUDE.md",
  "docs/repository-layout.md",
  "docs/architecture/system-boundaries.md",
  "docs/contracts/dsh-integration.md",
  "docs/contracts/product-plugin-security.md",
  "docs/contracts/runtime-agent.md",
  "docs/development/engineering-rules.md",
];

const allowedTopLevel = new Set([
  ".editorconfig",
  ".gitattributes",
  ".git",
  ".github",
  ".gitignore",
  ".hermit",
  ".idea",
  ".node-version",
  ".npmrc",
  ".vscode",
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "NOTICE",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "README.md",
  "SECURITY.md",
  "apps",
  "docs",
  "migration",
  "native",
  "packages",
  "plugins",
  "scripts",
  "specs",
]);

// 当前没有真实的局部规则。新增 scoped AGENTS 时必须在布局评审中同步登记。
const allowedScopedAgents = new Set([]);

const ignoredDirectories = new Set([
  ".git",
  ".hermit",
  ".idea",
  ".vscode",
  "node_modules",
  "target",
]);

function relative(filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function fail(message) {
  failures.push(message);
}

function wordCount(text) {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

function maintainedMarkdownProse(text) {
  return text
    .replace(/<!-- doc-lang: allow-en-start;[\s\S]*?<!-- doc-lang: allow-en-end -->/gu, "")
    .replace(/```[\s\S]*?```/gu, "")
    .replace(/`[^`]*`/gu, "")
    .replace(/\]\((?:https?:\/\/|mailto:)[^)]+\)/gu, "]")
    .replace(/<!--(?!\s*translation-of:)[\s\S]*?-->/gu, "");
}

function hasChineseProse(text) {
  const matches = maintainedMarkdownProse(text).match(/[\u3400-\u9fff]/gu) ?? [];
  return matches.length >= 20;
}

function isCurrentMarkdown(rel) {
  if (!rel.endsWith(".md")) return false;
  if (rel.startsWith("migration/") || rel.startsWith("specs/")) return false;
  if (rel.startsWith("docs/provenance/")) return false;
  return true;
}

function walk(directory, visitor) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git") {
      if (directory !== root) visitor(path.join(directory, entry.name), entry);
      continue;
    }
    if (ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    visitor(fullPath, entry);
    if (entry.isDirectory()) walk(fullPath, visitor);
  }
}

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) fail(`missing required context: ${file}`);
}

const claudePath = path.join(root, "CLAUDE.md");
if (fs.existsSync(claudePath) && fs.readFileSync(claudePath, "utf8") !== "@AGENTS.md\n") {
  fail("CLAUDE.md must contain exactly @AGENTS.md followed by one newline");
}

const rootAgentsPath = path.join(root, "AGENTS.md");
if (fs.existsSync(rootAgentsPath)) {
  const count = fs.readFileSync(rootAgentsPath, "utf8").split(/\r?\n/u).length;
  if (count > 80) fail(`root AGENTS.md exceeds 80 lines: ${count}`);
}

for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (ignoredDirectories.has(entry.name)) continue;
  if (!allowedTopLevel.has(entry.name)) fail(`undefined top-level entry: ${entry.name}`);
}

if (fs.existsSync(path.join(root, ".gitmodules"))) fail(".gitmodules is not allowed");

const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const secretNames = new Set([
  ".env",
  "cookies",
  "login data",
  "local state",
]);

const markdownLanguageAllowlist = new Set(["CLAUDE.md"]);

walk(root, (fullPath, entry) => {
  const rel = relative(fullPath);
  const lowerName = entry.name.toLowerCase();

  if (entry.name === ".git") fail(`nested Git repository: ${rel}`);

  if (entry.isSymbolicLink()) {
    const resolved = fs.realpathSync(fullPath);
    const inside = resolved === root || resolved.startsWith(`${root}${path.sep}`);
    if (!inside) fail(`out-of-root symbolic link: ${rel} -> ${resolved}`);
  }

  if (entry.isFile() && entry.name === "AGENTS.md" && rel !== "AGENTS.md") {
    if (!allowedScopedAgents.has(rel)) fail(`unapproved scoped AGENTS.md: ${rel}`);
    const count = wordCount(fs.readFileSync(fullPath, "utf8"));
    if (count > 350) fail(`scoped AGENTS.md exceeds 350 words: ${rel} (${count})`);
  }

  if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md") {
    const text = fs.readFileSync(fullPath, "utf8");
    const fenceCount = (text.match(/^```/gmu) ?? []).length;
    if (fenceCount % 2 !== 0) fail(`Markdown code fence 未成对闭合: ${rel}`);

    if (!markdownLanguageAllowlist.has(rel) && !hasChineseProse(text)) {
      fail(`第一方维护性 Markdown 缺少中文正文: ${rel}`);
    }

    if (isCurrentMarkdown(rel) && /\b[A-Za-z]:\\/u.test(text)) {
      fail(`当前文档不得硬编码本机绝对路径: ${rel}`);
    }

    if (/\.(?:en|zh|zh-CN)\.md$/u.test(entry.name)) {
      const marker = text.match(/<!--\s*translation-of:\s*([^;]+);\s*canonical-language:\s*zh-CN\s*-->/u);
      if (!marker) {
        fail(`派生翻译缺少 translation-of 声明: ${rel}`);
      } else {
        const canonical = path.resolve(path.dirname(fullPath), marker[1].trim());
        if (!fs.existsSync(canonical)) fail(`派生翻译的 canonical 不存在: ${rel}`);
      }
    }
  }

  if (entry.isFile() && (secretNames.has(lowerName) || /\.(pem|p12|key)$/iu.test(entry.name))) {
    fail(`secret-like file is not allowed: ${rel}`);
  }

  if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
    const text = fs.readFileSync(fullPath, "utf8");
    if (/['"]@deepseek-ai\/[^'"]+\/src\//u.test(text)) {
      fail(`DSH private source import: ${rel}`);
    }
    if (rel.startsWith("plugins/") && /(?:node:)?(?:fs|net|http|https|tls|dns|dgram|child_process)|ctx\.llm|@tauri-apps\/api/u.test(text)) {
      fail(`Product Plugin ambient authority import/use: ${rel}`);
    }
  }
});

if (
  fs.existsSync(path.join(root, "README.md")) &&
  fs.existsSync(path.join(root, "README.zh-CN.md"))
) {
  fail("中文 README.md 已是 canonical，不得并列维护 README.zh-CN.md");
}

if (failures.length > 0) {
  console.error("Agent contract verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Agent contract verification passed.");
