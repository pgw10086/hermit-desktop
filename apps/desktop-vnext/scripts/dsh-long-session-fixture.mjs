const MIN_USER_CHARS = 24
const MIN_ASSISTANT_CHARS = 36
const DEFAULT_SEED = 20260903

const USER_PARTS = [
  '请根据当前工作区的上下文整理一个可执行的检查结论',
  '我希望保留关键事实并指出下一步需要验证的边界',
  '请把这条信息和前面的讨论联系起来给出简洁建议',
  '这是一条用于长会话稳定性测试的新增输入',
  '请继续处理这个连续会话中的新问题并保持上下文一致',
]

const ASSISTANT_PARTS = [
  '已读取当前会话中可见的上下文，下面给出确定性的测试回答',
  '这个回答包含重复上下文、少量新事实和结构化标记，用于模拟真实消息分布',
  '结论需要同时记录事件序号、消息内容、流式分片和持久化状态',
  '后续恢复时应继续使用同一个会话身份，并把新增事件追加到原有日志之后',
  '本段文字不代表真实模型判断，只用于验证 DSH 的会话与流式处理链路',
]

/**
 * 生成可重复但不完全规则的伪随机序列，避免 fixture 每轮文本都相同。
 * 固定 seed 是为了让性能回归可以复现，而不是为了模拟模型随机性。
 */
function createRng(seed) {
  let state = (Number(seed) >>> 0) || DEFAULT_SEED
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 4_294_967_296
  }
}

function requirePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

function allocateLengths(targetChars, turns, rng) {
  requirePositiveInteger(targetChars, 'targetChars')
  requirePositiveInteger(turns, 'turns')
  const minimum = turns * (MIN_USER_CHARS + MIN_ASSISTANT_CHARS)
  if (targetChars < minimum) {
    throw new Error(`targetChars must be at least ${minimum} for ${turns} turns`)
  }

  const entries = []
  for (let index = 0; index < turns; index += 1) {
    entries.push({ role: 'user', weight: 0.35 * (0.7 + rng() * 0.8) })
    entries.push({ role: 'assistant', weight: 0.65 * (0.7 + rng() * 0.8) })
  }
  const variableBudget = targetChars - minimum
  const weightTotal = entries.reduce((total, entry) => total + entry.weight, 0)
  let allocated = 0
  for (const entry of entries) {
    entry.chars = Math.floor(variableBudget * entry.weight / weightTotal)
    allocated += entry.chars
  }

  // 舍入余数只补到最后一条 assistant，保持总字符数精确且每轮仍有输入输出。
  entries.at(-1).chars += variableBudget - allocated
  return Array.from({ length: turns }, (_, index) => ({
    user: MIN_USER_CHARS + entries[index * 2].chars,
    assistant: MIN_ASSISTANT_CHARS + entries[index * 2 + 1].chars,
  }))
}

function buildMessage(length, role, index, rng) {
  const parts = role === 'user' ? USER_PARTS : ASSISTANT_PARTS
  const marker = role === 'user'
    ? `长会话用户输入 ${String(index + 1).padStart(3, '0')}：`
    : `长会话助手输出 ${String(index + 1).padStart(3, '0')}：`
  const endMarker = role === 'assistant' ? ` [assistant-end-${String(index + 1).padStart(3, '0')}]` : ''
  if (length <= endMarker.length) throw new Error(`${role} message length is too short for its marker`)
  let text = marker
  let partIndex = Math.floor(rng() * parts.length)
  while (text.length < length - endMarker.length) {
    text += `${parts[partIndex % parts.length]}；`
    partIndex += 1 + Math.floor(rng() * 3)
  }
  return `${text.slice(0, length - endMarker.length)}${endMarker}`
}

function buildTurns(lengths, startIndex, rng) {
  return lengths.map((length, offset) => {
    const index = startIndex + offset
    return {
      index,
      user: buildMessage(length.user, 'user', index, rng),
      assistant: buildMessage(length.assistant, 'assistant', index, rng),
    }
  })
}

/** 生成 seed 多轮会话和续接轮次；seed 字符数严格等于 targetChars。 */
export function buildLongSessionScenario(options = {}) {
  const targetChars = options.targetChars ?? 100_000
  const turns = options.turns ?? 128
  const continuationCount = options.continuationTurns ?? 1
  const seed = options.seed ?? DEFAULT_SEED
  requirePositiveInteger(continuationCount, 'continuationTurns')
  const rng = createRng(seed)
  const seedLengths = allocateLengths(targetChars, turns, rng)
  const seedTurns = buildTurns(seedLengths, 0, rng)
  const continuationLengths = Array.from({ length: continuationCount }, () => ({
    user: 96 + Math.floor(rng() * 160),
    assistant: 512 + Math.floor(rng() * 384),
  }))
  const continuation = buildTurns(continuationLengths, turns, rng)

  return {
    seedTurns,
    continuationTurns: continuation,
    allTurns: [...seedTurns, ...continuation],
    seedChars: seedTurns.reduce((total, turn) => total + turn.user.length + turn.assistant.length, 0),
    allChars: [...seedTurns, ...continuation].reduce((total, turn) => total + turn.user.length + turn.assistant.length, 0),
    seed,
    targetChars,
  }
}

function splitText(text, chunkChars) {
  const chunks = []
  for (let offset = 0; offset < text.length; offset += chunkChars) {
    chunks.push(text.slice(offset, offset + chunkChars))
  }
  return chunks
}

/** 将每轮 assistant 文本转换为 dsh-llm-replay 可消费的 StreamChunk 脚本。 */
export function buildReplayOverride(turns, options = {}) {
  const chunkChars = options.chunkChars ?? 32
  requirePositiveInteger(chunkChars, 'chunkChars')
  return turns.map((turn) => {
    const deltas = splitText(turn.assistant, chunkChars)
    return {
      kind: 'chunks',
      chunks: [
        { type: 'block-start', index: 0, blockType: 'text' },
        ...deltas.map((text) => ({ type: 'text-delta', index: 0, text })),
        { type: 'block-end', index: 0, block: { type: 'text', text: turn.assistant } },
        { type: 'finish', reason: { kind: 'stop' } },
      ],
    }
  })
}
