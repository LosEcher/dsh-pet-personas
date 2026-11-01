import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlayer, DEFAULT_TABLES } from '../src/sprite-player.mjs'

const STATES = {
  idle: { row: 0, durations: [1800, 140] },
  busy: { row: 1, durations: [420, 420] },
  alert: { row: 2, durations: [1000, 1000] },
}

test('开场在 idle（栈底哨兵），不因为"没事件"就消失', () => {
  const p = createPlayer({ states: STATES })
  assert.equal(p.snapshot().state, 'idle')
  assert.equal(p.baseDepth(), 1)
})

test('区间可嵌套：task 里再 tool，结束要按栈顶顺序弹', () => {
  const p = createPlayer({ states: STATES })
  p.applyEvent('task.start'); p.applyEvent('tool.start')
  assert.equal(p.snapshot().state, 'busy')
  assert.equal(p.baseDepth(), 3)
  p.applyEvent('tool.end')                       // 弹掉 tool
  assert.equal(p.baseDepth(), 2)
  assert.equal(p.snapshot().state, 'busy')
  p.applyEvent('task.end')                       // 弹掉 task
  assert.equal(p.snapshot().state, 'idle')
  assert.equal(p.baseDepth(), 1)                 // 哨兵不动
})

test('负向控制：结束事件不能把栈底哨兵也弹掉', () => {
  const p = createPlayer({ states: STATES })
  p.applyEvent('session.end'); p.applyEvent('session.end')
  assert.equal(p.baseDepth(), 1)
  assert.equal(p.snapshot().state, 'idle')
})

test('一次性动作优先于区间，放完一轮自动回落', () => {
  const p = createPlayer({ states: STATES })
  p.applyEvent('task.start')
  p.applyEvent('gate.fail')
  assert.equal(p.snapshot().state, 'alert')
  p.tick(1000); p.tick(1000)                     // alert 两帧走完一轮
  assert.equal(p.snapshot().state, 'busy', '放完应回到区间栈顶，而不是 idle')
})

test('逐帧时长生效：idle 第二帧只有 140ms', () => {
  const p = createPlayer({ states: STATES })
  const f0 = p.snapshot()
  assert.equal(f0.durationMs, 1800)
  const a = p.tick(1800)
  assert.equal(a.col, 1)
  assert.equal(a.durationMs, 140)
})

test('reduced-motion 下冻结在第 0 帧（不靠 CSS 兜底）', () => {
  const p = createPlayer({ states: STATES, reducedMotion: true })
  p.applyEvent('task.start')
  const s = p.tick(999999)
  assert.equal(s.col, 0)
})

test('未知事件被忽略并返回 false（不静默改变状态）', () => {
  const p = createPlayer({ states: STATES })
  assert.equal(p.applyEvent('whatever.happened'), false)
  assert.equal(p.snapshot().state, 'idle')
})

test('拖拽优先级最高，松手回到区间栈顶', () => {
  const p = createPlayer({ states: STATES })
  p.applyEvent('task.start')
  p.beginDrag('right')
  assert.equal(p.snapshot().drag, 'busy')
  p.endDrag()
  assert.equal(p.snapshot().state, 'busy')
})

test('表格是数据不是代码：换成别的表就换一套语义', () => {
  const p = createPlayer({
    states: STATES,
    tables: { open: { 'x.start': 'busy' }, close: { 'x.end': ['busy'] }, oneshot: {} },
  })
  p.applyEvent('session.start')                  // 不在新表里 ⇒ 忽略
  assert.equal(p.snapshot().state, 'idle')
  p.applyEvent('x.start')
  assert.equal(p.snapshot().state, 'busy')
  assert.ok(DEFAULT_TABLES.open['session.start'], '默认表仍保留原语义')
})

test('unknown 是单帧：怎么 tick 都停在第 0 列（不会闪成空白）', () => {
  // 实测背景（2026-11-01）：unknown 行第二格 α 全 0，而 durations 曾是 [1800,140]
  // ⇒ 每 1.94 秒画一格空白，宠物"消失"140ms。单帧是**素材事实**决定的，不是口味。
  const states = {
    idle: { row: 0, durations: [1800] },
    unknown: { row: 5, durations: [1500] },
  }
  const p = createPlayer({ states, initial: 'idle' })
  p.applyEvent('status.unknown')
  assert.equal(p.snapshot().state, 'unknown')
  for (let i = 0; i < 40; i += 1) {
    p.tick(500)
    assert.equal(p.snapshot().col, 0, 'unknown 只有一帧，col 不该前进')
  }
})

test('负向控制：给 unknown 两帧就会走到第 1 列（证明上一条不是恒真）', () => {
  const states = {
    idle: { row: 0, durations: [1800] },
    unknown: { row: 5, durations: [1800, 140] },   // 旧配置：第二格是空白
  }
  const p = createPlayer({ states, initial: 'idle' })
  p.applyEvent('status.unknown')
  p.tick(1900)
  assert.equal(p.snapshot().col, 1, '两帧时确实会翻到空白帧 —— 这正是被修掉的行为')
})
