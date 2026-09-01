import type { Context } from '@deepseek-ai/cordis'

/** Host 半不直接注入 DSH 服务；平台能力由 Electron Core 通过安全 API 提供。 */
export const inject: readonly [] = []

/**
 * Host 只保存可审计的用户偏好；剪贴板正文、系统写回和历史存储由 Electron Core 注入，
 * 不在 DSH Host 里复制一份数据库或直接碰平台 API。
 */
export function apply(_ctx: Context): void {}

export default { inject, apply }
