import { randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

/** 桌面启动观察的阶段；dsh-unavailable 是可观察的终态而不是静默降级。 */
export type DesktopStartupStage = "app-ready" | "dsh-ready" | "dsh-unavailable";

export interface DesktopStartupObservation {
  /** 观察文件 schema 版本。 */
  readonly schemaVersion: 1;
  /** 本次启动稳定身份。 */
  readonly launchId: string;
  /** 进程开始启动的 ISO 时间。 */
  readonly startedAt: string;
  /** 最近一次阶段变化的 ISO 时间。 */
  readonly updatedAt: string;
  /** 当前启动阶段。 */
  readonly stage: DesktopStartupStage;
  /** 启动是否由登录项触发。 */
  readonly launchReason: "login-item" | "normal";
  readonly application: {
    /** 应用版本。 */
    readonly version: string;
    /** 是否运行在打包产物中。 */
    readonly packaged: boolean;
    /** 当前操作系统。 */
    readonly platform: NodeJS.Platform;
    /** 当前 CPU 架构。 */
    readonly architecture: string;
    /** 应用实际可执行文件路径。 */
    readonly executablePath: string;
  };
  readonly loginItem: {
    /** 系统登录项是否开启。 */
    readonly openAtLogin: boolean;
    /** 系统返回的登录项状态。 */
    readonly status: string;
    /** 本次启动是否由登录项打开。 */
    readonly wasOpenedAtLogin: boolean;
  };
}

export class FileDesktopStartupObservationStore {
  readonly statePath: string;

  constructor(userDataDirectory: string) {
    this.statePath = join(userDataDirectory, "startup-observation.json");
  }

  /** 将启动观察以原子替换方式写入用户数据目录。 */
  write(observation: DesktopStartupObservation): void {
    const directory = dirname(this.statePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const directoryInfo = lstatSync(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
      throw new Error("桌面启动观察目录必须是真实目录");
    }
    const temporary = join(
      directory,
      `.${basename(this.statePath)}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      writeFileSync(temporary, `${JSON.stringify(observation, undefined, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      renameSync(temporary, this.statePath);
    } finally {
      unlinkTemporary(temporary);
    }
  }
}

/** 创建一次启动的初始观察记录。 */
export function createDesktopStartupObservation(input: {
  readonly version: string;
  readonly packaged: boolean;
  readonly executablePath: string;
  readonly loginItem: {
    readonly openAtLogin: boolean;
    readonly status: string;
    readonly wasOpenedAtLogin: boolean;
  };
  readonly now?: Date;
  readonly launchId?: string;
}): DesktopStartupObservation {
  const timestamp = (input.now ?? new Date()).toISOString();
  return {
    schemaVersion: 1,
    launchId: input.launchId ?? randomUUID(),
    startedAt: timestamp,
    updatedAt: timestamp,
    stage: "app-ready",
    launchReason: input.loginItem.wasOpenedAtLogin ? "login-item" : "normal",
    application: {
      version: input.version,
      packaged: input.packaged,
      platform: process.platform,
      architecture: process.arch,
      executablePath: input.executablePath,
    },
    loginItem: { ...input.loginItem },
  };
}

/** 推进启动阶段并更新时间戳，不改变 launchId 和启动原因。 */
export function advanceDesktopStartupObservation(
  observation: DesktopStartupObservation,
  stage: DesktopStartupStage,
  now: Date = new Date(),
): DesktopStartupObservation {
  return { ...observation, stage, updatedAt: now.toISOString() };
}

/** 清理临时文件；目标已不存在是正常收尾结果。 */
function unlinkTemporary(file: string): void {
  try {
    unlinkSync(file);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
}
