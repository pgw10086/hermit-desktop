import type { BundledPluginProfileOptions, BundledPluginProfileResult } from './bundled-plugin-profile.js'
import { ensureBundledPluginProfile } from './bundled-plugin-profile.js'

const PACKAGE_NAME = '@hermit/smart-clipboard'

/** Smart Clipboard profile 所需参数，package 身份由本模块固定。 */
export type SmartClipboardProfileOptions = Omit<BundledPluginProfileOptions, 'packageName' | 'markerName'>
/** Smart Clipboard profile 更新结果。 */
export type SmartClipboardProfileResult = BundledPluginProfileResult

/** 确保 Smart Clipboard 使用当前随包制品，并返回 profile 状态。 */
export function ensureSmartClipboardProfile(options: SmartClipboardProfileOptions): SmartClipboardProfileResult {
  return ensureBundledPluginProfile({ ...options, packageName: PACKAGE_NAME, markerName: 'smart-clipboard' })
}
