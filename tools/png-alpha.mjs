/**
 * png-alpha.mjs — 读 PNG 的 alpha 通道（零依赖，只用 node:zlib）。
 *
 * 为什么要它（2026-11-01）：`unknown` 行第二格 α 全 0，而 atlas.json 里 durations 是
 * `[1800, 140]` ⇒ 宠物在"判不了"状态下每 1.94 秒**消失 140 毫秒**。这类缺陷用肉眼在静态
 * 预览图上很难发现（预览是 2×6 网格，空格看起来只是"那一格没画东西"），而没有任何断言会红。
 *
 * 判据只能是**像素本身**：引用到的每一格必须非空，且非空的格子必须被某个状态引用。
 * 不用 PIL/ImageMagick：门禁不能依赖本机装了哪个 venv（跨机器会静默失效）。
 */
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

/** @returns {{width:number, height:number, channels:number, data:Buffer}} */
export function readPng(file) {
  const buf = readFileSync(file)
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10]
  for (let i = 0; i < 8; i += 1) {
    if (buf[i] !== SIG[i]) throw new Error(`${file}: 不是 PNG`)
  }
  let off = 8
  let ihdr = null
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const body = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      ihdr = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colorType: body[9],
        interlace: body[12],
      }
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    off += 12 + len
  }
  if (!ihdr) throw new Error(`${file}: 缺 IHDR`)
  if (ihdr.depth !== 8) throw new Error(`${file}: 只支持 8bit（实际 ${ihdr.depth}）`)
  if (ihdr.interlace !== 0) throw new Error(`${file}: 不支持隔行扫描`)
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.colorType]
  if (!channels) throw new Error(`${file}: 不支持 colorType ${ihdr.colorType}`)

  const raw = inflateSync(Buffer.concat(idat))
  const { width, height } = ihdr
  const stride = width * channels
  const out = Buffer.alloc(stride * height)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const cur = Buffer.alloc(stride)
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? cur[x - channels] : 0
      const b = prev[x]
      const c = x >= channels ? prev[x - channels] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c)
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
      } else if (filter !== 0) throw new Error(`${file}: 未知 filter ${filter}`)
      cur[x] = v & 0xff
    }
    cur.copy(out, y * stride)
    prev = cur
  }
  return { width, height, channels, data: out }
}

/** 某个矩形区域内「非透明像素数」。alpha 缺失（RGB）时按"全部不透明"计。 */
export function opaqueCount(png, x0, y0, w, h) {
  let n = 0
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const i = (y * png.width + x) * png.channels
      const alpha = png.channels === 4 ? png.data[i + 3] : png.channels === 2 ? png.data[i + 1] : 255
      if (alpha > 0) n += 1
    }
  }
  return n
}
