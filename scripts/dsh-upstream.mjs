import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export function readDshUpstreamRegistry(repositoryRoot) {
  const registryPath = path.join(repositoryRoot, "DEEPSEEK-HARNESS-UPSTREAM.md");
  const text = fs.readFileSync(registryPath, "utf8");
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(text);
  if (match === null) throw new Error("DSH upstream registry 缺少 Markdown YAML front matter");
  const metadata = YAML.parse(match[1]);
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("DSH upstream registry front matter 必须是对象");
  }
  return metadata;
}
