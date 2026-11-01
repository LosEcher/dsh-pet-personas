/**
 * compose-atlas.mjs — 把 `pixel/frames/` 里做好的额外帧**合进图集**（基础图集 + 每状态覆盖）。
 *
 * 为什么需要独立一步（2026-11-01）：切片脚本 `slice-sprite-sheet.py` 只会从"源大图"按
 * 固定列数切，而我们的额外帧是**用部件搬运做出来的**（`tools/frame-parts.py`——像素必须是输入像素的
 * 副本，不重采样）。所以它们不能走切片，只能在切片之后再合成。
 *
 * 契约：
 *   · 图集列数 = 各状态实际帧数的**最大值**；状态里没用到的格子保持透明（绝不填"看起来差不多"的帧）；
 *   · `durations` 长度 = 该状态帧数（播放器按 durations 长度决定帧数，见 sprite-player）；
 *   · 合并后 `pet-cadence.json` 要同步更新（它是节奏的唯一真源）；
 *   · 每一步都可机械校验：合并前先用 `frame-gate` 过一遍，合并后用 `atlas-cadence` 测试兜底。
 *
 * 用法：
 *   node tools/compose-atlas.mjs --atlas pixel/art/mermaid-maid-sheet --frames pixel/frames/manifest.json [--dry-run]
 * 清单格式（manifest.json）：
 *   { "sleep": { "frames": ["pixel/frames/sleep-z/sleep_z_0.png", "..."], "durations": [850,850,850,850] } }
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { deflateSync, crc32 } from 'node:zlib'
import { readPng, opaqueCount } from './png-alpha.mjs'

function chunk(type, body) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(body.length)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, body])) >>> 0)
  return Buffer.concat([len, t, body, crc])
}

function writeRgbaPng(path, width, height, data) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0
    data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  writeFileSync(path, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]))
}

/** 从图集里切出一格（RGBA Buffer） */
function cutCell(png, col, row, cell) {
  const out = Buffer.alloc(cell * cell * 4)
  for (let y = 0; y < cell; y += 1) {
    for (let x = 0; x < cell; x += 1) {
      const si = ((row * cell + y) * png.width + (col * cell + x)) * png.channels
      const di = (y * cell + x) * 4
      out[di] = png.data[si]
      out[di + 1] = png.data[si + 1]
      out[di + 2] = png.data[si + 2]
      out[di + 3] = png.channels === 4 ? png.data[si + 3] : 255
    }
  }
  return out
}

function pasteCell(atlas, atlasWidth, cell, col, row, src) {
  const srcPng = readPng(src)
  if (srcPng.width !== cell || srcPng.height !== cell) {
    throw new Error(`${src}: 尺寸 ${srcPng.width}x${srcPng.height}，应为 ${cell}x${cell}`)
  }
  for (let y = 0; y < cell; y += 1) {
    for (let x = 0; x < cell; x += 1) {
      const si = (y * cell + x) * srcPng.channels
      const di = ((row * cell + y) * atlasWidth + (col * cell + x)) * 4
      atlas[di] = srcPng.data[si]
      atlas[di + 1] = srcPng.data[si + 1]
      atlas[di + 2] = srcPng.data[si + 2]
      atlas[di + 3] = srcPng.channels === 4 ? srcPng.data[si + 3] : 255
    }
  }
}

export function composeAtlas({ atlasPrefix, manifestPath, dryRun = false }) {
  const metaPath = `${atlasPrefix}.atlas.json`
  const pngPath = `${atlasPrefix}.atlas.png`
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
  const base = readPng(pngPath)
  const cell = meta.cell[0]
  const rows = Math.round(meta.atlas[1] / cell)
  const baseCols = Math.round(meta.atlas[0] / cell)

  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}
  const baseDir = dirname(resolve(manifestPath))
  const problems = []
  const states = {}
  let cols = baseCols

  for (const [state, spec] of Object.entries(meta.states)) {
    const override = manifest[state]
    const durations = override?.durations ?? spec.durations
    const frames = override?.frames ?? null
    if (frames && frames.length !== durations.length) {
      problems.push(`${state}: frames ${frames.length} 个，durations ${durations.length} 项 —— 必须一一对应`)
    }
    cols = Math.max(cols, durations.length)
    states[state] = { row: spec.row, durations, frames: frames ?? null }
  }
  if (problems.length) return { ok: false, problems }

  const width = cols * cell
  const height = rows * cell
  const atlas = Buffer.alloc(width * height * 4)

  for (const [state, spec] of Object.entries(states)) {
    if (spec.frames) {
      spec.frames.forEach((rel, col) => {
        const abs = resolve(baseDir, '../..', rel)          // manifest 里的路径相对仓根
        const real = existsSync(abs) ? abs : resolve(rel)
        if (!existsSync(real)) throw new Error(`${state} 第 ${col} 帧不存在：${rel}`)
        pasteCell(atlas, width, cell, col, spec.row, real)
      })
    } else {
      // 没有覆盖：按基础图集的列数原样拷贝（未用到的列留透明）
      for (let col = 0; col < baseCols; col += 1) {
        const src = cutCell(base, col, spec.row, cell)
        for (let y = 0; y < cell; y += 1) {
          for (let x = 0; x < cell; x += 1) {
            const si = (y * cell + x) * 4
            if (src[si + 3] === 0) continue
            const di = ((spec.row * cell + y) * width + (col * cell + x)) * 4
            atlas[di] = src[si]
            atlas[di + 1] = src[si + 1]
            atlas[di + 2] = src[si + 2]
            atlas[di + 3] = src[si + 3]
          }
        }
      }
    }
  }

  // 自检：每个状态引用到的帧都必须非空（空帧会让宠物"闪没"，见 pixel/frames/README.md）
  const png = { width, height, channels: 4, data: atlas }
  for (const [state, spec] of Object.entries(states)) {
    for (let col = 0; col < spec.durations.length; col += 1) {
      const n = opaqueCount(png, col * cell, spec.row * cell, cell, cell)
      if (n === 0) problems.push(`${state} 第 ${col} 帧是空的（row=${spec.row} col=${col}）`)
    }
  }
  if (problems.length) return { ok: false, problems }

  const outMeta = {
    ...meta,
    atlas: [width, height],
    states: Object.fromEntries(Object.entries(states).map(([k, v]) => [k, { row: v.row, durations: v.durations }])),
    composedFrom: manifestPath,
    composedAt: new Date().toISOString().slice(0, 19) + 'Z',
  }

  if (!dryRun) {
    writeRgbaPng(pngPath, width, height, atlas)
    writeFileSync(metaPath, JSON.stringify(outMeta, null, 1) + '\n')
  }
  return { ok: true, problems, meta: outMeta, cols, width, height }
}

if (process.argv[1]?.endsWith('compose-atlas.mjs')) {
  const argv = process.argv.slice(2)
  const arg = (name, fallback = null) => {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
  }
  const atlasPrefix = arg('--atlas')
  const manifestPath = arg('--frames')
  if (!atlasPrefix || !manifestPath) {
    console.error('用法: node tools/compose-atlas.mjs --atlas pixel/art/<name>-sheet --frames pixel/frames/manifest.json [--dry-run]')
    process.exit(2)
  }
  try {
    const result = composeAtlas({ atlasPrefix, manifestPath, dryRun: argv.includes('--dry-run') })
    if (!result.ok) {
      for (const p of result.problems) console.error('✗ ' + p)
      process.exit(1)
    }
    console.log(`合成完成：${result.width}×${result.height}（${result.cols} 列）`)
    for (const [state, spec] of Object.entries(result.meta.states)) {
      console.log(`  ${state.padEnd(8)} row=${spec.row} frames=${spec.durations.length} durations=${JSON.stringify(spec.durations)}`)
    }
  } catch (error) {
    console.error(`合成失败：${error.message}`)
    process.exit(1)
  }
}
