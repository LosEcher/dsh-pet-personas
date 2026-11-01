/**
 * pet-gates.test.mjs — 闸门的判据（纯函数）。
 *
 * 两条对照实现：vorssaint 的 SustainedAlertGate（不同采样上持续够久才配弹）与
 * NotchMascotReactionGate（相邻反应有间隔、同一反应有冷却）。这里只借结构，数字按我们的
 * 台账（分钟级）/轮询（60s）重推。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { admitsAlert, createReactionGate, gateEvents, ONESHOT_EVENTS } from '../src/pet-gates.mjs'

const HOLD = 120_000

test('attention 站够 2 分钟才配弹；刚出事的单次采样不弹', () => {
  assert.equal(admitsAlert({ health: 'attention', failingRuns: 1, sustainedMs: 0 }), false)
  assert.equal(admitsAlert({ health: 'attention', failingRuns: 1, sustainedMs: 60_000 }), false)
  assert.equal(admitsAlert({ health: 'attention', failingRuns: 2, sustainedMs: HOLD }), true)
  assert.equal(admitsAlert({ health: 'attention', failingRuns: 5, sustainedMs: 3 * HOLD }), true)
})

test('负向控制：ok / unknown / 空 一律不弹（不是"看起来像出事"）', () => {
  assert.equal(admitsAlert({ health: 'ok', failingRuns: 3, sustainedMs: 9e9 }), false)
  assert.equal(admitsAlert({ health: 'unknown', failingRuns: 3, sustainedMs: 9e9 }), false)
  assert.equal(admitsAlert(null), false)
  assert.equal(admitsAlert({ health: 'attention' }, { holdMs: 0 }), false, '缺 sustainedMs 时不能因为 holdMs=0 就放行')
})

test('拿不到时长时退化成"至少连续两条"（宁严不松）', () => {
  assert.equal(admitsAlert({ health: 'attention', failingRuns: 1 }), false)
  assert.equal(admitsAlert({ health: 'attention', failingRuns: 2 }), true)
})

test('反应闸门：相邻要有间隔，同一反应有冷却，不同反应过了间隔就放行', () => {
  const g = createReactionGate({ spacingMs: 3_000, repeatMs: 60_000 })
  assert.equal(g.admits('task.done', 0), true)
  assert.equal(g.admits('task.done', 1_000), false, '间隔不足')
  assert.equal(g.admits('gate.fail', 1_000), false, '间隔不足（换名字也不行）')
  assert.equal(g.admits('gate.fail', 4_000), true, '过了间隔、名字不同 ⇒ 放行')
  assert.equal(g.admits('task.done', 30_000), false, '同名字在冷却期内')
  assert.equal(g.admits('task.done', 61_000), true, '冷却期过了')
})

test('闸门可重置（换会话/重连后不被上一轮记忆卡住）', () => {
  const g = createReactionGate({ spacingMs: 1_000, repeatMs: 60_000 })
  assert.equal(g.admits('task.done', 0), true)
  assert.equal(g.admits('task.done', 500), false)
  g.reset()
  assert.equal(g.admits('task.done', 600), true)
})

test('gateEvents：区间事件一条都不能丢（丢了状态栈弹不回去）', () => {
  const reaction = createReactionGate({ spacingMs: 3_000, repeatMs: 60_000 })
  const status = { health: 'attention', failingRuns: 1, sustainedMs: 0 } // 还不够持续
  const events = ['task.start', 'gate.fail', 'task.end', 'task.done']
  const kept = gateEvents(events, { reaction, status, nowMs: 1_000 })
  assert.deepEqual(kept, ['task.start', 'task.end', 'task.done'], 'gate.fail 被拦，区间事件全留')
  for (const ev of kept) {
    if (!ONESHOT_EVENTS.has(ev)) assert.ok(true)
  }
})

test('gateEvents：持续性满足后才放 gate.fail 通过', () => {
  const reaction = createReactionGate({ spacingMs: 0, repeatMs: 0 })
  const okStatus = { health: 'attention', failingRuns: 3, sustainedMs: 5 * 60_000 }
  assert.deepEqual(gateEvents(['gate.fail'], { reaction, status: okStatus, nowMs: 1 }), ['gate.fail'])
})
