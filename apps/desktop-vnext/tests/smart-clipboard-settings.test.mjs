import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { SmartClipboardSettingsStore } from '../lib/core/smart-clipboard/settings.js'

test('设置文件原子写入并在损坏时回到产品默认值', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-smart-settings-'))
  const file = path.join(root, 'nested', 'settings.json')
  try {
    const store = new SmartClipboardSettingsStore(file)
    assert.equal(store.read().historyLimit, 100)
    store.write({
      historyLimit: 200, totalBytes: 2048, retention: 90, paused: true,
      actionMapping: { Enter: 'copy', 'Mod+Enter': 'paste', 'Shift+Enter': 'plain-text' },
      excludedApplications: ['com.example.secret'], excludedKinds: ['IMAGE'],
    })
    assert.equal(store.read().historyLimit, 200)
    assert.equal(store.read().actionMappingVersion, 2)
    fs.writeFileSync(file, JSON.stringify({
      historyLimit: 200, totalBytes: 2048, retention: 90, paused: true,
      actionMapping: { Enter: 'use', 'Mod+Enter': 'copy', 'Shift+Enter': 'plain-text' },
      excludedApplications: [], excludedKinds: [],
    }), 'utf8')
    assert.deepEqual(store.read().actionMapping, {
      Enter: 'copy', 'Mod+Enter': 'paste', 'Shift+Enter': 'plain-text',
    })
    fs.writeFileSync(file, JSON.stringify({
      historyLimit: 200, totalBytes: 2048, retention: 90, paused: true,
      actionMappingVersion: 2,
      actionMapping: { Enter: 'paste', 'Mod+Enter': 'copy', 'Shift+Enter': 'plain-text' },
      excludedApplications: [], excludedKinds: [],
    }), 'utf8')
    assert.deepEqual(store.read().actionMapping, {
      Enter: 'paste', 'Mod+Enter': 'copy', 'Shift+Enter': 'plain-text',
    })
    fs.writeFileSync(file, '{broken', 'utf8')
    assert.deepEqual(store.read(), {
      historyLimit: 100, totalBytes: 1_000_000_000, retention: 'forever', paused: false,
      actionMapping: { Enter: 'copy', 'Mod+Enter': 'paste', 'Shift+Enter': 'plain-text' },
      actionMappingVersion: 2,
      excludedApplications: [], excludedKinds: [],
    })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
