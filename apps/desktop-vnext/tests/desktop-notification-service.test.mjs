import assert from 'node:assert/strict'
import test from 'node:test'
import { DesktopNotificationService } from '../lib/core/desktop-notification-service.js'

test('通知显示、替换、动作回调和移除都不携带业务状态', () => {
  const factory = createFactory(true)
  const service = new DesktopNotificationService(factory)
  const owner = {}
  const events = []
  const input = {
    id: 'occ-1', title: '个人事项', body: '吃饭',
    actions: [{ id: 'open', label: '打开' }, { id: 'snooze', label: '稍后提醒' }],
  }

  assert.deepEqual(service.status(), { supported: true, permission: 'unknown' })
  assert.deepEqual(service.show(owner, input, (event) => events.push(event)), { status: 'shown', id: 'occ-1' })
  assert.deepEqual(factory.created[0].options.actions, [
    { type: 'button', text: '打开' }, { type: 'button', text: '稍后提醒' },
  ])
  factory.created[0].emit('click')
  factory.created[0].emit('action', {}, 1)
  factory.created[0].emit('failed', {}, 'native error details')
  assert.deepEqual(events, [
    { kind: 'clicked', id: 'occ-1' },
    { kind: 'action', id: 'occ-1', actionId: 'snooze' },
    { kind: 'failed', id: 'occ-1', failedAt: events[2].failedAt, reason: '系统通知投递失败' },
  ])
  assert.deepEqual(service.show(owner, { ...input, body: '晚餐' }, (event) => events.push(event)), { status: 'shown', id: 'occ-1' })
  assert.equal(factory.created[0].closed, true)
  assert.deepEqual(service.remove(owner, 'occ-1'), { status: 'removed', id: 'occ-1' })
  assert.equal(factory.created[1].closed, true)
})

test('平台不可用时只返回渠道失败，不影响调用方自己的提醒事实', () => {
  const factory = createFactory(false)
  const service = new DesktopNotificationService(factory)
  const result = service.show({}, { id: 'occ-1', title: '个人事项', body: '吃饭' }, () => undefined)
  assert.deepEqual(service.status(), { supported: false, permission: 'unsupported' })
  assert.deepEqual(result, { status: 'unavailable', id: 'occ-1', code: 'PLATFORM_UNSUPPORTED', reason: '当前平台不支持系统通知' })
})

test('generation 清理关闭旧通知但保留下一代 facade', () => {
  const factory = createFactory(true)
  const service = new DesktopNotificationService(factory)
  const owner = {}
  service.show(owner, { id: 'occ-old', title: '个人事项', body: '旧提醒' }, () => undefined)
  service.clear()
  assert.equal(factory.created[0].closed, true)
  assert.deepEqual(service.show(owner, { id: 'occ-new', title: '个人事项', body: '新提醒' }, () => undefined), { status: 'shown', id: 'occ-new' })
})

function createFactory(supported) {
  const factory = {
    created: [],
    isSupported: () => supported,
    create: (options) => {
      const listeners = new Map()
      const notification = {
        options,
        closed: false,
        show: () => { notification.shown = true },
        close: () => { notification.closed = true },
        on: (event, listener) => { listeners.set(`${event}:${listeners.size}`, { event, listener }) },
        removeListener: (event, listener) => {
          for (const [key, item] of listeners) if (item.event === event && item.listener === listener) listeners.delete(key)
        },
        emit: (event, ...args) => { for (const item of listeners.values()) if (item.event === event) item.listener(...args) },
      }
      factory.created.push(notification)
      return notification
    },
    remove: (id) => { factory.removed = [...(factory.removed ?? []), id] },
  }
  return factory
}
