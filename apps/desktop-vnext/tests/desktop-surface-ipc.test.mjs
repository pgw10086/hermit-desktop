import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDesktopSurfaceRequest } from '@hermit/desktop-core'

test('Desktop Surface IPC 只接受有限的生命周期操作和语义化选项', () => {
  assert.deepEqual(parseDesktopSurfaceRequest({ op: 'capabilities' }), { op: 'capabilities' })
  assert.deepEqual(parseDesktopSurfaceRequest({
    op: 'toggle',
    id: 'conversation.quick',
    options: { anchor: 'cursor', placement: 'adjacent', preferredSize: { width: 720, height: 620 }, alwaysOnTop: true, session: { type: 'existing', sessionId: 'session-1' } },
  }), {
    op: 'toggle',
    id: 'conversation.quick',
    options: { anchor: 'cursor', placement: 'adjacent', preferredSize: { width: 720, height: 620 }, alwaysOnTop: true, session: { type: 'existing', sessionId: 'session-1' } },
  })
  assert.deepEqual(parseDesktopSurfaceRequest({ op: 'close', id: 'conversation.quick' }), {
    op: 'close', id: 'conversation.quick',
  })
  assert.deepEqual(parseDesktopSurfaceRequest({ op: 'resize', id: 'conversation.quick', size: { width: 720, height: 200 } }), {
    op: 'resize', id: 'conversation.quick', size: { width: 720, height: 200 },
  })
  assert.deepEqual(parseDesktopSurfaceRequest({ op: 'resize', id: 'conversation.quick', size: { width: 560, height: 120 } }), {
    op: 'resize', id: 'conversation.quick', size: { width: 560, height: 120 },
  })
  assert.deepEqual(parseDesktopSurfaceRequest({ op: 'open-main-session', sessionId: 'session-1' }), {
    op: 'open-main-session', sessionId: 'session-1',
  })
  assert.throws(() => parseDesktopSurfaceRequest({ op: 'open', id: '' }), /id 无效/u)
  assert.throws(() => parseDesktopSurfaceRequest({ op: 'open', id: 'x', options: { alwaysOnTop: 'yes' } }), /alwaysOnTop 无效/u)
  assert.throws(() => parseDesktopSurfaceRequest({ op: 'open', id: 'x', options: { preferredSize: { width: 32, height: 200 } } }), /size 超出范围/u)
  assert.throws(() => parseDesktopSurfaceRequest({ op: 'open', id: 'x', options: { session: { type: 'existing' } } }), /sessionId 无效/u)
  assert.throws(() => parseDesktopSurfaceRequest({ op: 'open', id: 'x', options: { session: { type: 'last-bound', sessionId: 'unexpected' } } }), /只能用于 existing/u)
  assert.throws(() => parseDesktopSurfaceRequest({ op: 'open-main-session', sessionId: '' }), /sessionId 无效/u)
})
