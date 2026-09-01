// Adapted from anywhere-labs/dsh-desktop@1eb398d (MIT).
// 窗口状态只属于桌面壳，不进入 DSH profile，也不跨 runtime generation 复制。
import { randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

const STATE_VERSION = 1;
const MAX_STATE_BYTES = 4 * 1024;

export interface MainWindowBounds {
  /** 窗口左上角的屏幕 X 坐标。 */
  readonly x: number;
  /** 窗口左上角的屏幕 Y 坐标。 */
  readonly y: number;
  /** 窗口宽度，必须是正安全整数。 */
  readonly width: number;
  /** 窗口高度，必须是正安全整数。 */
  readonly height: number;
}

export interface MainWindowStateStore {
  /** 读取上次保存的窗口边界；没有可用状态时返回 undefined。 */
  read(): MainWindowBounds | undefined;
  /** 校验并持久化窗口边界。 */
  write(bounds: MainWindowBounds): void;
}

export class FileMainWindowStateStore implements MainWindowStateStore {
  readonly statePath: string;

  constructor(userDataDirectory: string) {
    this.statePath = join(userDataDirectory, "main-window-state.json");
  }

  /** 读取并校验原子写入的窗口状态文件。 */
  read(): MainWindowBounds | undefined {
    let info;
    try {
      info = lstatSync(this.statePath);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw cause;
    }
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error("主窗口状态必须是普通文件");
    }
    if (info.size > MAX_STATE_BYTES) {
      throw new Error(`主窗口状态超过 ${String(MAX_STATE_BYTES)} bytes`);
    }
    const parsed: unknown = JSON.parse(readFileSync(this.statePath, "utf8"));
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      (parsed as { version?: unknown }).version !== STATE_VERSION
    ) {
      throw new Error("主窗口状态版本不受支持");
    }
    return parseBounds((parsed as { bounds?: unknown }).bounds);
  }

  /** 将窗口状态写入真实用户目录，避免符号链接和部分写入。 */
  write(bounds: MainWindowBounds): void {
    const validated = parseBounds(bounds);
    const directory = dirname(this.statePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const directoryInfo = lstatSync(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
      throw new Error("主窗口状态目录必须是真实目录");
    }
    const temporary = join(
      directory,
      `.${basename(this.statePath)}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      writeFileSync(
        temporary,
        `${JSON.stringify({ version: STATE_VERSION, bounds: validated }, undefined, 2)}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
      renameSync(temporary, this.statePath);
    } finally {
      unlinkTemporary(temporary);
    }
  }
}

/** 将上次窗口位置限制在当前工作区和最小尺寸内，避免恢复到不可见区域。 */
export function fitMainWindowBounds(
  bounds: MainWindowBounds,
  workArea: MainWindowBounds,
  minimum: Pick<MainWindowBounds, "width" | "height">,
): MainWindowBounds {
  const restored = parseBounds(bounds);
  const available = parseBounds(workArea);
  const width = Math.max(minimum.width, Math.min(restored.width, available.width));
  const height = Math.max(minimum.height, Math.min(restored.height, available.height));
  const visibleWidth = Math.max(
    0,
    Math.min(restored.x + width, available.x + available.width) -
      Math.max(restored.x, available.x),
  );
  const topEdgeReachable =
    restored.y >= available.y - 32 && restored.y < available.y + available.height - 36;
  if (
    width === restored.width &&
    height === restored.height &&
    visibleWidth >= Math.min(64, width) &&
    topEdgeReachable
  ) {
    return restored;
  }
  return {
    x: Math.min(
      available.x + Math.max(0, available.width - width),
      Math.max(available.x, restored.x),
    ),
    y: Math.min(
      available.y + Math.max(0, available.height - height),
      Math.max(available.y, restored.y),
    ),
    width,
    height,
  };
}

/** 判断两个窗口边界是否完全一致，用于避免无意义的写入。 */
export function sameMainWindowBounds(
  left: MainWindowBounds,
  right: MainWindowBounds,
): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

/** 将外部 JSON 或调用方对象收窄为合法窗口边界。 */
function parseBounds(value: unknown): MainWindowBounds {
  if (value === null || typeof value !== "object") {
    throw new Error("主窗口位置必须是对象");
  }
  const candidate = value as Partial<Record<keyof MainWindowBounds, unknown>>;
  if (!isCoordinate(candidate.x) || !isCoordinate(candidate.y)) {
    throw new Error("主窗口坐标必须是安全整数");
  }
  if (!isDimension(candidate.width) || !isDimension(candidate.height)) {
    throw new Error("主窗口尺寸必须是正安全整数");
  }
  return {
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    height: candidate.height,
  };
}

/** 判断坐标是否为安全整数，允许负数屏幕坐标。 */
function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/** 判断尺寸是否为正安全整数。 */
function isDimension(value: unknown): value is number {
  return isCoordinate(value) && value > 0;
}

function unlinkTemporary(file: string): void {
  try {
    unlinkSync(file);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
}
