// 根入口只重导出正式三类领域模型，避免第一条 TEXT 切片形成第二套业务规则。
/** Smart Clipboard 领域契约和动作计划的公开出口。 */
export * from './full-history.js'
export * from './actions.js'
export { inject, apply } from './host.js'
export { default } from './host.js'
