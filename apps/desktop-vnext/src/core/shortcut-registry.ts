import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { EvidenceSink } from '../desktop/evidence.js'

/** Desktop Core 使用的最小系统快捷键端口，隐藏 Electron globalShortcut。 */
export interface ShortcutPlatformPort {
  /** 向系统申请全局快捷键。返回值只表示系统是否接受了申请。 */
  register(accelerator: string, callback: () => void): boolean
  /** 确认快捷键当前确实由本应用占用。 */
  isRegistered(accelerator: string): boolean
  /** 释放本应用占用的快捷键。 */
  unregister(accelerator: string): void
}

/** Core 读取和保存所有插件快捷键偏好的窄存储接口。 */
export interface ShortcutSettingsStore {
  read(id: string): string | undefined
  write(id: string, accelerator: string): void
  delete(id: string): void
}

export type ShortcutStatus = 'registered' | 'conflict' | 'unavailable'
export type ShortcutFailureReason = 'internal-conflict' | 'external-or-system-conflict' | 'unsupported'

export interface ShortcutRequest {
  readonly id: string
  readonly pluginId: string
  readonly pluginName: string
  readonly commandName: string
  readonly defaultAccelerator: string
  readonly onTrigger: () => void
}

export interface ShortcutSnapshot {
  readonly id: string
  readonly pluginId: string
  readonly pluginName: string
  readonly commandName: string
  readonly defaultAccelerator: string
  /** 当前正在尝试或已经注册的 Electron accelerator。 */
  readonly accelerator: string
  readonly status: ShortcutStatus
  readonly reason?: ShortcutFailureReason
}

export interface ShortcutRegistration {
  readonly snapshot: ShortcutSnapshot
  dispose(): void
}

export interface ShortcutUpdateResult {
  /** 新组合是否已经替换成功。 */
  readonly applied: boolean
  /** 用户本次提交的组合；失败时用于界面说明哪一次尝试冲突。 */
  readonly requestedAccelerator: string
  /** 更新后的实际状态；失败时仍是原来可用的状态。 */
  readonly snapshot: ShortcutSnapshot
  /** 失败时记录用户刚才尝试的组合，供统一设置页直接说明冲突。 */
  readonly attempt?: ShortcutSnapshot
}

interface ActiveShortcut {
  readonly request: ShortcutRequest
  readonly accelerator: string
  readonly token: symbol
}

/**
 * Desktop Core 的快捷键唯一注册入口。
 *
 * 这里把“内部冲突”和“系统/其他应用冲突”分开，前者不调用系统 API，后者以系统真实
 * 返回为准。注册失败是一个可展示的能力状态，不是整个插件启动失败。
 */
export class ShortcutRegistry {
  readonly #port: ShortcutPlatformPort
  readonly #settings: ShortcutSettingsStore
  readonly #evidence: EvidenceSink | undefined
  readonly #requests = new Map<string, ShortcutRequest>()
  readonly #active = new Map<string, ActiveShortcut>()
  readonly #snapshots = new Map<string, ShortcutSnapshot>()
  readonly #listeners = new Set<() => void>()

  constructor(options: {
    readonly port: ShortcutPlatformPort
    readonly settings: ShortcutSettingsStore
    readonly evidence?: EvidenceSink
  }) {
    this.#port = options.port
    this.#settings = options.settings
    this.#evidence = options.evidence
  }

  /** 注册一个插件桌面命令；已存在的同 ID 绑定会先释放。 */
  register(request: ShortcutRequest): ShortcutRegistration {
    this.dispose(request.id)
    this.#requests.set(request.id, request)
    const accelerator = this.#settings.read(request.id) ?? request.defaultAccelerator
    const token = Symbol(request.id)
    const snapshot = this.#tryRegister(request, accelerator, token)
    if (snapshot.status === 'registered') {
      this.#active.set(request.id, { request, accelerator: snapshot.accelerator, token })
    }
    this.#snapshots.set(request.id, snapshot)
    this.#notify()
    return {
      snapshot,
      dispose: () => { if (this.#active.get(request.id)?.token === token) this.dispose(request.id) },
    }
  }

  /** 返回某个插件快捷键的最新状态。 */
  get(id: string): ShortcutSnapshot | undefined {
    return this.#snapshots.get(id)
  }

  /** 返回当前生命周期内真实注册过的命令，供 DSH 快捷键中心分组展示。 */
  list(): readonly ShortcutSnapshot[] {
    return [...this.#snapshots.values()].sort((left, right) =>
      left.pluginId.localeCompare(right.pluginId) || left.id.localeCompare(right.id))
  }

  /**
   * 尝试替换快捷键。新组合注册成功后才释放旧组合；因此冲突不会造成原快捷键丢失。
   */
  update(id: string, requestedAccelerator: string): ShortcutUpdateResult {
    const request = this.#requests.get(id)
    if (request === undefined) throw new Error(`快捷键未注册：${id}`)
    const current = this.#active.get(id)
    const normalized = requestedAccelerator.trim()
    if (current !== undefined && current.accelerator === normalized) {
      const snapshot = this.#snapshots.get(id) ?? {
        id,
        pluginId: request.pluginId,
        pluginName: request.pluginName,
        commandName: request.commandName,
        defaultAccelerator: request.defaultAccelerator,
        accelerator: normalized,
        status: 'registered' as const,
      }
      return { applied: true, requestedAccelerator, snapshot }
    }
    const token = Symbol(id)
    const attempt = this.#tryRegister(request, requestedAccelerator, token)
    if (attempt.status !== 'registered') {
      const snapshot = this.#snapshots.get(id) ?? attempt
      return { applied: false, requestedAccelerator, snapshot, attempt }
    }

    try {
      this.#settings.write(id, attempt.accelerator)
    } catch (cause) {
      // 新组合已经向系统注册但偏好写盘失败时，保留旧组合并撤销新组合。
      this.#port.unregister(attempt.accelerator)
      throw cause
    }
    if (current !== undefined) this.#port.unregister(current.accelerator)
    this.#active.set(id, {
      request,
      accelerator: attempt.accelerator,
      token,
    })
    this.#snapshots.set(id, attempt)
    this.#notify()
    return { applied: true, requestedAccelerator, snapshot: attempt }
  }

  /** 恢复注册定义中的默认组合；成功后才删除用户自定义值。 */
  reset(id: string): ShortcutUpdateResult {
    const request = this.#requests.get(id)
    if (request === undefined) throw new Error(`快捷键未注册：${id}`)
    const result = this.update(id, request.defaultAccelerator)
    if (result.applied) this.#settings.delete(id)
    return result
  }

  /** 订阅状态变化；调用方停用时必须释放返回的订阅器。 */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** 释放一个插件持有的系统快捷键和注册状态。 */
  dispose(id: string): void {
    const active = this.#active.get(id)
    if (active !== undefined) {
      this.#port.unregister(active.accelerator)
      this.#active.delete(id)
    }
    this.#requests.delete(id)
    this.#snapshots.delete(id)
    this.#notify()
  }

  /** 应用退出或 Core 关闭时释放全部快捷键。 */
  disposeAll(): void {
    for (const id of this.#requests.keys()) this.dispose(id)
  }

  #tryRegister(request: ShortcutRequest, requestedAccelerator: string, token: symbol): ShortcutSnapshot {
    const accelerator = requestedAccelerator.trim()
    const base = {
      id: request.id,
      pluginId: request.pluginId,
      pluginName: request.pluginName,
      commandName: request.commandName,
      defaultAccelerator: request.defaultAccelerator,
      accelerator,
    }
    if (accelerator.length === 0) return this.#record({ ...base, status: 'unavailable', reason: 'unsupported' })
    const internalConflict = [...this.#active.entries()].some(([id, active]) => id !== request.id && active.accelerator === accelerator)
    if (internalConflict) return this.#record({ ...base, status: 'conflict', reason: 'internal-conflict' })
    try {
      const accepted = this.#port.register(accelerator, () => {
        const active = this.#active.get(request.id)
        if (active === undefined || active.accelerator !== accelerator || active.token !== token) return
        this.#evidence?.record('desktop.shortcut-triggered', { id: request.id, accelerator })
        request.onTrigger()
      })
      const registered = accepted && this.#port.isRegistered(accelerator)
      if (!registered) return this.#record({ ...base, status: 'conflict', reason: 'external-or-system-conflict' }, { accepted, registered })
      return this.#record({ ...base, status: 'registered' }, { accepted, registered })
    } catch {
      return this.#record({ ...base, status: 'unavailable', reason: 'unsupported' })
    }
  }

  #record(snapshot: ShortcutSnapshot, result?: { readonly accepted: boolean; readonly registered: boolean }): ShortcutSnapshot {
    this.#evidence?.record('desktop.shortcut-registration', {
      id: snapshot.id,
      accelerator: snapshot.accelerator,
      status: snapshot.status,
      ...(snapshot.reason === undefined ? {} : { reason: snapshot.reason }),
      ...(result === undefined ? {} : result),
    })
    return snapshot
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }
}

/** 基于文件的快捷键配置存储；只保存用户成功应用过的快捷键。 */
export class FileShortcutSettingsStore implements ShortcutSettingsStore {
  readonly #path: string

  constructor(filePath: string) {
    this.#path = filePath
  }

  read(id: string): string | undefined {
    const settings = this.#readAll()
    const accelerator = settings[id]
    return typeof accelerator === 'string' && accelerator.trim().length > 0 ? accelerator.trim() : undefined
  }

  write(id: string, accelerator: string): void {
    const settings = this.#readAll()
    settings[id] = accelerator
    const directory = dirname(this.#path)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const temporary = `${this.#path}.tmp-${String(process.pid)}`
    writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, this.#path)
  }

  delete(id: string): void {
    const settings = this.#readAll()
    if (!(id in settings)) return
    delete settings[id]
    mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 })
    const temporary = `${this.#path}.${process.pid}.tmp`
    writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, this.#path)
  }

  #readAll(): Record<string, string> {
    try {
      const value = JSON.parse(readFileSync(this.#path, 'utf8')) as unknown
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
      return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    } catch {
      return {}
    }
  }
}
