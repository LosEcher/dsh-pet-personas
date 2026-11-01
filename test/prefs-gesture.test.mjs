import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PREFS, loadPrefs, savePrefs, normalize, resolvePosition, PREFS_KEY } from '../src/pet-prefs.mjs'
import { classifyGesture, LONG_PRESS_MS, DRAG_THRESHOLD_PX, offsetFromDrag } from '../src/pet-gesture.mjs'

const fakeStorage = (initial = {}) => {
  const data = { ...initial }
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
    raw: data,
  }
}

test('默认偏好：合法且只在白名单里', () => {
  assert.equal(DEFAULT_PREFS.persona, 'mermaid-maid')
  assert.equal(DEFAULT_PREFS.corner, 'br')
  assert.ok(DEFAULT_PREFS.size >= 40)
})

test('负向控制：损坏的 JSON / 脏值 / 越界值都回落默认，不抛', () => {
  const s = fakeStorage({ [PREFS_KEY]: '{oops' })
  assert.deepEqual(loadPrefs(s), { ...DEFAULT_PREFS })

  const dirty = normalize({ persona: '../etc/passwd', size: 9999, idleMs: -5, corner: 'nope', voice: 'yes' })
  assert.equal(dirty.persona, DEFAULT_PREFS.persona)
  assert.equal(dirty.size, DEFAULT_PREFS.size) // 越界 ⇒ 回默认（不是"夹到 96"再取档）
  assert.equal(normalize({ size: 50 }).size, 48) // 合法但不在档位上 ⇒ 取最近一档
  assert.equal(dirty.idleMs, DEFAULT_PREFS.idleMs)
  assert.equal(dirty.corner, DEFAULT_PREFS.corner)
  assert.equal(dirty.voice, DEFAULT_PREFS.voice)
})

test('写回读一致；storage 不可写时返回 false 而不是抛', () => {
  const s = fakeStorage()
  assert.equal(savePrefs(s, { persona: 'whale-maid', size: 56, idleMs: 60000, voice: false, corner: 'tl', offset: { x: 10, y: -20 } }), true)
  const back = loadPrefs(s)
  assert.equal(back.persona, 'whale-maid')
  assert.equal(back.size, 56)
  assert.equal(back.corner, 'tl')
  assert.deepEqual(back.offset, { x: 10, y: -20 })
  assert.equal(savePrefs(null, DEFAULT_PREFS), false)
  assert.equal(savePrefs({ setItem() { throw new Error('quota') } }, DEFAULT_PREFS), false)
})

test('未知 persona 不会被采用（避免空形象）', () => {
  assert.equal(normalize({ persona: 'nonexistent' }).persona, DEFAULT_PREFS.persona)
})

test('位置：四角基准 + offset；越界被夹回视口内', () => {
  const viewport = { w: 1000, h: 800 }
  assert.deepEqual(resolvePosition({ corner: 'br', offset: null, viewport, size: 48 }), { x: 936, y: 736 })
  assert.deepEqual(resolvePosition({ corner: 'tl', offset: { x: 5, y: 5 }, viewport, size: 48 }), { x: 21, y: 21 })
  const out = resolvePosition({ corner: 'br', offset: { x: 9999, y: -9999 }, viewport, size: 48 })
  assert.ok(out.x <= viewport.w - 48 && out.y >= 0, JSON.stringify(out))
})

test('位置按**实际占位宽**贴角（回归：只按精灵 48 贴角会把标签探出视口）', () => {
  const viewport = { w: 1400, h: 900 }
  // 负向控制：旧算法（只传 size）在实测那台机器上确实会溢出 —— 右缘 1529 > 1400
  const legacy = resolvePosition({ corner: 'br', offset: null, viewport, size: 48 })
  assert.ok(legacy.x + 193 > viewport.w, `负向控制失效：${legacy.x + 193}`)
  // 传实际占位后：右缘/下缘恰好留一个 margin，整块在视口内
  const fixed = resolvePosition({ corner: 'br', offset: null, viewport, size: 48, width: 193, height: 58 })
  assert.equal(fixed.x + 193, viewport.w - 16)
  assert.equal(fixed.y + 58, viewport.h - 16)
  // 窗口比挂件还窄 ⇒ 贴 0，不出现负坐标
  const tiny = resolvePosition({ corner: 'br', offset: null, viewport: { w: 120, h: 60 }, size: 48, width: 193, height: 58 })
  assert.ok(tiny.x >= 0 && tiny.y >= 0, JSON.stringify(tiny))
  // 拖动越界同样按实际占位夹住（不是按 size）
  const dragged = resolvePosition({ corner: 'br', offset: { x: 9999, y: 9999 }, viewport, size: 48, width: 193, height: 58 })
  assert.ok(dragged.x <= viewport.w - 193 && dragged.y <= viewport.h - 58, JSON.stringify(dragged))
})

test('手势：短按不动=click；动 4px=拖；按住超 220ms 不动=press', () => {
  const from = { x: 100, y: 100 }
  assert.equal(classifyGesture({ from, to: from, durationMs: 50 }), 'click')
  assert.equal(classifyGesture({ from, to: { x: 102, y: 102 }, durationMs: 50 }), 'click') // √8≈2.8px 不算拖
  // 边界：对角线刚好 √18≈4.24px 就已经算拖（阈值是 4px，不是 5px）
  assert.equal(classifyGesture({ from, to: { x: 103, y: 103 }, durationMs: 50 }), 'drag')
  assert.equal(classifyGesture({ from, to: { x: 100 + DRAG_THRESHOLD_PX, y: 100 }, durationMs: 30 }), 'drag')
  assert.equal(classifyGesture({ from, to: from, durationMs: LONG_PRESS_MS }), 'press')
  assert.equal(classifyGesture({ from: null, to: from, durationMs: 10 }), 'none')
  assert.equal(classifyGesture({ from, to: null, durationMs: 100 }), 'none')
})

test('拖动量累加到 offset（相对起始点，不重新读绝对坐标）', () => {
  const next = offsetFromDrag({
    startOffset: { x: 0, y: 0 },
    startPos: { x: 900, y: 700 },
    currentPos: { x: 860, y: 660 },
    base: { x: 936, y: 736 },
  })
  assert.deepEqual(next, { x: -40, y: -40 })
})
