import type { ClipboardEntry, ClipboardKind } from './full-history.js'

/** 快捷操作类型；use 会在复制后尝试自动粘贴。 */
export type ClipboardAction = 'use' | 'copy' | 'plain-text'
/** 支持配置的三个快捷键身份。 */
export type ActionShortcut = 'Enter' | 'Mod+Enter' | 'Shift+Enter'

export interface ActionMapping {
  /** 回车键对应的动作。 */
  readonly Enter: ClipboardAction
  /** Mod+Enter 对应的动作。 */
  readonly 'Mod+Enter': ClipboardAction
  /** Shift+Enter 对应的动作。 */
  readonly 'Shift+Enter': ClipboardAction
}

/** 默认动作映射；三个快捷键必须分别占用不同动作。 */
export const DEFAULT_ACTION_MAPPING: ActionMapping = {
  Enter: 'use',
  'Mod+Enter': 'copy',
  'Shift+Enter': 'plain-text',
}

export type ActionMappingValidation =
  | { readonly valid: true; readonly mapping: ActionMapping }
  | { readonly valid: false; readonly field: ActionShortcut; readonly reason: 'duplicate' | 'unsupported' }

/** 校验动作映射是否覆盖三个动作且不存在重复绑定。 */
export function validateActionMapping(mapping: ActionMapping): ActionMappingValidation {
  const entries = Object.entries(mapping) as readonly [ActionShortcut, ClipboardAction][]
  const seen = new Set<ClipboardAction>()
  for (const [shortcut, action] of entries) {
    if (!isClipboardAction(action)) return { valid: false, field: shortcut, reason: 'unsupported' }
    if (seen.has(action)) return { valid: false, field: shortcut, reason: 'duplicate' }
    seen.add(action)
  }
  if (entries.length !== 3 || seen.size !== 3) {
    return { valid: false, field: 'Enter', reason: 'duplicate' }
  }
  return { valid: true, mapping: { ...mapping } }
}

/** 判断某动作是否支持当前剪贴板内容类型。 */
export function actionAvailable(action: ClipboardAction, kind: ClipboardKind): boolean {
  return action !== 'plain-text' || kind === 'TEXT'
}

/** 将动作转换为用户可见标签。 */
export function actionLabel(action: ClipboardAction): string {
  switch (action) {
    case 'use': return '使用当前项'
    case 'copy': return '只复制'
    case 'plain-text': return '纯文本使用'
  }
}

export interface ActionExecutionPlan {
  /** 最终执行的动作。 */
  readonly action: ClipboardAction
  /** 目标历史记录身份。 */
  readonly entryId: string
  /** 是否保留文本的富文本表示。 */
  readonly copyFormatted: boolean
  /** 是否在复制后尝试自动粘贴。 */
  readonly autoPaste: boolean
}

/** 将动作和记录转换为平台执行计划；不支持的组合返回 undefined。 */
export function planAction(action: ClipboardAction, entry: ClipboardEntry): ActionExecutionPlan | undefined {
  if (!actionAvailable(action, entry.kind)) return undefined
  return {
    action,
    entryId: entry.id,
    copyFormatted: action !== 'plain-text' && entry.kind === 'TEXT',
    autoPaste: action === 'use',
  }
}

function isClipboardAction(value: unknown): value is ClipboardAction {
  return value === 'use' || value === 'copy' || value === 'plain-text'
}
