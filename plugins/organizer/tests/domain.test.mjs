import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../lib/index.js'
import { OrganizerService } from '../lib/domain/service.js'
import { resolveTemporalExpression } from '../lib/domain/time.js'

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

test('相对日期按原始用户消息时间解析，而不是按 Tool 执行时间解析', () => {
  const point = resolveTemporalExpression({ relativeDays: 1, time: '08:00' }, { referenceAt: Date.parse('2026-09-01T12:00:00.000Z'), timeZone: 'Asia/Shanghai' }, '待办开始')
  assert.deepEqual(point, { date: '2026-09-02', time: '08:00' })
  assert.throws(() => resolveTemporalExpression({ relativeDays: 1, time: '' }, undefined, '提醒'), /原始消息时间/u)
  assert.throws(() => resolveTemporalExpression({ date: '2026-09-02', time: '' }, undefined, '提醒', true), /需要具体时间/u)
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
  const registrations = { skills: [], tools: [], preExecute: [] }
  const effects = []
  const ctx = {
    effect(callback) { effects.push(Promise.resolve(callback())) },
    storage: { domain: { open: async () => domain } },
    skills: { register(skill) { registrations.skills.push(skill); return () => {} } },
    connection: { rpc: { handle() { return async () => {} } } },
    tools: { register(definition) { registrations.tools.push(definition); return () => {} } },
    on(event, listener) { if (event === 'tools/pre-execute') registrations.preExecute.push(listener); return () => {} },
  }
  const service = await OrganizerService.open({ storage: { domain: { open: async () => domain } } })
  apply(ctx)
  await effects[0]
  assert.equal(registrations.skills.length, 1)
  assert.equal(registrations.skills[0].name, 'personal-organizer')
  assert.equal(registrations.tools.length, 3)
  const turns = { concluded: false }
  const todoTool = registrations.tools.find((tool) => tool.name === 'organizer_create_todo')
  const noteTool = registrations.tools.find((tool) => tool.name === 'organizer_create_note')
  const listTodayTool = registrations.tools.find((tool) => tool.name === 'organizer_list_today')
  assert.notEqual(todoTool, undefined)
  assert.notEqual(noteTool, undefined)
  assert.notEqual(listTodayTool, undefined)
  const result = await todoTool.execute({ title: '从 Host 测试创建' }, { callId: 'host-call-1', signal: new AbortController().signal, concludeTurn: () => { turns.concluded = true } })
  assert.equal(result.kind, 'todo')
  assert.equal(domain.stores.items.size, 1)
  assert.equal(turns.concluded, true)
  const noteResult = await noteTool.execute({ title: '从 Host 测试记录' }, { callId: 'host-call-2', signal: new AbortController().signal, concludeTurn: () => {} })
  assert.equal(noteResult.kind, 'note')
  assert.equal(domain.stores.items.size, 2)
  const scheduled = await todoTool.execute({
    title: '吃饭', originalInput: '明天上午 8 点提醒我吃饭',
    todoStart: { relativeDays: 1, time: '08:00' },
    reminders: [{ relativeDays: 1, time: '08:00', sourceText: '明天上午 8 点' }],
  }, {
    callId: 'host-call-scheduled', signal: new AbortController().signal, concludeTurn: () => { turns.concluded = true },
    agent: { session: { events: [{ type: 'user/message', time: Date.parse('2026-09-01T06:00:00.000Z'), data: { source: { kind: 'user' } } }] } },
  })
  assert.equal(scheduled.kind, 'todo')
  assert.equal(scheduled.todoStart, '2026-09-02 08:00')
  assert.equal(scheduled.reminder, '2026-09-02 08:00')
  const scheduledItem = [...domain.stores.items.values()].find((item) => item.title === '吃饭')
  assert.equal(scheduledItem.todoStart.date, '2026-09-02')
  assert.equal(scheduledItem.reminders.length, 1)
  assert.equal(scheduledItem.reminders[0].date, '2026-09-02')
  assert.equal(scheduledItem.reminders[0].time, '08:00')
  const current = new Date()
  const todayDate = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`
  const todayResult = await service.execute({
    type: 'save',
    draft: {
      kind: 'todo', title: '今日 Host 测试', detail: '不应进入 AI 摘要', tags: [], pinned: false,
      priority: 'none', checklist: [], todoStart: { date: todayDate, time: '' }, todoDue: { date: '', time: '' },
      eventTime: { mode: 'all-day', startDate: '', startTime: '', endDate: '', endTime: '', hasEnd: false }, location: '', reminders: [],
    },
  })
  assert.equal(todayResult.outcome, 'success')
  const today = await listTodayTool.execute({}, { callId: 'host-call-3', signal: new AbortController().signal })
  assert.equal(today.todos.length, 2)
  assert.equal(today.todos.some((item) => item.title === '今日 Host 测试'), true)
  assert.equal(today.todos.find((item) => item.title === '今日 Host 测试').detail, undefined)
  assert.equal(listTodayTool.output.render({}, { overdue: [], todos: [], events: [] })[0].text, '今天没有过期待办、今日待办或今日事件。')
  const approval = await registrations.preExecute[0]({ name: 'organizer_create_todo' }, async () => ({ kind: 'allow' }))
  assert.deepEqual(approval, { kind: 'ask', reason: '这次操作会在个人事项中写入本地数据，需要你的确认。' })
  const readDecision = await registrations.preExecute[0]({ name: 'organizer_list_today' }, async () => ({ kind: 'allow' }))
  assert.deepEqual(readDecision, { kind: 'allow' })
  assert.match(registrations.skills[0].content, /organizer_create_note/u)
  assert.match(registrations.skills[0].content, /organizer_list_today/u)
  assert.match(registrations.skills[0].content, /不要创建第二个聊天入口/u)
  await effects[0].then((dispose) => dispose())
  await service.close()
})
