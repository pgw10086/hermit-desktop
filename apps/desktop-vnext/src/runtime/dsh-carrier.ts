import { execFile, spawn, type ChildProcessByStdio } from "node:child_process";
import { once } from "node:events";
import type { Readable } from "node:stream";

type ManagedChild = ChildProcessByStdio<null, Readable, Readable>;

/** 该进程是 Electron 与 DSH 之间的存活载体，负责把父进程退出传播到整个子进程组。 */
const dshEntry = process.argv[2];
const dshArgs = process.argv.slice(3);
const graceMs = readPositiveInteger(process.env.HERMIT_DSH_CARRIER_GRACE_MS, 3_000);

if (dshEntry === undefined) {
  process.stderr.write("Hermit DSH carrier requires a DSH entry path\n");
  process.exit(2);
}

let child: ManagedChild | undefined;
let cleanupRequested = false;
let cleanup: Promise<void> | undefined;
let requestedExitCode = 0;
let input = "";

// Electron 突然退出时，stdin EOF 是操作系统提供的存活信号。先注册监听再启动 DSH，
// 避免父进程在启动窗口消失时错过清理请求。
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  input += chunk;
  const lines = input.split(/\r?\n/u);
  input = lines.pop() ?? "";
  if (lines.some((line) => line === "STOP")) requestCleanup(0);
});
process.stdin.once("end", () => requestCleanup(0));
process.stdin.once("close", () => requestCleanup(0));
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  process.once(signal, () => requestCleanup(0));
}

// 父进程死亡也会关闭 stdout/stderr 的 reader。保持读取 DSH 输出，但忽略转发 EPIPE，
// 否则 watchdog 可能在最需要回收子进程时先退出。
process.stdout.on("error", ignoreClosedParentStream);
process.stderr.on("error", ignoreClosedParentStream);

let spawned: ManagedChild;
try {
  spawned = spawn(process.execPath, [dshEntry, ...dshArgs], {
    cwd: process.cwd(),
    env: process.env,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (cause) {
  process.stderr.write(`Hermit DSH carrier failed to spawn DSH: ${errorMessage(cause)}\n`);
  process.exit(1);
}

child = spawned;
spawned.stdout.on("data", (chunk: Buffer) => forward(process.stdout, chunk));
spawned.stderr.on("data", (chunk: Buffer) => forward(process.stderr, chunk));
spawned.once("error", (cause) => {
  forward(process.stderr, Buffer.from(`Hermit DSH carrier child error: ${errorMessage(cause)}\n`));
  requestCleanup(1);
});
spawned.once("exit", (code, signal) => {
  if (!cleanupRequested) {
    if (signal !== null) {
      forward(process.stderr, Buffer.from(`DSH exited from signal ${signal}\n`));
    }
    requestCleanup(code ?? 1);
  }
});

if (cleanupRequested) requestCleanup(requestedExitCode);

/** 只启动一次清理流程，并保留最先出现的非零退出码。 */
function requestCleanup(exitCode: number): void {
  cleanupRequested = true;
  if (exitCode !== 0) requestedExitCode = exitCode;
  if (cleanup !== undefined || child === undefined) return;
  cleanup = stopDshTree(child)
    .catch((cause: unknown) => {
      requestedExitCode = 1;
      forward(process.stderr, Buffer.from(`Hermit DSH carrier cleanup failed: ${errorMessage(cause)}\n`));
    })
    .finally(() => {
      process.exit(requestedExitCode);
    });
}

/** 按平台回收 DSH 及其子进程树；超时后强制终止并验证进程组已消失。 */
async function stopDshTree(target: ManagedChild): Promise<void> {
  const pid = target.pid;
  if (pid === undefined) {
    if (!hasExited(target)) target.kill("SIGTERM");
    return;
  }

  if (process.platform === "win32") {
    if (hasExited(target)) return;
    await taskkill(pid);
    await waitForExit(target);
    return;
  }

  if (!hasExited(target)) target.kill("SIGTERM");
  if (!(await waitForGroupExit(pid, graceMs))) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause;
    }
  }
  if (!(await waitForGroupExit(pid, 1_000))) {
    throw new Error(`DSH process group ${String(pid)} survived carrier cleanup`);
  }
  await waitForExit(target);
}

/** Windows 下使用 taskkill 的树终止语义，避免只杀掉最外层 Node 进程。 */
function taskkill(pid: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "taskkill.exe",
      ["/PID", String(pid), "/T", "/F"],
      { windowsHide: true },
      (cause) => cause === null ? resolve() : reject(cause),
    );
  });
}

/** 判断子进程是否已经报告退出。 */
function hasExited(target: ManagedChild): boolean {
  return target.exitCode !== null || target.signalCode !== null;
}

/** 等待子进程退出；已退出时保持同步完成。 */
function waitForExit(target: ManagedChild): Promise<void> {
  return hasExited(target) ? Promise.resolve() : once(target, "exit").then(() => undefined);
}

/** 检查 Unix 进程组是否仍存在，EPERM 也表示组存在但当前进程无权探测。 */
function groupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw cause;
  }
}

/** 在有限窗口内等待整个 Unix 进程组消失。 */
async function waitForGroupExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (groupExists(pid)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(25, remaining)));
  }
  return true;
}

/** 转发子进程输出；父进程通道关闭时忽略 EPIPE。 */
function forward(target: NodeJS.WriteStream, chunk: Buffer): void {
  if (target.destroyed) return;
  target.write(chunk, (cause) => {
    if (cause !== null && cause !== undefined) ignoreClosedParentStream(cause);
  });
}

/** 记录输出通道故障，但不让日志错误跳过生命周期清理。 */
function ignoreClosedParentStream(cause: Error): void {
  if ((cause as NodeJS.ErrnoException).code !== "EPIPE") {
    // 日志通道不能接管生命周期；非 EPIPE 也只设置失败码，清理仍继续。
    requestedExitCode = 1;
  }
}

/** 读取带正整数约束的环境变量，非法值回到调用方给出的默认窗口。 */
function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** 将载体异常转换为可写入 stderr 的短消息。 */
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
