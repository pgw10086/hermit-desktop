import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_ACTION_MAPPING,
  actionAvailable,
  planAction,
  validateActionMapping,
} from '../lib/index.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const textEntry = { id: 'text-1', kind: 'TEXT' }
const imageEntry = { id: 'image-1', kind: 'IMAGE' }

test('manifest 只声明 Smart Clipboard 实际需要的桌面能力', () => {
  const packageRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
  assert.deepEqual(manifest.hermit, {
    type: 'product-plugin',
    desktop: { capabilities: ['system-clipboard', 'global-shortcut', 'quick-surface', 'focus-restore', 'notification'] },
  })
})

test('默认动作映射是一一对应的，三个组合分别覆盖使用、复制和纯文本', () => {
  assert.deepEqual(validateActionMapping(DEFAULT_ACTION_MAPPING), {
    valid: true, mapping: DEFAULT_ACTION_MAPPING,
  })
  assert.equal(actionAvailable('plain-text', 'TEXT'), true)
  assert.equal(actionAvailable('plain-text', 'IMAGE'), false)
})

test('重复或未知动作不能保存，纯文本动作只能规划给 TEXT', () => {
  assert.deepEqual(validateActionMapping({
    Enter: 'copy', 'Mod+Enter': 'copy', 'Shift+Enter': 'plain-text',
  }), { valid: false, field: 'Mod+Enter', reason: 'duplicate' })
  assert.deepEqual(validateActionMapping({
    Enter: 'use', 'Mod+Enter': 'copy', 'Shift+Enter': 'other',
  }), { valid: false, field: 'Shift+Enter', reason: 'unsupported' })
  assert.equal(planAction('plain-text', imageEntry), undefined)
  assert.deepEqual(planAction('use', textEntry), {
    action: 'use', entryId: 'text-1', copyFormatted: true, autoPaste: true,
  })
})
