import assert from 'node:assert/strict'
import test from 'node:test'
import { DesktopDeadlineService } from '@hermit/desktop-core'

test('绝对 deadline 可重设、取消，并只触发当前注册', () => {
  const clock = createClock()
  const service = new DesktopDeadlineService(clock)
  const owner = {}
  const fired = []

  assert.deepEqual(service.arm(owner, { id: 'occ-1', fireAt: '2026-09-02T00:00:10.000Z' }, (event) => fired.push(event)), {
    status: 'armed', id: 'occ-1', fireAt: '2026-09-02T00:00:10.000Z',
  })
  assert.deepEqual(service.arm(owner, { id: 'occ-1', fireAt: '2026-09-02T00:00:20.000Z' }, (event) => fired.push(event)), {
    status: 'armed', id: 'occ-1', fireAt: '2026-09-02T00:00:20.000Z',
  })
  clock.advanceTo(Date.parse('2026-09-02T00:00:10.000Z'))
  assert.deepEqual(fired, [])
  clock.advanceTo(Date.parse('2026-09-02T00:00:20.000Z'))
  assert.equal(fired.length, 1)
  assert.equal(fired[0].id, 'occ-1')
  assert.deepEqual(service.cancel(owner, 'occ-1'), { status: 'canceled', id: 'occ-1' })
})

test('deadline 按 owner 隔离，停止后不再产生事件', () => {
  const clock = createClock()
  const service = new DesktopDeadlineService(clock)
  const first = {}
  const second = {}
  const fired = []
  service.arm(first, { id: 'occ-1', fireAt: '2026-09-02T00:00:01.000Z' }, (event) => fired.push(event))
  assert.deepEqual(service.arm(second, { id: 'occ-1', fireAt: '2026-09-02T00:00:02.000Z' }, () => undefined), {
    status: 'unavailable', id: 'occ-1', code: 'ID_IN_USE', reason: 'deadline id 已被其他窗口使用',
  })
  service.disposeOwner(first)
  clock.advanceTo(Date.parse('2026-09-02T00:00:03.000Z'))
  assert.deepEqual(fired, [])
  service.dispose()
  assert.deepEqual(service.arm(second, { id: 'occ-2', fireAt: '2026-09-02T00:00:04.000Z' }, () => undefined), {
    status: 'unavailable', id: 'occ-2', code: 'OWNER_UNLOADED', reason: 'Desktop Core 已停止',
  })
})

test('generation 清理撤销当前等待但不关闭下一代 facade', () => {
  const clock = createClock()
  const service = new DesktopDeadlineService(clock)
  const owner = {}
  const fired = []
  service.arm(owner, { id: 'occ-old', fireAt: '2026-09-02T00:00:01.000Z' }, (event) => fired.push(event))
  service.clear()
  clock.advanceTo(Date.parse('2026-09-02T00:00:02.000Z'))
  assert.deepEqual(fired, [])
  assert.equal(service.arm(owner, { id: 'occ-new', fireAt: '2026-09-02T00:00:03.000Z' }, (event) => fired.push(event)).status, 'armed')
})

function createClock() {
  let now = Date.parse('2026-09-02T00:00:00.000Z')
  let nextId = 0
  const timers = new Map()
  return {
    now: () => now,
    setTimeout: (callback, delay) => {
      const id = ++nextId
      timers.set(id, { callback, at: now + delay })
      return id
    },
    clearTimeout: (id) => timers.delete(id),
    advanceTo: (target) => {
      now = target
      for (const [id, timer] of [...timers]) {
        if (timer.at > target) continue
        timers.delete(id)
        timer.callback()
      }
    },
  }
}
