#!/usr/bin/env node
/**
 * pixel2svg.mjs — 把 **按目标尺寸手画的像素图**（ASCII 网格）转成紧凑 SVG。
 *
 * 为什么是"按尺寸画"而不是"把 960px 插画缩小"（2026-11-01 实测）：
 *   把参考图直接降采样到 24/32px 会糊成一团（眼睛和头发混在一起）——
 *   像素画的读法靠**在目标尺寸上重新设计**：1px 描边、2–4px 的眼睛、单一剪影。
 *   本轮就是按这个规矩重画了 24×24 的版本。
 *
 * 输出优化：同一行里颜色相同的连续像素合并成一个 <rect>（greedy run-merge），
 * 24×24 的图能压到 ~4–12 KB 文本（gzip 后 1–2 KB），比逐像素少 3–5 倍节点。
 *
 * 用法：node tools/pixel2svg.mjs pixel/whale-maid.txt pixel/whale-maid.svg
 * 退出码：0 ok / 1 网格不合法（行宽不一致、含未知字符）/ 2 参数错误
 */
import { readFileSync, writeFileSync } from 'node:fs'

export const PALETTE = {
  '.': null,           // 透明
  o: '#2a3050', h: '#3b5385', H: '#5b7fb5',
  w: '#f7f4ee', s: '#ffdcc8', S: '#e8b79f',
  e: '#ffffff', p: '#3a2f52',
  b: '#6b93c4', d: '#2c3555', a: '#fbf9f4',
}

export function parseGrid(text) {
  const rows = text.split('\n').filter((l) => l.trim() && !l.startsWith('#'))
  if (rows.length === 0) throw new Error('空网格')
  const w = rows[0].length
  rows.forEach((r, i) => {
    if (r.length !== w) throw new Error(`第 ${i + 1} 行宽度 ${r.length} ≠ ${w}（必须等高宽）`)
    for (const ch of r) if (!(ch in PALETTE)) throw new Error(`第 ${i + 1} 行含未知字符 "${ch}"`)
  })
  return { rows, width: w, height: rows.length }
}

export function toSvg({ rows, width, height }) {
  const out = []
  for (let y = 0; y < height; y += 1) {
    let x = 0
    while (x < width) {
      const ch = rows[y][x]
      if (PALETTE[ch] === null) { x += 1; continue }
      let x2 = x
      while (x2 + 1 < width && rows[y][x2 + 1] === ch) x2 += 1
      out.push(`<rect x="${x}" y="${y}" width="${x2 - x + 1}" height="1" fill="${PALETTE[ch]}"/>`)
      x = x2 + 1
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">\n${out.join('')}\n</svg>\n`
}

if (process.argv[1]?.endsWith('pixel2svg.mjs')) {
  const [, , inp, outp] = process.argv
  if (!inp || !outp) { console.error('用法: node tools/pixel2svg.mjs <input.txt> <output.svg>'); process.exit(2) }
  try {
    const grid = parseGrid(readFileSync(inp, 'utf8'))
    const svg = toSvg(grid)
    writeFileSync(outp, svg)
    const kb = (Buffer.byteLength(svg) / 1024).toFixed(1)
    console.log(`${outp}: ${grid.width}×${grid.height}, ${svg.split('<rect').length - 1} rects, ${kb} KB`)
    process.exit(Buffer.byteLength(svg) <= 8 * 1024 ? 0 : 1)
  } catch (e) {
    console.error('pixel2svg: ' + e.message); process.exit(1)
  }
}
