/** Desktop Core 给 bundled DSH 设置页的最小快捷键快照。 */
export interface DesktopShortcutSnapshot {
  readonly id: string
  readonly pluginId: string
  readonly pluginName: string
  readonly commandName: string
  readonly defaultAccelerator: string
  readonly accelerator: string
  readonly status: 'registered' | 'conflict' | 'unavailable'
  readonly reason?: 'internal-conflict' | 'external-or-system-conflict' | 'unsupported'
}

export interface DesktopShortcutUpdateResult {
  readonly applied: boolean
  readonly requestedAccelerator: string
  readonly snapshot: DesktopShortcutSnapshot
  readonly attempt?: DesktopShortcutSnapshot
}

export interface DesktopShortcutFacade {
  list(): Promise<readonly DesktopShortcutSnapshot[]>
  update(id: string, accelerator: string): Promise<DesktopShortcutUpdateResult>
  reset(id: string): Promise<DesktopShortcutUpdateResult>
  observe(listener: () => void): () => void
}

declare global {
  interface Window {
    /** Desktop Core 通过受限 preload 提供的快捷键目录；stock DSH 中不存在。 */
    hermitDesktopShortcuts?: DesktopShortcutFacade
  }
}
