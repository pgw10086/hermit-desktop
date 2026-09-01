/** Quick Panel Renderer 与主进程共用的 IPC 通道名。 */
export const QUICK_PANEL_IPC_CHANNEL = "hermit:quick-panel";

/** Quick Panel Renderer 可提交的输入请求。 */
export type QuickPanelRequest =
  | { readonly kind: "draft"; readonly text: string }
  | { readonly kind: "search"; readonly query: string };

/** Quick Panel 打开结果；不可用必须带可展示原因。 */
export type QuickPanelResponse =
  | { readonly status: "opened" }
  | { readonly status: "unavailable"; readonly reason: string };

/** 草稿 IPC 的最大字符数，防止页面桥接携带异常大正文。 */
const MAX_DRAFT_LENGTH = 16_000;
/** 搜索 IPC 的最大字符数，避免无界查询进入主进程。 */
const MAX_SEARCH_LENGTH = 512;

/** 校验并收窄来自 Renderer 的 Quick Panel IPC 请求。 */
export function parseQuickPanelRequest(value: unknown): QuickPanelRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Quick Panel 请求格式无效");
  }
  const record = value as Record<string, unknown>;
  if (
    record.kind === "draft"
    && typeof record.text === "string"
    && record.text.trim().length > 0
    && record.text.length <= MAX_DRAFT_LENGTH
  ) {
    return { kind: "draft", text: record.text };
  }
  if (
    record.kind === "search"
    && typeof record.query === "string"
    && record.query.trim().length > 0
    && record.query.length <= MAX_SEARCH_LENGTH
  ) {
    return { kind: "search", query: record.query };
  }
  throw new Error("Quick Panel 请求内容无效");
}
