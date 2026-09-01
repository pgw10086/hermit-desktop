import fs from "node:fs";
import path from "node:path";

/** 证据记录允许的可序列化值，不包含用户正文和 Secret。 */
export type EvidenceValue = string | number | boolean | null;

export interface EvidenceSink {
  /** 写入一条结构化诊断事件。 */
  record(event: string, details?: Readonly<Record<string, EvidenceValue>>): void;
}

const noopEvidenceSink: EvidenceSink = Object.freeze({
  record: () => undefined,
});

export function createEvidenceSink(
  userData: string,
  environment: NodeJS.ProcessEnv = process.env,
): EvidenceSink {
  const configured = environment.HERMIT_EVIDENCE_FILE;
  if (configured === undefined || configured.trim() === "") return noopEvidenceSink;

  const root = canonicalizePotentialPath(userData);
  const file = canonicalizePotentialPath(configured);
  const relative = path.relative(root, file);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    console.error("HERMIT_EVIDENCE_FILE 必须位于当前 Hermit userData 内，已禁用证据记录");
    return noopEvidenceSink;
  }

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    return new JsonlEvidenceSink(file);
  } catch (cause) {
    console.error(`Hermit 证据文件初始化失败，已禁用记录: ${errorMessage(cause)}`);
    return noopEvidenceSink;
  }
}

/** 解析可能尚不存在的路径，供 userData 范围校验使用。 */
function canonicalizePotentialPath(value: string): string {
  let existing = path.resolve(value);
  const missing: string[] = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  const canonical = fs.existsSync(existing) ? fs.realpathSync.native(existing) : existing;
  return path.join(canonical, ...missing);
}

class JsonlEvidenceSink implements EvidenceSink {
  readonly #file: string;
  #enabled = true;

  constructor(file: string) {
    this.#file = file;
  }

  /** 追加并 fsync 一条 JSONL 证据；通道失败只禁用后续记录。 */
  record(event: string, details: Readonly<Record<string, EvidenceValue>> = {}): void {
    if (!this.#enabled) return;
    const entry = `${JSON.stringify({
      schemaVersion: 1,
      at: new Date().toISOString(),
      event,
      details,
    })}\n`;
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(this.#file, "a");
      fs.writeFileSync(descriptor, entry, "utf8");
      fs.fsyncSync(descriptor);
    } catch (cause) {
      // 证据通道只观察生产路径，失败时不能改变桌面动作或退出流程。
      this.#enabled = false;
      console.error(`Hermit 证据记录失败，后续记录已禁用: ${errorMessage(cause)}`);
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }
}

/** 将证据通道异常转换为诊断消息。 */
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
