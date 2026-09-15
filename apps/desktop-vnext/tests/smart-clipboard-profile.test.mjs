import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { migrateLegacyPluginProfiles } from '../lib/runtime/bundled-plugin-profile.js'
import { ensureSmartClipboardProfile } from '../lib/runtime/smart-clipboard-profile.js'

test('Smart Clipboard profile 首次安装、制品刷新，并尊重停用和卸载状态', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-smart-profile-'))
  const pluginPath = path.join(root, 'plugin')
  const fakeNode = path.join(root, 'fake-node.mjs')
  fs.mkdirSync(path.join(pluginPath, 'lib'), { recursive: true })
  fs.writeFileSync(path.join(pluginPath, 'package.json'), JSON.stringify({ name: '@tianbuyv/smart-clipboard', version: '0.1.0', hermit: { type: 'product-plugin' }, exports: { './package.json': './package.json' } }))
  fs.writeFileSync(path.join(pluginPath, 'lib', 'index.js'), 'export const revision = 1\n')
  fs.writeFileSync(fakeNode, `
import fs from 'node:fs'
import path from 'node:path'
const home = process.env.DSH_HOME
const dir = path.join(home, 'profiles', 'web')
const plugin = process.argv.at(-1)
const installed = path.join(dir, 'node_modules', '@tianbuyv', 'smart-clipboard')
fs.mkdirSync(path.dirname(installed), { recursive: true })
fs.rmSync(installed, { recursive: true, force: true })
fs.cpSync(plugin, installed, { recursive: true })
const relative = path.relative(dir, plugin).split(path.sep).join('/')
fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { '@tianbuyv/smart-clipboard': 'file:' + relative }, dsh: { profile: { bundles: ['@tianbuyv/smart-clipboard'] } } }))
fs.appendFileSync(process.env.CALLS, 'add\\n')
`)
  const calls = path.join(root, 'calls.log')
  const environment = { ...process.env, PATH: path.dirname(process.execPath), DSH_HOME: path.join(root, 'home'), CALLS: calls }
  try {
    assert.deepEqual(
      ensureSmartClipboardProfile({ nodeBinary: process.execPath, dshEntry: fakeNode, profileHome: environment.DSH_HOME, pluginPath, environment }),
      { state: 'active', artifactUpdated: false },
    )
    const profilePath = path.join(environment.DSH_HOME, 'profiles', 'web', 'package.json')
    assert.equal(JSON.parse(fs.readFileSync(profilePath, 'utf8')).dsh.profile.bundles[0], '@tianbuyv/smart-clipboard')
    assert.equal(fs.readFileSync(calls, 'utf8'), 'add\n')

    assert.deepEqual(
      ensureSmartClipboardProfile({ nodeBinary: process.execPath, dshEntry: fakeNode, profileHome: environment.DSH_HOME, pluginPath, environment }),
      { state: 'active', artifactUpdated: false },
    )
    assert.equal(fs.readFileSync(calls, 'utf8'), 'add\n')

    fs.writeFileSync(path.join(pluginPath, 'lib', 'index.js'), 'export const revision = 2\n')
    assert.deepEqual(
      ensureSmartClipboardProfile({ nodeBinary: process.execPath, dshEntry: fakeNode, profileHome: environment.DSH_HOME, pluginPath, environment }),
      { state: 'active', artifactUpdated: true },
    )
    assert.equal(fs.readFileSync(calls, 'utf8'), 'add\nadd\n')
    assert.equal(
      fs.readFileSync(path.join(environment.DSH_HOME, 'profiles', 'web', 'node_modules', '@tianbuyv', 'smart-clipboard', 'lib', 'index.js'), 'utf8'),
      'export const revision = 2\n',
    )

    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'))
    profile.dsh.profile.bundles = []
    fs.writeFileSync(profilePath, JSON.stringify(profile))
    assert.deepEqual(
      ensureSmartClipboardProfile({ nodeBinary: process.execPath, dshEntry: fakeNode, profileHome: environment.DSH_HOME, pluginPath, environment }),
      { state: 'disabled', artifactUpdated: false },
    )
    assert.equal(fs.readFileSync(calls, 'utf8'), 'add\nadd\n')

  delete profile.dependencies['@tianbuyv/smart-clipboard']
    fs.writeFileSync(profilePath, JSON.stringify(profile))
    assert.deepEqual(
      ensureSmartClipboardProfile({ nodeBinary: process.execPath, dshEntry: fakeNode, profileHome: environment.DSH_HOME, pluginPath, environment }),
      { state: 'uninstalled', artifactUpdated: false },
    )
    assert.equal(fs.readFileSync(calls, 'utf8'), 'add\nadd\n')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('旧 @hermit profile 会在 DSH 启动前迁移到 @tianbuyv', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-smart-profile-migration-'))
  const pluginPath = path.join(root, 'plugin')
  const fakeNode = path.join(root, 'fake-node.mjs')
  const profileHome = path.join(root, 'home')
  const profileDir = path.join(profileHome, 'profiles', 'web')
  fs.mkdirSync(path.join(pluginPath, 'lib'), { recursive: true })
  fs.mkdirSync(profileDir, { recursive: true })
  fs.mkdirSync(path.join(profileHome, 'hermit-managed'), { recursive: true })
  fs.writeFileSync(path.join(pluginPath, 'package.json'), JSON.stringify({ name: '@tianbuyv/smart-clipboard', version: '0.2.2', hermit: { type: 'product-plugin' } }))
  fs.writeFileSync(path.join(pluginPath, 'cordis.patch.yml'), '[]\n')
  fs.writeFileSync(path.join(pluginPath, 'lib', 'index.js'), 'export const revision = 1\n')
  fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    dependencies: { '@hermit/smart-clipboard': 'link:/old/hermit/smart-clipboard' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@hermit/smart-clipboard'] } },
  }))
  fs.writeFileSync(path.join(profileHome, 'hermit-managed', 'smart-clipboard.json'), JSON.stringify({
    schemaVersion: 1,
    packageName: '@hermit/smart-clipboard',
  }))
  fs.writeFileSync(fakeNode, `
import fs from 'node:fs'
import path from 'node:path'
const home = process.env.DSH_HOME
const dir = path.join(home, 'profiles', 'web')
const plugin = process.argv.at(-1)
const installed = path.join(dir, 'node_modules', '@tianbuyv', 'smart-clipboard')
fs.mkdirSync(path.dirname(installed), { recursive: true })
fs.rmSync(installed, { recursive: true, force: true })
fs.cpSync(plugin, installed, { recursive: true })
const profile = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
profile.dependencies['@tianbuyv/smart-clipboard'] = 'file:' + plugin
profile.dsh.profile.bundles.push('@tianbuyv/smart-clipboard')
fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(profile))
`)
  const environment = { ...process.env, PATH: path.dirname(process.execPath), DSH_HOME: profileHome }
  try {
    assert.deepEqual(
      ensureSmartClipboardProfile({
        nodeBinary: process.execPath,
        dshEntry: fakeNode,
        profileHome,
        pluginPath,
        environment,
      }),
      { state: 'active', artifactUpdated: true },
    )
    const profile = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'))
    assert.equal(profile.dependencies['@hermit/smart-clipboard'], undefined)
    assert.equal(profile.dependencies['@tianbuyv/smart-clipboard'], 'file:' + pluginPath)
    assert.equal(profile.dsh.profile.bundles.includes('@hermit/smart-clipboard'), false)
    assert.equal(profile.dsh.profile.bundles.includes('@tianbuyv/smart-clipboard'), true)
    assert.equal(JSON.parse(fs.readFileSync(path.join(profileHome, 'hermit-managed', 'smart-clipboard.json'), 'utf8')).packageName, '@tianbuyv/smart-clipboard')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('多个旧插件 scope 在首次重新登记前一起迁移', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-profile-scope-migration-'))
  const profileHome = path.join(root, 'home')
  const profileDir = path.join(profileHome, 'profiles', 'web')
  fs.mkdirSync(profileDir, { recursive: true })
  fs.mkdirSync(path.join(profileHome, 'hermit-managed'), { recursive: true })
  fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({
    dependencies: {
      '@hermit/organizer': 'link:/old/organizer',
      '@hermit/smart-clipboard': 'link:/old/smart-clipboard',
      '@hermit/file-workspace': 'link:/old/file-workspace',
    },
    dsh: { profile: { bundles: [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@hermit/organizer',
      '@hermit/smart-clipboard',
      '@hermit/file-workspace',
    ] } },
  }))
  for (const [markerName, packageName] of [
    ['personal-organizer', '@hermit/organizer'],
    ['smart-clipboard', '@hermit/smart-clipboard'],
    ['file-workspace', '@hermit/file-workspace'],
  ]) {
    fs.writeFileSync(path.join(profileHome, 'hermit-managed', `${markerName}.json`), JSON.stringify({ schemaVersion: 1, packageName }))
  }
  try {
    migrateLegacyPluginProfiles(profileHome, [
      { packageName: '@tianbuyv/organizer', markerName: 'personal-organizer', legacyPackageNames: ['@hermit/organizer'] },
      { packageName: '@tianbuyv/smart-clipboard', markerName: 'smart-clipboard', legacyPackageNames: ['@hermit/smart-clipboard'] },
      { packageName: '@tianbuyv/file-workspace', markerName: 'file-workspace', legacyPackageNames: ['@hermit/file-workspace'] },
    ])
    const profile = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'))
    assert.deepEqual(Object.keys(profile.dependencies).sort(), [
      '@tianbuyv/file-workspace',
      '@tianbuyv/organizer',
      '@tianbuyv/smart-clipboard',
    ])
    assert.deepEqual(profile.dsh.profile.bundles, [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@tianbuyv/organizer',
      '@tianbuyv/smart-clipboard',
      '@tianbuyv/file-workspace',
    ])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
