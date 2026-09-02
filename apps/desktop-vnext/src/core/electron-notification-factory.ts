import { Notification } from 'electron'
import type {
  NativeNotification,
  NativeNotificationFactory,
} from './desktop-capabilities-contract.js'

/** Electron 适配只存在于 Desktop Core；这里把原生对象收窄成能力契约。 */
export function createElectronNotificationFactory(): NativeNotificationFactory {
  const factory: NativeNotificationFactory = {
    isSupported: () => Notification.isSupported(),
    create: (options) => {
      const native = new Notification({
        id: options.id,
        title: options.title,
        body: options.body,
        ...(options.actions === undefined ? {} : { actions: [...options.actions] }),
      })
      return wrapNativeNotification(native)
    },
  }
  if (process.platform === 'darwin') factory.remove = (id) => Notification.remove(id)
  return factory
}

function wrapNativeNotification(native: Notification): NativeNotification {
  const emitter = native as unknown as {
    on(event: string, listener: (...args: never[]) => void): void
    removeListener(event: string, listener: (...args: never[]) => void): void
  }
  const wrapped = new Map<string, Map<(...args: unknown[]) => void, (...args: never[]) => void>>()
  return {
    show: () => native.show(),
    close: () => native.close(),
    on: (event, listener) => {
      const handlers = wrapped.get(event) ?? new Map()
      const handler = (...args: never[]) => listener(...args)
      handlers.set(listener, handler)
      wrapped.set(event, handlers)
      emitter.on(event, handler)
    },
    removeListener: (event, listener) => {
      const handler = wrapped.get(event)?.get(listener)
      if (handler === undefined) return
      emitter.removeListener(event, handler)
      wrapped.get(event)?.delete(listener)
    },
  }
}
