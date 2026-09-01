const READY_URL_PATTERN = /\bdsh web:\s+(http:\/\/[^\s]+)/u;

/** 从 DSH 输出中提取并校验 loopback Web URL。 */
export function extractDshWebUrl(output: string): URL | undefined {
  const match = READY_URL_PATTERN.exec(output);
  if (match?.[1] === undefined) return undefined;
  return validateDshWebUrl(match[1]);
}

/** 校验 URL 必须是本机 loopback HTTP，拒绝凭据和非标准主机。 */
export function validateDshWebUrl(value: string): URL {
  const url = new URL(value);
  const port = Number(url.port);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username !== "" ||
    url.password !== "" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new Error("DSH reported an invalid loopback readiness URL");
  }
  return url;
}

export interface HttpReadyOptions {
  /** 等待 HTTP 可用的总时长。 */
  readonly timeoutMs: number;
  /** 连续探测之间的间隔。 */
  readonly intervalMs?: number;
  /** 注入的 fetch 实现，便于资格测试使用 fixture。 */
  readonly fetcher?: typeof fetch;
}

/** 通过真实 HTTP 探测确认 DSH 已可服务，而不是只依赖启动日志。 */
export async function waitForHttpReady(url: URL, options: HttpReadyOptions): Promise<void> {
  const fetcher = options.fetcher ?? fetch;
  const intervalMs = options.intervalMs ?? 100;
  const deadline = Date.now() + options.timeoutMs;
  let lastCause: unknown;

  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(1_000, remainingMs));
    try {
      const response = await fetcher(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      });
      await response.body?.cancel();
      if (response.status >= 200 && response.status < 400) return;
      lastCause = new Error(`unexpected HTTP status ${String(response.status)}`);
    } catch (cause) {
      lastCause = cause;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("DSH reported a URL but did not become HTTP-ready", { cause: lastCause });
}
