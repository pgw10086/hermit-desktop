import assert from 'node:assert/strict'
import test from 'node:test'
import { buildLongSessionScenario, buildReplayOverride } from '../scripts/dsh-long-session-fixture.mjs'

test('生成确定性的多轮长会话和可回放流式分片', () => {
  const scenario = buildLongSessionScenario({
    targetChars: 2_000,
    turns: 8,
    continuationTurns: 1,
    seed: 20260903,
  })

  assert.equal(scenario.seedTurns.length, 8)
  assert.equal(scenario.continuationTurns.length, 1)
  assert.equal(scenario.seedChars, 2_000)
  assert.equal(scenario.seedTurns.every((turn) => turn.user.length > 0 && turn.assistant.length > 0), true)
  assert.notEqual(scenario.seedTurns[0].user, scenario.seedTurns[1].user)

  const override = buildReplayOverride(scenario.allTurns, { chunkChars: 32 })
  assert.equal(override.length, 9)
  assert.equal(override.every((entry) => entry.kind === 'chunks'), true)
  assert.equal(override.every((entry) => entry.chunks.at(0)?.type === 'block-start'), true)
  assert.equal(override.every((entry) => entry.chunks.at(-1)?.type === 'finish'), true)
  assert.equal(override.every((entry) => entry.chunks.filter((chunk) => chunk.type === 'text-delta').length >= 2), true)
})
