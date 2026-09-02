import { useState, type ReactNode } from 'react'
import {
  Button,
  DisclosureRow,
  IconChecklistOutline14,
  IconDownloadOutline16,
  IconSettingsOutline16,
  IconTrashOutline16,
  IconWarningOutline16,
  Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { actionLabel, validateActionMapping, type ActionShortcut, type ClipboardAction } from '../actions.js'
import type { ClipboardKind } from '../full-history.js'
import { kindLabel, type SmartClipboardSettings } from './api.js'
import { formatBytes, parseRetentionInput } from './history-presenters.js'
import css from './SettingsView.module.css'

export interface SettingsViewProps {
  /** 最近一次成功保存的设置。 */
  readonly saved: SmartClipboardSettings
  /** 当前正在编辑的设置草稿。 */
  readonly draft: SmartClipboardSettings
  /** 更新设置草稿。 */
  readonly onChange: (settings: SmartClipboardSettings) => void
  /** 保存设置。 */
  readonly onSave: () => void
  /** 导出历史数据。 */
  readonly onExport: (includeTrash: boolean) => void
  /** 清理非固定历史。 */
  readonly onClearHistory: () => void
  /** 清空废纸篓。 */
  readonly onEmptyTrash: () => void
  /** 清空全部剪贴板数据。 */
  readonly onClearAllData: () => void
}

/** 剪贴板历史设置面板；只编辑草稿，不直接调用 Host API。 */
export function SettingsView(props: SettingsViewProps): ReactNode {
  const [limitsOpen, setLimitsOpen] = useState(true)
  const [mappingOpen, setMappingOpen] = useState(true)
  const [exclusionsOpen, setExclusionsOpen] = useState(false)
  const [dataOpen, setDataOpen] = useState(true)
  const [includeTrash, setIncludeTrash] = useState(false)
  const mappingValidation = validateActionMapping(props.draft.actionMapping)
  const dirty = JSON.stringify(props.saved) !== JSON.stringify(props.draft)
  /** 更新单个快捷键动作并等待统一校验。 */
  const updateMapping = (shortcut: ActionShortcut, action: ClipboardAction): void => {
    props.onChange({ ...props.draft, actionMapping: { ...props.draft.actionMapping, [shortcut]: action } })
  }

  return (
    <main className={css.settingsView} data-smart-clipboard-settings-form>
      <div className={css.settingsIntro}>
        <div>
          <h2>记录与数据</h2>
          <p>设置只影响新的记录和本地保留。</p>
        </div>
        <Button type="button" variant="primary" disabled={!dirty || !mappingValidation.valid} onClick={props.onSave}>保存设置</Button>
      </div>

      <DisclosureRow
        icon={<IconSettingsOutline16 size={16} />}
        title="保留与容量"
        open={limitsOpen}
        expandable
        expandOnRowClick
        onToggle={() => setLimitsOpen((value) => !value)}
      >
        <div className={css.settingsGrid}>
          <label className={css.settingField}>
            <span>普通历史条数</span>
            <Input type="number" min={1} value={props.draft.historyLimit} onChange={(event) => props.onChange({ ...props.draft, historyLimit: Number(event.currentTarget.value) })} />
            <small>置顶记录不占普通历史条数。</small>
          </label>
          <label className={css.settingField}>
            <span>本地容量上限（MB）</span>
            <Input type="number" min={1} value={Math.max(1, Math.round(props.draft.totalBytes / (1024 * 1024)))} onChange={(event) => props.onChange({ ...props.draft, totalBytes: Number(event.currentTarget.value) * 1024 * 1024 })} />
            <small>当前上限 {formatBytes(props.draft.totalBytes)}，置顶和 Trash 都计入容量。</small>
          </label>
          <label className={css.settingField}>
            <span>保留期限</span>
            <select className={css.nativeControl} value={props.draft.retention} onChange={(event) => props.onChange({ ...props.draft, retention: parseRetentionInput(event.currentTarget.value) })}>
              <option value="forever">永不过期</option>
              <option value={30}>30 天</option>
              <option value={90}>90 天</option>
              <option value={365}>1 年</option>
            </select>
            <small>置顶记录不受保留期限影响。</small>
          </label>
        </div>
      </DisclosureRow>

      <DisclosureRow
        icon={<IconChecklistOutline14 size={14} />}
        title="快捷动作"
        open={mappingOpen}
        expandable
        expandOnRowClick
        onToggle={() => setMappingOpen((value) => !value)}
      >
        <div className={css.mappingGrid}>
          {(['Enter', 'Mod+Enter', 'Shift+Enter'] as const).map((shortcut) => (
            <label className={css.mappingRow} key={shortcut}>
              <kbd>{shortcut}</kbd>
              <select className={css.nativeControl} value={props.draft.actionMapping[shortcut]} onChange={(event) => updateMapping(shortcut, event.currentTarget.value as ClipboardAction)}>
                <option value="paste">{actionLabel('paste')}</option>
                <option value="copy">{actionLabel('copy')}</option>
                <option value="plain-text">{actionLabel('plain-text')}</option>
              </select>
            </label>
          ))}
          {!mappingValidation.valid && <p className={css.validationError} role="alert">三个快捷组合必须分别对应三个不同动作，保存前请消除重复。</p>}
        </div>
      </DisclosureRow>

      <DisclosureRow
        icon={<IconWarningOutline16 size={16} />}
        title="不记录的内容"
        open={exclusionsOpen}
        expandable
        expandOnRowClick
        onToggle={() => setExclusionsOpen((value) => !value)}
      >
        <div className={css.exclusionFields}>
          <fieldset>
            <legend>内容类型</legend>
            {(['TEXT', 'IMAGE', 'FILE_LIST'] as const).map((kind: ClipboardKind) => (
              <label className={css.checkField} key={kind}>
                <input
                  type="checkbox"
                  checked={props.draft.excludedKinds.includes(kind)}
                  onChange={(event) => props.onChange({
                    ...props.draft,
                    excludedKinds: event.currentTarget.checked
                      ? [...props.draft.excludedKinds, kind]
                      : props.draft.excludedKinds.filter((value) => value !== kind),
                  })}
                />
                <span>{kindLabel(kind)}</span>
              </label>
            ))}
          </fieldset>
          <label className={css.settingField}>
            <span>来源应用标识（每行一个）</span>
            <textarea
              className={css.textarea}
              value={props.draft.excludedApplications.join('\n')}
              onChange={(event) => props.onChange({
                ...props.draft,
                excludedApplications: event.currentTarget.value.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean),
              })}
            />
          </label>
        </div>
      </DisclosureRow>

      <DisclosureRow
        icon={<IconDownloadOutline16 size={16} />}
        title="导出与清理"
        open={dataOpen}
        expandable
        expandOnRowClick
        onToggle={() => setDataOpen((value) => !value)}
      >
        <div className={css.dataActions}>
          <div className={css.dataActionRow}>
            <div><strong>导出本地快照</strong><p>导出 History 的 Canonical 内容和元数据，不触发网络请求。</p></div>
            <div className={css.inlineActions}>
              <label className={css.checkField}><input type="checkbox" checked={includeTrash} onChange={(event) => setIncludeTrash(event.currentTarget.checked)} /><span>包含 Trash</span></label>
              <Button type="button" variant="outline" size="sm" icon={<IconDownloadOutline16 size={16} />} onClick={() => props.onExport(includeTrash)}>导出</Button>
            </div>
          </div>
          <div className={css.dataActionRow}>
            <div><strong>清空普通历史</strong><p>永久删除所有未置顶 History，不影响置顶记录和 Trash。</p></div>
            <Button type="button" variant="ghost" size="sm" onClick={props.onClearHistory}>清空</Button>
          </div>
          <div className={css.dataActionRow}>
            <div><strong>清空 Trash</strong><p>永久删除 Trash 中的所有记录，无法恢复。</p></div>
            <Button type="button" variant="ghost" size="sm" onClick={props.onEmptyTrash}>清空</Button>
          </div>
          <div className={css.dataActionRow} data-danger="true">
            <div><strong>清空所有剪贴板内容</strong><p>永久删除 History、置顶、Trash、索引和预览缓存，保留当前设置。</p></div>
            <Button type="button" variant="ghost" size="sm" icon={<IconTrashOutline16 size={16} />} onClick={props.onClearAllData}>清空所有内容</Button>
          </div>
        </div>
      </DisclosureRow>
    </main>
  )
}
