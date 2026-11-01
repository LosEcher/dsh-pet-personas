import test from 'node:test'
import assert from 'node:assert/strict'
import { eventsFor, idleEvent } from '../src/status-to-events.mjs'
import { lineFor, VOICE } from '../src/pet-voice.mjs'

test('忙→闲：既收区间也放一次 happy', () => {
  assert.deepEqual(eventsFor({ activity: 'busy' }, { activity: 'idle', health: 'ok' }), ['task.end', 'task.done'])
})

test('负向控制：出事的恢复才 happy；attention 期间变闲不放 happy', () => {
  assert.deepEqual(eventsFor({ activity: 'busy', health: 'attention' }, { activity: 'idle', health: 'attention' }), ['task.end'])
  assert.deepEqual(eventsFor({ health: 'attention' }, { health: 'ok' }), ['task.done'])
})

test('负向控制：同一状态重复轮询不产生事件（否则宠物一直抽搐）', () => {
  assert.deepEqual(eventsFor({ activity: 'busy', health: 'ok' }, { activity: 'busy', health: 'ok' }), [])
  assert.deepEqual(eventsFor({ activity: 'idle', health: 'ok' }, { activity: 'idle', health: 'ok' }), [])
})

test('久坐 90s 才困；有动静立刻叫醒；睡着时继续不动不重复触发', () => {
  const now = 100000
  assert.equal(idleEvent({ lastChangeAt: now - 50000, now, idleMs: 90000, asleep: false }), null)
  assert.equal(idleEvent({ lastChangeAt: now - 95000, now, idleMs: 90000, asleep: false }), 'idle.sleep')
  assert.equal(idleEvent({ lastChangeAt: now, now, idleMs: 90000, asleep: true }), 'idle.wake')
  assert.equal(idleEvent({ lastChangeAt: now - 99000, now, idleMs: 90000, asleep: true }), null)
})

test('文案：每个状态都有词，unknown 不吹牛，轮换可用', () => {
  for (const state of ['idle', 'busy', 'alert', 'sleep', 'happy', 'unknown']) {
    assert.ok(VOICE[state]?.length, `${state} 缺文案`)
    assert.equal(typeof lineFor(state, 0), 'string')
  }
  assert.notEqual(lineFor('idle', 0), lineFor('idle', 1))
  assert.match(lineFor('unknown', 0), /看不清|读不到|判不了/)
  assert.ok(!/正常|没事/.test(lineFor('unknown', 0)))
})

import { isStale, inNightWindow, STALE_MS } from '../src/status-to-events.mjs'

test('新鲜度：6h 内算新；缺 asOf / 解析不了 ⇒ stale（判不了不是好消息）', () => {
  const now = Date.parse('2026-11-01T12:00:00Z')
  assert.equal(isStale('2026-11-01T08:00:00Z', now), false)
  assert.equal(isStale('2026-11-01T05:59:00Z', now), true)
  assert.equal(isStale(null, now), true)
  assert.equal(isStale('不是时间', now), true)
  assert.equal(isStale('2026-11-01T08:00:00Z', now, 1), true) // 阈值可调
})

test('新鲜度：未来时间（时钟回拨）不算 stale，避免把一切判死', () => {
  const now = Date.parse('2026-11-01T12:00:00Z')
  assert.equal(isStale('2026-11-01T13:00:00Z', now), false)
})

test('夜间窗口：23–7 跨零点，白天不算', () => {
  const at = (h) => new Date(2026, 10, 1, h, 30).getTime()
  assert.equal(inNightWindow(at(23)), true)
  assert.equal(inNightWindow(at(2)), true)
  assert.equal(inNightWindow(at(6)), true)
  assert.equal(inNightWindow(at(7)), false)
  assert.equal(inNightWindow(at(14)), false)
  assert.equal(STALE_MS, 6 * 3600_000)
})
