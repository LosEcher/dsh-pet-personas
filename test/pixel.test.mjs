import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseGrid, toSvg, PALETTE } from '../tools/pixel2svg.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('pixel/whale-maid.txt 是合法网格（等高宽、只用调色板字符）', () => {
  const g = parseGrid(readFileSync(join(ROOT, 'pixel/whale-maid.txt'), 'utf8'))
  assert.ok(g.width >= 16 && g.height >= 16, `网格太小：${g.width}×${g.height}`)
  assert.equal(g.width, g.height, '像素角色应为方图（便于整数缩放）')
})

test('负向控制：行宽不一致必须报错', () => {
  // 只含调色板字符，确保触发的是"宽度"而不是"未知字符"
  assert.throws(() => parseGrid('ab\na\n'), /宽度/)
})

test('负向控制：未知字符必须报错（否则会静默丢像素）', () => {
  assert.throws(() => parseGrid('ab\nZo\n'), /未知字符/)
})

test('toSvg 只对非透明像素出 rect，且做了行内 run 合并', () => {
  // 'aa\naa'：每行一个 run ⇒ 2 个 rect；若不做合并会是 4 个
  assert.equal(toSvg(parseGrid('aa\naa\n')).split('<rect').length - 1, 2)
  // 相邻不同色不合并 ⇒ 2×2 网格 4 个 rect
  assert.equal(toSvg(parseGrid('ab\nab\n')).split('<rect').length - 1, 4)
  // 透明像素不得产出 rect
  const svg = toSvg(parseGrid('..\n..\n'))
  assert.equal(svg.split('<rect').length - 1, 0)
})

test('负向控制：全像素同行时必须合并成 1 个 rect（不做 run-merge 会膨胀 3 倍）', () => {
  const g = parseGrid('aaa\n')
  assert.equal(toSvg(g).split('<rect').length - 1, 1)
})

test('产物存在且体积在挂件预算内（≤8KB）', () => {
  const p = join(ROOT, 'pixel/whale-maid.svg')
  assert.ok(existsSync(p))
  const kb = Buffer.byteLength(readFileSync(p)).valueOf() / 1024
  assert.ok(kb <= 8, `pixel/whale-maid.svg 体积 ${kb.toFixed(1)}KB 超预算`)
})

test('调色板里 "." 必须是透明（否则背景会被画成色块）', () => {
  assert.equal(PALETTE['.'], null)
})
