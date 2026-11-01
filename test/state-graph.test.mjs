/**
 * state-graph.test.mjs — 状态图自检（把"表格写错不会报错，只会画错"变成会红的断言）。
 *
 * 直接动机（2026-11-01 实测）：两个 atlas 都备好了 `unknown` 行（row 5），
 * `pet-signals.mergeSignals` 也确实会返回 'unknown'，但播放器的表里**没有任何事件能进入它**
 * —— 于是"判不了"时宠物画的是 idle（呼吸、睁眼在岗）。素材是死的，语义只写在注释里。
 *
 * 参照实现给了守卫形态：vscode-pets 的 `chooseNextState` 查不到就抛 `InvalidStateError`，
 * 而不是悄悄回落到 idle。这里用**纯数据**做同一件事，并且覆盖"换 persona / 换图集"的场景。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPlayer, DEFAULT_TABLES, validateTables } from '../src/sprite-player.mjs'
import { eventsFor, idleEvent } from '../src/status-to-events.mjs'

const ART = join(dirname(fileURLToPath(import.meta.url)), '..', 'pixel', 'art')

/** 读出所有 persona 的 atlas 元数据（真源就是这些 json，不是生成物）。 */
function atlases() {
  return readdirSync(ART)
    .filter((f) => f.endsWith('.atlas.json'))
    .map((f) => ({ file: f, states: JSON.parse(readFileSync(join(ART, f), 'utf8')).states }))
}

test('每条表格引用的 state 都必须在**每一个** persona 图集里（换形象不会掉行）', () => {
  const all = atlases()
  assert.ok(all.length >= 2, `至少两个 persona 图集，实际 ${all.length}`)
  for (const { file, states } of all) {
    assert.deepEqual(validateTables(DEFAULT_TABLES, states), [], `${file} 状态图不合格`)
  }
})

test('有图集时必须查得到：缺 state 不传钩子就抛错（不是静默画第 0 行）', () => {
  const p = createPlayer({ states: { idle: { row: 0, durations: [100] } } })
  p.applyEvent('task.start')                          // 进入 busy，而图集里没有 busy 行
  assert.throws(() => p.tick(1), /不在图集里/)
})

test('传了钩子就回退并留痕：missingStates 非空（DOM 上能看到，不只活在控制台）', () => {
  const seen = []
  const p = createPlayer({
    states: { idle: { row: 0, durations: [100] } }, // 故意缺 busy
    onMissingState: (s) => { seen.push(s); return { row: 0, durations: [1000] } },
  })
  p.applyEvent('task.start')
  const snap = p.tick(1)
  assert.deepEqual([...new Set(seen)], ['busy'], 'spec 每次取帧都会调，但缺的是同一个 state')
  assert.deepEqual(snap.missingStates, ['busy'])
  assert.equal(snap.row, 0, '回退画第 0 行，但这次是"被记录的降级"')
})

test('负向控制：sticky 里少了清空入口必须报错（否则进得去出不来）', () => {
  const broken = {
    open: { ...DEFAULT_TABLES.open },
    close: { ...DEFAULT_TABLES.close },
    oneshot: { ...DEFAULT_TABLES.oneshot },
    sticky: { 'status.unknown': 'unknown' }, // 故意没有 status.known: null
  }
  const problems = validateTables(broken, { unknown: { row: 5, durations: [1800] } })
  assert.ok(problems.some((p) => p.includes('没有清空入口')), problems.join('; '))
})

test('负向控制：closer 里拼错 opener 名字要被抓出来', () => {
  const broken = {
    open: { ...DEFAULT_TABLES.open },
    close: { ...DEFAULT_TABLES.close, 'task.end': ['task.unknwon'] },
    oneshot: {},
  }
  const problems = validateTables(broken, {})
  assert.ok(problems.some((p) => p.includes('task.unknwon')), problems.join('; '))
})

test('可达性：图集里的每个 state 都必须有事件能把它画出来', () => {
  // 用真实的合成输出驱动（不是手写事件名），否则"表里有、但调用方从不发"仍然会漏
  const statuses = [
    { health: 'ok', activity: 'idle' },
    { health: 'unknown', activity: 'unknown' },
    { health: 'attention', activity: 'idle' },
    { health: 'ok', activity: 'busy' },
  ]
  const emitted = new Set()
  let prev = null
  for (const next of statuses) {
    for (const ev of eventsFor(prev, next)) emitted.add(ev)
    prev = next
  }
  // sleep 不来自状态跳变，而来自久坐计时（idleEvent）—— 一并纳入，否则会误报"不可达"
  for (const ev of [
    idleEvent({ lastChangeAt: 0, now: 10_000, idleMs: 9_000, asleep: false }),
    idleEvent({ lastChangeAt: 10_000, now: 10_500, idleMs: 9_000, asleep: true }),
  ]) if (ev) emitted.add(ev)
  const states = atlases()[0].states
  const reachable = new Set(['idle']) // 栈底哨兵
  for (const [ev, state] of Object.entries(DEFAULT_TABLES.open)) {
    if (emitted.has(ev)) reachable.add(state)
  }
  for (const [ev, state] of Object.entries(DEFAULT_TABLES.oneshot)) {
    if (emitted.has(ev)) reachable.add(state)
  }
  for (const [ev, state] of Object.entries(DEFAULT_TABLES.sticky ?? {})) {
    if (state && emitted.has(ev)) reachable.add(state)
  }
  const unreachable = Object.keys(states).filter((s) => !reachable.has(s))
  assert.deepEqual(unreachable, [], `这些 state 图集里有、但没有任何事件能画出来：${unreachable.join(', ')}`)
})

test('行为断言：health=unknown 时停在 unknown 行，而不是 idle（表情即谎报的回归）', () => {
  const states = atlases()[0].states
  const p = createPlayer({ states })
  // 开场就是"判不了"：从没有任何事件也能进入 unknown
  for (const ev of eventsFor(null, { health: 'unknown', activity: 'unknown' })) p.applyEvent(ev)
  const snap = p.tick(1)
  assert.equal(snap.state, 'unknown')
  assert.equal(snap.row, states.unknown.row)

  // 判得清之后必须退出来，回到 idle
  for (const ev of eventsFor({ health: 'unknown', activity: 'unknown' }, { health: 'ok', activity: 'idle' })) {
    p.applyEvent(ev)
  }
  assert.equal(p.snapshot().state, 'idle')
  assert.equal(p.snapshot().sticky, null, 'unknown 覆盖已清掉')
  assert.equal(p.baseDepth(), 1, '没留下任何区间')
})

test('回归：unknown 期间开了 busy，判清之后必须显示 busy（覆盖层不会被压在区间下面）', () => {
  const states = atlases()[0].states
  const p = createPlayer({ states })
  // 判不了 + 在忙（activity 仍可判，只是 health 判不了）
  for (const ev of eventsFor(null, { health: 'unknown', activity: 'busy' })) p.applyEvent(ev)
  assert.equal(p.snapshot().state, 'unknown', '判不了优先于在忙')
  assert.equal(p.baseDepth(), 2, 'busy 区间照常开着（收在栈里）')

  // health 恢复，activity 仍然 busy ⇒ 必须显示 busy，而不是卡在 unknown / 掉回 idle
  for (const ev of eventsFor({ health: 'unknown', activity: 'busy' }, { health: 'ok', activity: 'busy' })) {
    p.applyEvent(ev)
  }
  assert.equal(p.snapshot().state, 'busy')
  assert.equal(p.snapshot().sticky, null)

  // 忙完：收区间（同时放一次 happy 一次性动作），栈回到哨兵
  for (const ev of eventsFor({ health: 'ok', activity: 'busy' }, { health: 'ok', activity: 'idle' })) {
    p.applyEvent(ev)
  }
  assert.equal(p.baseDepth(), 1, 'busy 区间已收起')
  assert.equal(p.snapshot().state, 'happy', '收尾的 happy 是一次性动作，优先于区间栈顶')
  p.tick(10_000) // 让 happy 播完一轮
  assert.equal(p.snapshot().state, 'idle')
})

test('行为断言：判不了的时候不许庆祝（忙→闲 + unknown 不发 happy）', () => {
  const events = eventsFor(
    { health: 'ok', activity: 'busy' },
    { health: 'unknown', activity: 'idle' },
  )
  assert.ok(events.includes('task.end'), events.join(','))
  assert.ok(!events.includes('task.done'), '判不了就不该放 happy')
})
