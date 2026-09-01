import type { ClipboardEntry, ClipboardKind } from './full-history.js';
/** 快捷操作类型；use 会在复制后尝试自动粘贴。 */
export type ClipboardAction = 'use' | 'copy' | 'plain-text';
/** 支持配置的快捷键身份。 */
export type ActionShortcut = 'Enter' | 'Mod+Enter' | 'Shift+Enter';
export interface ActionMapping {
    /** 回车键对应的动作。 */
    readonly Enter: ClipboardAction;
    /** Mod+Enter 对应的动作。 */
    readonly 'Mod+Enter': ClipboardAction;
    /** Shift+Enter 对应的动作。 */
    readonly 'Shift+Enter': ClipboardAction;
}
/** 默认动作映射；三个快捷键分别绑定不同动作。 */
export declare const DEFAULT_ACTION_MAPPING: ActionMapping;
/** 动作映射校验结果；失败时保留具体字段和原因。 */
export type ActionMappingValidation = {
    readonly valid: true;
    readonly mapping: ActionMapping;
} | {
    readonly valid: false;
    readonly field: ActionShortcut;
    readonly reason: 'duplicate' | 'unsupported';
};
/** 校验动作映射是否覆盖三个动作且不存在重复绑定。 */
export declare function validateActionMapping(mapping: ActionMapping): ActionMappingValidation;
/** 判断某动作是否支持当前剪贴板内容类型。 */
export declare function actionAvailable(action: ClipboardAction, kind: ClipboardKind): boolean;
/** 将动作转换为用户可见标签。 */
export declare function actionLabel(action: ClipboardAction): string;
export interface ActionExecutionPlan {
    /** 最终执行的动作。 */
    readonly action: ClipboardAction;
    /** 目标历史记录身份。 */
    readonly entryId: string;
    /** 是否保留文本的富文本表示。 */
    readonly copyFormatted: boolean;
    /** 是否在复制后尝试自动粘贴。 */
    readonly autoPaste: boolean;
}
/** 将动作和记录转换为平台执行计划；不支持的组合返回 undefined。 */
export declare function planAction(action: ClipboardAction, entry: ClipboardEntry): ActionExecutionPlan | undefined;
