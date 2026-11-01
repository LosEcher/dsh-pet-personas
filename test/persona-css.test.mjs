/**
 * persona-css.test.mjs — 动效的**属性归属**与"每个状态都带 pop"。
 *
 * 动因（2026-11-01 实测）：`.av-sprite { animation: av-sprite-pop }` 与
 * `[data-state="sleep"] .av-sprite { animation: av-breathe }` 都写同一个 `animation` 属性，
 * 后者特异性更高 ⇒ **4 个状态的过渡动画被整个盖掉**（sleep/alert/happy/busy 从来没有 pop）。
 * 这种缺陷不会报错、也不会在静态截图里出现——只能靠解析 CSS 断言。
 *
 * 契约（改 CSS 前先读）：
 *   ① 每条「落在 .av-sprite 上」的 animation 声明都必须包含 pop；
 *   ② pop 只许动 scale/opacity，状态动效只许动 translate/rotate，朝向只许动 transform；
 *      —— 同一个属性被两条动画写 ⇒ 后者静默赢，这正是本文件防的事故。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'persona.css'), 'utf8')

/** 抽 @keyframes 名字 → 它写了哪些动画属性 */
function keyframesProps(text) {
  const out = new Map()
  const re = /@keyframes\s+([\w-]+)\s*\{/g
  let m
  while ((m = re.exec(text))) {
    let depth = 1
    let i = re.lastIndex
    const start = i
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth += 1
      else if (text[i] === '}') depth -= 1
      i += 1
    }
    const body = text.slice(start, i - 1)
    const props = new Set()
    for (const decl of body.matchAll(/([\w-]+)\s*:/g)) props.add(decl[1])
    out.set(m[1], props)
  }
  return out
}

/** 抽「声明块」→ 选择器 + animation 值 */
function animationRules(text) {
  const rules = []
  for (const r of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = r[1].trim()
    if (selector.startsWith('@')) continue
    const anim = /(?:^|[;\s])animation\s*:\s*([^;]+)/.exec(r[2])
    if (anim) rules.push({ selector, value: anim[1].trim() })
  }
  return rules
}

const frames = keyframesProps(css)
const rules = animationRules(css)

test('每条落在 .av-sprite 上的 animation 都包含 pop（否则换状态没有过渡）', () => {
  // `animation: none` 是"显式关闭"（reduced-motion / 拖拽态），不算漏 pop
  const spriteRules = rules.filter((r) => /(^|[^\w-])\.av-sprite\b/.test(r.selector)
    && !/^none\b/.test(r.value))
  assert.ok(spriteRules.length >= 5, `应至少有基础 + 4 个状态的规则（实际 ${spriteRules.length}）`)
  for (const r of spriteRules) {
    assert.match(r.value, /--av-pop|av-sprite-pop/,
      `"${r.selector}" 的 animation 没带 pop ⇒ 它会覆盖掉换状态的过渡`)
  }
})

test('属性归属：pop 只动 scale/opacity，状态动效只动 translate/rotate', () => {
  const allowed = { 'av-sprite-pop': ['scale', 'opacity'] }
  for (const [name, props] of frames) {
    for (const p of props) {
      if (allowed[name]) {
        assert.ok(allowed[name].includes(p), `@keyframes ${name} 动了 ${p}（只许 ${allowed[name].join('/')}）`)
      } else if (name.startsWith('av-') && !name.startsWith('av-once') && !name.startsWith('av-bob') && name !== 'av-blink' && name !== 'av-bubble-in') {
        assert.ok(['translate', 'rotate'].includes(p),
          `@keyframes ${name} 动了 ${p}（状态动效只许 translate/rotate，否则会和 pop 抢属性）`)
      }
    }
  }
  assert.ok(frames.has('av-sprite-pop'), '缺 av-sprite-pop')
})

test('朝向用 transform、拖拽用 scale/rotate —— 三者不共用属性', () => {
  const facing = /\.av-sprite\s*\{[^}]*transform:\s*scaleX\(var\(--av-face/.test(css)
  assert.ok(facing, '.av-sprite 必须用 transform: scaleX(var(--av-face)) 表达朝向')
  const drag = /\[data-dragging="1"\]\s*\.av-sprite\s*\{([^}]*)\}/.exec(css)
  assert.ok(drag, '缺拖拽态规则')
  assert.doesNotMatch(drag[1], /transform\s*:/, '拖拽规则不得写 transform（会把朝向覆盖掉）')
  assert.match(drag[1], /scale\s*:/)
  assert.match(drag[1], /rotate\s*:/)
})

test('负向控制：旧写法（状态规则不带 pop）必须被判红', () => {
  const bad = '@keyframes av-sprite-pop { 0% { scale: .9 } }\n[data-state="sleep"] .av-sprite { animation: av-breathe 3.6s infinite }'
  const badRules = animationRules(bad).filter((r) => /\.av-sprite\b/.test(r.selector))
  const offenders = badRules.filter((r) => !/--av-pop|av-sprite-pop/.test(r.value))
  assert.equal(offenders.length, 1, '负向控制失效：检测没认出"不带 pop"的状态规则')
})

test('reduced-motion 下所有动效关闭（状态换行照旧，不因省动效而失真）', () => {
  assert.match(css, /prefers-reduced-motion[\s\S]*\.av-sprite\s*\{[^}]*animation:\s*none/)
})
