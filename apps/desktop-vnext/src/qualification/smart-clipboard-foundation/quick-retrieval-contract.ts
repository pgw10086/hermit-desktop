/** 页面完成首屏交互后回报资格状态的 IPC 通道。 */
export const QUICK_RETRIEVAL_INTERACTIVE_CHANNEL =
  "hermit:qualification:quick-retrieval-interactive";
/** 页面选择记录后回传稳定 id 的 IPC 通道。 */
export const QUICK_RETRIEVAL_SELECT_CHANNEL =
  "hermit:qualification:quick-retrieval-select";
/** 页面取消时回传的 IPC 通道。 */
export const QUICK_RETRIEVAL_CANCEL_CHANNEL =
  "hermit:qualification:quick-retrieval-cancel";
/** 主进程请求页面重置并展示的 IPC 通道。 */
export const QUICK_RETRIEVAL_SHOW_CHANNEL =
  "hermit:qualification:quick-retrieval-show";

export interface QuickRetrievalFixtureItem {
  /** fixture 项稳定身份。 */
  readonly id: string;
  /** 展示给资格测试的文本。 */
  readonly text: string;
  /** 来源标识，用于验证排序和筛选。 */
  readonly source: string;
}
