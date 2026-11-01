#!/usr/bin/env node
/**
 * make-atlas.mjs — 从**一张** 24×24 ASCII 底图派生多帧、拼成**单张矢量图集（atlas）**。
 *
 * 为什么是图集（2026-11-01 调研后的改法）：公开实现里做桌宠的都是**图集 + 按 (col,row) 裁一格**，
 * 不是每个状态一个文件：
 *   · oneko.js      → `oneko.gif`，32×32 格，`background-position:${col*32}px ${row*32}px`
 *   · pet4claude    → `spritesheet.webp` + `pet.json`（CELL_W/CELL_H/ATLAS_W/ATLAS_H），
 *                     `anim.current_row()`、`frame_index` 决定裁哪一格
 *   · 各家 shimeji   → 同理，行=动作，列=帧
 * 所以本工具输出「一张 atlas.svg + 一份 atlas.json」，渲染端只需改 background-position/viewBox。
 *
 * 帧怎么来：底图 + 程序化变体（省得手画 6 张，且变体规则可测）：
 *   idle  row0: [base, blink]           —— 眨眼=眼睛那一行换成闭眼
 *   busy  row1: [base_y-1, base_y-2]    —— 上下 1~2px（呼吸/干活）
 *   alert row2: [base+mark, base+mark]  —— 右上角感叹号（静止，标记态不该抖）
 *
 * 用法：node tools/make-atlas.mjs pixel/whale-maid.txt pixel/atlas
 * 产物：pixel/atlas.svg、pixel/atlas.json；退出码 0 ok / 1 非法网格 / 2 参数错
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { parseGrid, PALETTE } from './pixel2svg.mjs'

const EYE_ROWS = (rows) => rows.reduce((acc, r, i) => (r.includes('e') || r.includes('p') ? [...acc, i] : acc), [])

/** 闭眼：把含 e/p 的行里 e/p 换成描边色（形成一条横线） */
function blinkFrame(rows) {
  return rows.map((r) => r.replace(/[ep]/g, 'o'))
}

/** 整体上移 n 像素（顶部补透明、底部丢弃） */
function shiftUp(rows, n) {
  const blank = '.'.repeat(rows[0].length)
  return [...Array(n).fill(blank), ...rows.slice(0, rows.length - n)]
}

/** 右上角加感叹号（3px 宽）——不覆盖已有像素，只填透明处 */
function withMark(rows) {
  const W = rows[0].length
  const mark = [
    [2, 'o'], [3, 'o'],
    [2, 'e'], [3, 'e'],
    [2, 'e'], [3, 'e'],
    [2, '.'], [3, '.'],
    [2, 'e'], [3, 'e'],
  ]
  const out = rows.map((r) => r.split(''))
  for (const [cx, ch] of mark) {
    for (const y of [1, 2, 3, 4, 5, 6, 7]) {
      if (out[y] && out[y][cx] === '.' && ch !== '.') out[y][cx] = ch
    }
  }
  return out.map((a) => a.join(''))
}

export function buildFrames(rows) {
  return {
    idle: [rows, blinkFrame(rows)],
    busy: [shiftUp(rows, 1), shiftUp(rows, 2)],
    alert: [withMark(rows), withMark(rows)],
  }
}

export function atlasSvg(frames, w, h) {
  const order = ['idle', 'busy', 'alert']
  const cells = []
  order.forEach((state, row) => {
    frames[state].forEach((frameRows, col) => {
      const g = []
      frameRows.forEach((r, y) => {
        let x = 0
        while (x < w) {
          const ch = r[x]
          if (PALETTE[ch] === null) { x += 1; continue }
          let x2 = x
          while (x2 + 1 < w && r[x2 + 1] === ch) x2 += 1
          g.push(`<rect x="${x}" y="${y}" width="${x2 - x + 1}" height="1" fill="${PALETTE[ch]}"/>`)
          x = x2 + 1
        }
      })
      cells.push(`<g transform="translate(${col * w},${row * h})" data-state="${state}" data-frame="${col}">${g.join('')}</g>`)
    })
  })
  const cols = Math.max(...order.map((s) => frames[s].length))
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols * w} ${order.length * h}" shape-rendering="crispEdges">\n${cells.join('\n')}\n</svg>\n`,
    meta: {
      cell: [w, h],
      cols,
      rows: order.length,
      /** 行=状态；durations 逐帧毫秒（不对齐同一帧率：慢动作就该慢） */
      states: {
        idle: { row: 0, durations: [1800, 140] },
        busy: { row: 1, durations: [420, 420] },
        alert: { row: 2, durations: [1000, 1000] },
      },
    },
  }
}

if (process.argv[1]?.endsWith('make-atlas.mjs')) {
  const [, , inp, outp] = process.argv
  if (!inp || !outp) { console.error('用法: node tools/make-atlas.mjs <input.txt> <输出前缀>'); process.exit(2) }
  try {
    const grid = parseGrid(readFileSync(inp, 'utf8'))
    const frames = buildFrames(grid.rows)
    const { svg, meta } = atlasSvg(frames, grid.width, grid.height)
    writeFileSync(outp + '.svg', svg)
    writeFileSync(outp + '.json', JSON.stringify(meta, null, 1) + '\n')
    const kb = (Buffer.byteLength(svg) / 1024).toFixed(1)
    console.log(`${outp}.svg  ${meta.cols}×${meta.rows} 格（cell ${grid.width}×${grid.height}）  ${kb} KB`)
    process.exit(0)
  } catch (e) { console.error('make-atlas: ' + e.message); process.exit(1) }
}
