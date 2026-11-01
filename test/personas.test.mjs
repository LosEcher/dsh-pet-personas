import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PERSONAS } from '../avatar-state.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

test('每个 persona 都有 SVG 文件', () => {
  for (const p of PERSONAS) {
    const f = join(ROOT, 'personas', `${p}.svg`)
    assert.ok(existsSync(f), `缺 ${f}`)
  }
})

test('每个 SVG 都含四种表情组 + mark + body/head（结构契约，CSS 才点得亮）', () => {
  for (const p of PERSONAS) {
    const s = readFileSync(join(ROOT, 'personas', `${p}.svg`), 'utf8')
    for (const cls of ['av-expr-happy', 'av-expr-worry', 'av-expr-confused', 'av-expr-focused', 'av-mark', 'av-body', 'av-head']) {
      assert.ok(s.includes(cls), `${p}.svg 缺 ${cls}`)
    }
    assert.ok(s.includes('viewBox="0 0 120 120"'), `${p}.svg 的 viewBox 必须是 120×120（统一切换尺寸）`)
  }
})

test('负向控制：SVG 不得引用外部资源（内网/离线可用、且不受第三方变更影响）', () => {
  for (const p of PERSONAS) {
    const s = readFileSync(join(ROOT, 'personas', `${p}.svg`), 'utf8')
    assert.ok(!/https?:\/\//.test(s.replace(/xmlns="[^"]+"/g, '')), `${p}.svg 含外部 URL`)
    assert.ok(!/<image\b/.test(s), `${p}.svg 含 <image>（应全矢量）`)
  }
})

test('负向控制：不得出现厂商名（IP 门，与母仓 A4 同一条纪律）', () => {
  // 只禁**真实第三方**角色/商标（用户已确认参考图为其 AI 生成设定形象，可用模型名做 label）
  const banned = ['Clippy', 'Microsoft', '瑞星', 'Rising']
  for (const p of PERSONAS) {
    const s = readFileSync(join(ROOT, 'personas', `${p}.svg`), 'utf8')
    for (const b of banned) assert.ok(!s.includes(b), `${p}.svg 含厂商标识 ${b}`)
  }
})

test('CSS 里每个表情选择器都同时有 display:none 的兜底与点亮规则', () => {
  const css = readFileSync(join(ROOT, 'persona.css'), 'utf8')
  assert.match(css, /\.av \.av-expr \{ display: none; \}/)
  for (const face of ['happy', 'worry', 'confused', 'focused']) {
    assert.ok(css.includes(`av-face-${face}`), `CSS 缺 av-face-${face}`)
  }
  assert.ok(/prefers-reduced-motion/.test(css), 'CSS 必须处理 prefers-reduced-motion')
})

test('persona 注册表与代码常量不漂（index.json ↔ PERSONAS）', () => {
  const idx = JSON.parse(readFileSync(join(ROOT, 'personas', 'index.json'), 'utf8'))
  const ids = idx.personas.map((p) => p.id).sort()
  assert.deepEqual(ids, [...PERSONAS].sort(), 'index.json 与 avatar-state.mjs 的形象清单必须一致')
  for (const p of idx.personas) {
    assert.ok(p.ipNote && p.ipNote.length > 4, `${p.id} 缺 ipNote（IP 门要求写清来源）`)
    assert.equal(p.viewBox.join(','), '0,0,120,120')
  }
})
