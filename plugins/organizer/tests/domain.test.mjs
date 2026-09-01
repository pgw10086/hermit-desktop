import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../lib/index.js'
import { OrganizerService } from '../lib/domain/service.js'

function createDomain() {
  const stores = { items: new Map(), tool_calls: new Map() }
  return {
    stores,
    table(name) {
      const store = stores[name]
      return {
        get: (key) => store.get(key),
        entries: () => store.entries(),
        keys: () => store.keys(),
        get size() { return store.size },
        put: async (key, value) => { store.set(key, value) },
        delete: async (key) => store.delete(key),
        update: async (key, transform) => {
          const current = store.get(key)
          if (current === undefined) throw new Error('missing-key')
          const next = transform(current)
          store.set(key, next)
          return next
        },
      }
    },
    close: async () => {},
  }
}

test('同一 callId 重放只返回原 Todo，不创建第二条记录', async () => {
  const domain = createDomain()
  const service = await OrganizerService.open({ storage: { domain: { open: async () => domain } } })
  const first = await service.createTodo({ title: '提交报销', detail: '准备发票', originalInput: '帮我记录一个待办：提交报销，准备发票' }, 'call-1')
  const replay = await service.createTodo({ title: '不应重复创建' }, 'call-1')
  assert.equal(replay.id, first.id)
  assert.equal(domain.stores.items.size, 1)
  assert.equal(domain.stores.tool_calls.size, 1)
  await service.close()
})

test('没有明确类型时创建 active Note，并可在同一 item ID 上转换为 Todo', async () => {
  const domain = createDomain()
  const service = await OrganizerService.open({ storage: { domain: { open: async () => domain } } })
  const note = await service.createNote({ title: '门禁卡 9 月到期', originalInput: '帮我记录：门禁卡 9 月到期' }, 'note-call-1')
  assert.equal(note.kind, 'note')
  assert.equal(note.status, 'active')
  assert.equal(note.originalInput, '帮我记录：门禁卡 9 月到期')
  assert.equal((await service.snapshot()).defaultView.notes.items[0].id, note.id)

  const pinned = await service.execute({ type: 'save', draft: {
    id: note.id, kind: 'note', title: note.title, detail: note.detail, tags: ['生活'], pinned: true,
    priority: 'none', checklist: [], todoStart: { date: '', time: '' }, todoDue: { date: '', time: '' },
    eventTime: { mode: 'timed', startDate: '', startTime: '', endDate: '', endTime: '', hasEnd: false }, location: '', reminders: [], revision: note.revision,
  } })
  assert.equal(pinned.outcome, 'success')

  const converted = await service.execute({ type: 'save', draft: {
    id: note.id, kind: 'todo', title: note.title, detail: note.detail, tags: pinned.item.tags, pinned: true,
    priority: 'none', checklist: [], todoStart: { date: '', time: '' }, todoDue: { date: '', time: '' },
    eventTime: { mode: 'timed', startDate: '', startTime: '', endDate: '', endTime: '', hasEnd: false }, location: '', reminders: [], revision: pinned.item.revision,
  } })
  assert.equal(converted.outcome, 'success')
  assert.equal(converted.item.id, note.id)
  assert.equal(converted.item.kind, 'todo')
  assert.equal(converted.item.status, 'planned')
  assert.equal(converted.item.pinned, undefined)
  assert.equal(converted.item.priority, 'none')
  assert.deepEqual(converted.item.checklist, [])
  assert.equal(converted.item.todoStart, undefined)
  assert.match(converted.item.typeHistory.at(-1), /原便签置顶不保留/u)
  await service.close()
})

test('Todo 完成递增 revision，旧 revision 返回冲突', async () => {
  const domain = createDomain()
  const service = await OrganizerService.open({ storage: { domain: { open: async () => domain } } })
  const created = await service.createTodo({ title: '完成方案' }, 'call-2')
  const completed = await service.execute({ type: 'complete', itemId: created.id, revision: created.revision })
  assert.equal(completed.outcome, 'success')
  assert.equal(completed.item.revision, 2)
  assert.equal(completed.item.status, 'completed')
  const stale = await service.execute({ type: 'complete', itemId: created.id, revision: created.revision })
  assert.equal(stale.outcome, 'conflict')
  assert.equal(stale.latest.revision, 2)
  const snapshot = await service.snapshot()
  assert.equal(snapshot.defaultView.todos.items.length, 0)
  assert.equal(snapshot.items.items[0].status, 'completed')
  await service.close()
})

test('非法终态操作不会改变 Canonical 状态', async () => {
  const domain = createDomain()
  const service = await OrganizerService.open({ storage: { domain: { open: async () => domain } } })
  const created = await service.createTodo({ title: '已完成事项' }, 'call-3')
  const completed = await service.execute({ type: 'complete', itemId: created.id, revision: 1 })
  const cancelled = await service.execute({ type: 'lifecycle', itemId: created.id, revision: completed.item.revision, action: 'cancel' })
  assert.equal(cancelled.outcome, 'invalid')
  assert.equal(domain.stores.items.get(created.id).status, 'completed')
  await service.close()
})

test('Host apply 注册唯一 Skill 和 Todo Tool，并写入同一 Canonical domain', async () => {
  const domain = createDomain()
  const registrations = { skills: [], tools: [] }
  const effects = []
  const ctx = {
    effect(callback) { effects.push(Promise.resolve(callback())) },
    storage: { domain: { open: async () => domain } },
    skills: { register(skill) { registrations.skills.push(skill); return () => {} } },
    connection: { rpc: { handle() { return async () => {} } } },
    tools: { register(definition) { registrations.tools.push(definition); return () => {} } },
  }
  apply(ctx)
  await effects[0]
  assert.equal(registrations.skills.length, 1)
  assert.equal(registrations.skills[0].name, 'personal-organizer')
  assert.equal(registrations.tools.length, 2)
  const turns = { concluded: false }
  const todoTool = registrations.tools.find((tool) => tool.name === 'organizer_create_todo')
  const noteTool = registrations.tools.find((tool) => tool.name === 'organizer_create_note')
  assert.notEqual(todoTool, undefined)
  assert.notEqual(noteTool, undefined)
  const result = await todoTool.execute({ title: '从 Host 测试创建' }, { callId: 'host-call-1', signal: new AbortController().signal, concludeTurn: () => { turns.concluded = true } })
  assert.equal(result.kind, 'todo')
  assert.equal(domain.stores.items.size, 1)
  assert.equal(turns.concluded, true)
  const noteResult = await noteTool.execute({ title: '从 Host 测试记录' }, { callId: 'host-call-2', signal: new AbortController().signal, concludeTurn: () => {} })
  assert.equal(noteResult.kind, 'note')
  assert.equal(domain.stores.items.size, 2)
  assert.match(registrations.skills[0].content, /organizer_create_note/u)
  assert.match(registrations.skills[0].content, /不要创建第二个聊天入口/u)
  await effects[0].then((dispose) => dispose())
})
