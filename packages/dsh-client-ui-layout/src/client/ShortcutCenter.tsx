import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button, IconChecklistOutline14, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DesktopShortcutFacade, DesktopShortcutSnapshot } from './shortcut-contract.ts'
import css from './ShortcutCenter.module.css'

/** Core-owned 快捷键设置页；DSH 只负责展示和把用户操作转回 Core。 */
export function ShortcutCenter(_props: SettingsSectionOwnerProps): ReactNode {
  const [snapshots, setSnapshots] = useState<readonly DesktopShortcutSnapshot[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [pendingId, setPendingId] = useState<string>()
  const [feedback, setFeedback] = useState<string>()
  const [loadError, setLoadError] = useState<string>()
  const facade = window.hermitDesktopShortcuts

  useEffect(() => {
    if (facade === undefined) {
      setLoadError('Desktop Core 快捷键能力不可用')
      return
    }
    let mounted = true
    const refresh = async (): Promise<void> => {
      try {
        const next = await facade.list()
        if (!mounted) return
        setSnapshots(next)
        setDrafts((current) => Object.fromEntries(next.map((snapshot) => [snapshot.id, current[snapshot.id] ?? snapshot.accelerator])))
        setLoadError(undefined)
      } catch (cause) {
        if (mounted) setLoadError(cause instanceof Error ? cause.message : '快捷键列表暂时无法读取')
      }
    }
    const unsubscribe = facade.observe(() => { void refresh() })
    void refresh()
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [facade])

  const groups = useMemo(() => groupShortcuts(snapshots), [snapshots])
  if (loadError !== undefined) {
    return <section className={css.root} data-hermit-shortcut-center="unavailable"><p className={css.state}>{loadError}</p></section>
  }

  const update = async (snapshot: DesktopShortcutSnapshot): Promise<void> => {
    if (facade === undefined) return
    const accelerator = drafts[snapshot.id] ?? snapshot.accelerator
    setPendingId(snapshot.id)
    try {
      const result = await facade.update(snapshot.id, accelerator)
      if (result.applied) {
        setFeedback(`${snapshot.commandName} 已保存`)
        setDrafts((current) => ({ ...current, [snapshot.id]: result.snapshot.accelerator }))
      } else {
        setFeedback(`${snapshot.commandName} 未修改：${shortcutFailureMessage(result.attempt ?? result.snapshot)}`)
      }
      const next = await facade.list()
      setSnapshots(next)
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : '快捷键未修改')
    } finally {
      setPendingId(undefined)
    }
  }

  const reset = async (snapshot: DesktopShortcutSnapshot): Promise<void> => {
    if (facade === undefined) return
    setPendingId(snapshot.id)
    try {
      const result = await facade.reset(snapshot.id)
      if (result.applied) {
        setFeedback(`${snapshot.commandName} 已恢复默认`)
        setDrafts((current) => ({ ...current, [snapshot.id]: result.snapshot.accelerator }))
      } else {
        setFeedback(`${snapshot.commandName} 未修改：${shortcutFailureMessage(result.attempt ?? result.snapshot)}`)
      }
      setSnapshots(await facade.list())
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : '快捷键未修改')
    } finally {
      setPendingId(undefined)
    }
  }

  return (
    <section className={css.root} data-hermit-shortcut-center="ready">
      <header className={css.header}>
        <div>
          <h2>快捷键</h2>
        </div>
      </header>
      {groups.length === 0
        ? <p className={css.state}>当前没有可用的桌面快捷键</p>
        : groups.map((group) => (
          <section className={css.group} key={group.pluginId}>
            <h3>{group.pluginName}</h3>
            {group.items.map((snapshot) => {
              const draft = drafts[snapshot.id] ?? snapshot.accelerator
              const dirty = draft !== snapshot.accelerator
              return (
                <div className={css.row} key={snapshot.id} data-shortcut-status={snapshot.status}>
                  <div className={css.command}>
                    <strong>{snapshot.commandName}</strong>
                    <span data-shortcut-state={snapshot.status}>{shortcutStatusLabel(snapshot)}</span>
                  </div>
                  <div className={css.actions}>
                    <input
                      className={css.accelerator}
                      aria-label={`${snapshot.pluginName} ${snapshot.commandName}`}
                      value={formatAccelerator(draft)}
                      readOnly
                      onKeyDown={(event) => recordShortcut(event, snapshot.id)}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <Button type="button" variant="outline" size="sm" disabled={!dirty || pendingId !== undefined} onClick={() => { void update(snapshot) }}>应用</Button>
                    <Button type="button" variant="ghost" size="sm" disabled={pendingId !== undefined} onClick={() => { void reset(snapshot) }}>恢复默认</Button>
                  </div>
                </div>
              )
            })}
          </section>
        ))}
      {feedback !== undefined && <Toast text={feedback} icon={<IconChecklistOutline14 size={14} />} onDone={() => setFeedback(undefined)} />}
    </section>
  )

  function recordShortcut(event: KeyboardEvent<HTMLInputElement>, id: string): void {
    const accelerator = readAccelerator(event)
    if (accelerator === undefined) return
    event.preventDefault()
    setDrafts((current) => ({ ...current, [id]: accelerator }))
  }
}

function groupShortcuts(snapshots: readonly DesktopShortcutSnapshot[]): readonly {
  readonly pluginId: string
  readonly pluginName: string
  readonly items: readonly DesktopShortcutSnapshot[]
}[] {
  const groups = new Map<string, { pluginId: string; pluginName: string; items: DesktopShortcutSnapshot[] }>()
  for (const snapshot of snapshots) {
    const group = groups.get(snapshot.pluginId) ?? { pluginId: snapshot.pluginId, pluginName: snapshot.pluginName, items: [] }
    group.items.push(snapshot)
    groups.set(snapshot.pluginId, group)
  }
  return [...groups.values()]
}

function shortcutStatusLabel(snapshot: DesktopShortcutSnapshot): string {
  if (snapshot.status === 'registered') return '已注册'
  if (snapshot.reason === 'internal-conflict') return '与 Hermit 其他命令冲突'
  if (snapshot.reason === 'unsupported') return '当前环境不可用'
  return '与其他应用或系统功能冲突'
}

function shortcutFailureMessage(snapshot: DesktopShortcutSnapshot): string {
  if (snapshot.reason === 'internal-conflict') return '与 Hermit 其他命令冲突'
  if (snapshot.reason === 'unsupported') return '当前环境不支持这个组合'
  return '与其他应用或系统功能冲突'
}

function formatAccelerator(accelerator: string): string {
  const modifier = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl'
  return accelerator.replaceAll('CommandOrControl', modifier).replaceAll('+', ' + ')
}

function readAccelerator(event: KeyboardEvent<HTMLInputElement>): string | undefined {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return undefined
  const modifiers = [
    event.ctrlKey || event.metaKey ? 'CommandOrControl' : undefined,
    event.altKey ? 'Alt' : undefined,
    event.shiftKey ? 'Shift' : undefined,
  ].filter((value): value is string => value !== undefined)
  const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key
  return [...modifiers, key].join('+')
}
