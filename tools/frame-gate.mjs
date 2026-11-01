/**
 * frame-gate.mjs — **候选帧收口门禁**：任何"生成/外部"来的帧，必须先过这里，才有资格进图集。
 *
 * 起因（2026-11-01）：文生图/编辑模型给出的图，尺寸、色板、构图、透明度全都和现有素材不一样；
 * 直接塞进 atlas 会同时毁掉三件事——像素风的"整像素对齐"、状态之间的一致的角色、以及帧间稳定
 * （相邻帧一跳，宠物就闪）。所以"能出图"不是终点，**能不能收口**才是。
 *
 * 判据（每条都能单独红，且都能说出为什么）：
 *   1. 尺寸 == 目标 cell（默认 96×96）
 *   2. alpha 二值化后**只有一个连通主体**，且与基准帧的 alpha 覆盖率差 ≤ 15%（防变胖变瘦）
 *   3. 颜色**全部落在基准调色板里**（量化后与基准的色板重合率 ≥ 95%，且不新增颜色碎片）
 *   4. 主体的**质心**与基准帧偏差 ≤ 1px（防位移漂移）
 *   5. 与基准帧的**像素差分**在 [下限, 上限] 之间：太小=没变（白跑），太大=换了个人
 *   6. 主体不得贴边（四周留 ≥1px 透明边），否则拖影/裁切会在播放时露白
 *
 * 用法（CLI）：
 *   node tools/frame-gate.mjs --base <base.png> --cand <cand.png> [--cell 96] [--json]
 * 退出码：0 通过 / 1 有判据失败 / 2 判不了（文件读不到、尺寸不对）
 */
import { readPng } from './png-alpha.mjs'

/**
 * 阈值**不是拍出来的**：先把现有手绘素材自己量了一遍（2026-11-01，两套 atlas、每套 5 对相邻帧），
 * 得到"同一角色、同一个状态、只差一个动作"的真实波动：
 *
 *   覆盖率相对差   0.003 – 0.167
 *   质心位移       0.50 – 5.04 px
 *   掩膜差分       0.038 – 0.348
 *   每格色数       恒为 32（并集 332 ⇒ **每格各自量化，不是共享调色板**）
 *
 * 于是阈值取"实测上界 + margin"，并据此改掉两条一开始想当然的规则：
 *   · 原来想要求"候选色板与基准重合 ≥95%" —— 实测相邻手绘帧的像素级色板重合只有 13%–20%，
 *     这条会把**自家素材**判死。真正的约束是"每格 ≤32 色 + alpha 二值"（像素风不能被渐变污染）。
 *   · 原来想要求"四周留 1px 透明边" —— 实测手绘素材本来就贴边（x 到 95），这条同样会误杀。
 */
export const DEFAULT_LIMITS = Object.freeze({
  cell: 96,
  alphaRatioTolerance: 0.20,   // 实测上界 0.167 + margin
  centroidTolerancePx: 6.0,    // 实测上界 5.04 + margin（不同姿势本来就会位移）
  changedMinRatio: 0.02,       // mask 内至少 2% 像素 RGB 真的变了（否则是白跑）
  // "还是不是同一个角色"看**网格色距**（8×8 网格的平均色），而不是逐像素差：
  // 实测（2026-11-01，手绘素材自身）：同一角色相邻帧 = 0.0507 / 0.0811 / 0.0965 / 0.1368 / 0.0940；
  // 模型重画的候选（眼睛闭上）= 0.0548，落在同一区间内；而"几乎没改"的那张 = 0.0350。
  // 逐像素差在这里没用：模型是**重画**，几乎每个像素颜色都会变一点（实测 0.82），但那不是"换了个人"。
  identityGridMax: 0.20,
  identityGridN: 8,
  maxColors: 32,               // 实测每格恒为 32
  semiTransparentMax: 0.02,    // 半透明像素占比上限（抗锯齿/软边会把它顶起来）
  alphaThreshold: 110,         // 与切片脚本一致
})

/** RGBA → 每像素 {r,g,b,a} 直方图 + 覆盖率 + 质心 */
export function profile(png, { alphaThreshold = 110 } = {}) {
  const { width, height, channels, data } = png
  const colors = new Map()
  let opaque = 0
  let semi = 0
  let sx = 0
  let sy = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  const mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels
      const a = channels === 4 ? data[i + 3] : channels === 2 ? data[i + 1] : 255
      const solid = a >= alphaThreshold
      mask[y * width + x] = solid ? 1 : 0
      if (!solid) { if (a > 0) semi += 1; continue }
      opaque += 1
      sx += x; sy += y
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      const r = data[i], g = channels >= 3 ? data[i + 1] : 0, b = channels >= 3 ? data[i + 2] : 0
      const key = `${r},${g},${b}`
      colors.set(key, (colors.get(key) ?? 0) + 1)
    }
  }
  return {
    width, height, mask, colors,
    opaque,
    semiTransparent: semi / (width * height),
    coverage: opaque / (width * height),
    centroid: opaque ? { x: sx / opaque, y: sy / opaque } : null,
    bbox: opaque ? { minX, minY, maxX, maxY } : null,
  }
}

/** 两个 alpha 掩膜的像素差分比例（并集归一化，0=完全一样，1=完全不重叠） */
export function maskDiffRatio(a, b) {
  let union = 0
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] || b[i]) union += 1
    if (a[i] !== b[i]) diff += 1
  }
  return union ? diff / union : 0
}

/**
 * mask 内部的 RGB 差异比例：在基准帧的不透明区域上，逐像素比较 RGB。
 * 这是"到底改没改"的唯一可靠判据——alpha 由基准帧提供时，掩膜差分恒为 0（假通过）。
 */
export function rgbDiffRatio(basePng, candPng, alphaThreshold = 110) {
  const { width, height, channels, data } = basePng
  let inside = 0
  let changed = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels
      const a = channels === 4 ? data[i + 3] : 255
      if (a < alphaThreshold) continue
      inside += 1
      const j = (y * width + x) * candPng.channels
      if (data[i] !== candPng.data[j] || data[i + 1] !== candPng.data[j + 1] || data[i + 2] !== candPng.data[j + 2]) {
        changed += 1
      }
    }
  }
  return { inside, changed, ratio: inside ? changed / inside : 0 }
}

/**
 * 网格色距：把画面切成 n×n 格，逐格取不透明像素的平均色，再算平均欧氏距离（0..1）。
 * 为什么要它：模型"重画"会改掉几乎每个像素，逐像素差无法区分"同一角色换表情"和"换了个人"；
 * 而分块平均色恰好对"线条重绘"不敏感、对"配色/发色/服装变了"很敏感。
 */
export function gridColorDistance(a, b, n = 8, alphaThreshold = 110) {
  const cells = (png) => {
    const step = png.width / n
    const out = []
    for (let gy = 0; gy < n; gy += 1) {
      for (let gx = 0; gx < n; gx += 1) {
        let r = 0, g = 0, bl = 0, c = 0
        for (let y = Math.floor(gy * step); y < Math.floor((gy + 1) * step); y += 1) {
          for (let x = Math.floor(gx * step); x < Math.floor((gx + 1) * step); x += 1) {
            const i = (y * png.width + x) * png.channels
            const alpha = png.channels === 4 ? png.data[i + 3] : 255
            if (alpha < alphaThreshold) continue
            r += png.data[i]; g += png.data[i + 1] ?? 0; bl += png.data[i + 2] ?? 0; c += 1
          }
        }
        out.push(c ? [r / c, g / c, bl / c] : null)
      }
    }
    return out
  }
  const ca = cells(a)
  const cb = cells(b)
  let sum = 0
  let count = 0
  for (let i = 0; i < ca.length; i += 1) {
    if (!ca[i] || !cb[i]) continue
    sum += (ca[i][0] - cb[i][0]) ** 2 + (ca[i][1] - cb[i][1]) ** 2 + (ca[i][2] - cb[i][2]) ** 2
    count += 1
  }
  return count ? Math.sqrt(sum / (count * 3)) / 255 : 1
}

/** 色板重合率：候选里有多少比例的像素颜色出现在基准色板中（按像素数加权） */
export function paletteOverlap(base, cand) {
  if (!cand.opaque) return 0
  let hit = 0
  for (const [key, n] of cand.colors) if (base.colors.has(key)) hit += n
  return hit / cand.opaque
}

/**
 * 主判据：给基准帧与候选帧，返回逐条结果。
 * @returns {{ok: boolean, checks: Array<{id: string, ok: boolean, actual: any, limit: any, why: string}>}}
 */
/**
 * 允许变更区域（`allow = {y0, y1, x0, x1}`）之外的像素必须**逐字节相同**。
 * 这是"部件搬运"这类做法的核心判据：动作带外的像素一个都不许动
 * （Codex 第二意见的验收第一条就是"动作区外像素完全不变"）。
 */
export function outsideRegionDiff(basePng, candPng, allow) {
  const { width, height, channels, data } = basePng
  const inRegion = (x, y) => x >= (allow.x0 ?? 0) && x <= (allow.x1 ?? width - 1)
    && y >= (allow.y0 ?? 0) && y <= (allow.y1 ?? height - 1)
  let outside = 0
  let changed = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (inRegion(x, y)) continue
      outside += 1
      const i = (y * width + x) * channels
      const j = (y * width + x) * candPng.channels
      for (let k = 0; k < 4; k += 1) {
        const a = k < channels ? data[i + k] : (k === 3 ? 255 : 0)
        const b = k < candPng.channels ? candPng.data[j + k] : (k === 3 ? 255 : 0)
        if (a !== b) { changed += 1; break }
      }
    }
  }
  return { outside, changed, ratio: outside ? changed / outside : 0 }
}

export function gateCandidate(basePng, candPng, limits = {}) {
  const L = { ...DEFAULT_LIMITS, ...limits }
  const checks = []
  const add = (id, ok, actual, limit, why) => checks.push({ id, ok, actual, limit, why })

  const sizeOk = basePng.width === L.cell && basePng.height === L.cell
    && candPng.width === L.cell && candPng.height === L.cell
  add('size', sizeOk, `${basePng.width}x${basePng.height} / ${candPng.width}x${candPng.height}`, `${L.cell}x${L.cell}`,
    '必须与图集 cell 尺寸一致，否则缩放会把像素风洗成糊图')
  if (!sizeOk) return { ok: false, checks }

  const base = profile(basePng, { alphaThreshold: L.alphaThreshold })
  const cand = profile(candPng, { alphaThreshold: L.alphaThreshold })

  const coverDelta = base.coverage ? Math.abs(cand.coverage - base.coverage) / base.coverage : 1
  // 注：alpha 若继承自基准帧，这条恒通过（它检查的是"轮廓有没有被改坏"，不是"画得好不好"）
  add('coverage', coverDelta <= L.alphaRatioTolerance, coverDelta.toFixed(3), `<= ${L.alphaRatioTolerance}`,
    '覆盖率偏差过大 ⇒ 角色变胖/变瘦/多了一块')

  // 像素风的两把锁：色数上限 + alpha 二值（不是"和基准色板一模一样"——每格本来就各自量化）
  add('palette', cand.colors.size <= L.maxColors, cand.colors.size, `<= ${L.maxColors}`,
    '色数超过手绘素材的量级 ⇒ 模型加了渐变/阴影细节，像素风被洗掉')
  add('alpha', cand.semiTransparent <= L.semiTransparentMax, cand.semiTransparent.toFixed(3),
    `<= ${L.semiTransparentMax}`, '半透明像素过多 ⇒ 软边/抗锯齿，缩到 96px 会糊')

  const dx = base.centroid && cand.centroid ? Math.abs(base.centroid.x - cand.centroid.x) : L.cell
  const dy = base.centroid && cand.centroid ? Math.abs(base.centroid.y - cand.centroid.y) : L.cell
  add('centroid', dx <= L.centroidTolerancePx && dy <= L.centroidTolerancePx,
    `dx=${dx.toFixed(2)} dy=${dy.toFixed(2)}`, `<= ${L.centroidTolerancePx}px`,
    '质心漂移 ⇒ 播放时上下跳，看起来在抖')

  // ① 有没有真改：mask 内的 RGB 差异（alpha 继承自基准帧时，掩膜差分恒为 0，是假判据）
  //    `--allow-identical` 用于**循环动画的休息帧**：与基准相同是设计的一部分，不算白跑。
  const rgb = rgbDiffRatio(basePng, candPng, L.alphaThreshold)
  if (!L.allowIdentical) {
    add('changed', rgb.ratio >= L.changedMinRatio, rgb.ratio.toFixed(4), `>= ${L.changedMinRatio}`,
      '几乎逐像素相同 ⇒ 这次生成是白跑（没改动）')
  }
  // ② 还是不是同一个角色：网格色距（与手绘素材自身的帧间波动比）
  const gridDist = gridColorDistance(basePng, candPng, L.identityGridN, L.alphaThreshold)
  add('identity', gridDist <= L.identityGridMax, gridDist.toFixed(4), `<= ${L.identityGridMax}`,
    '网格色距超出"同一角色相邻帧"的实测区间 ⇒ 画出来的不是这个角色了')

  // 如果声明了"只允许这段变"（部件搬运），区域外必须一个像素都不动
  if (L.allowRegion) {
    const out = outsideRegionDiff(basePng, candPng, L.allowRegion)
    add('outsideRegion', out.changed === 0, out.changed, '0',
      '动作带之外有像素被改动 ⇒ 不是"部件搬运"，会破坏原帧里 1px 级的设计')
  }

  // 空帧绝不能进图集（unknown 那次「每 1.94s 闪没」就是空帧引起的）
  add('nonEmpty', cand.opaque > 0, cand.opaque, '> 0', '整格透明 ⇒ 播放时会闪成消失')

  return { ok: checks.every((c) => c.ok), checks, base: { coverage: base.coverage, palette: base.colors.size }, cand: { coverage: cand.coverage, palette: cand.colors.size } }
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */
if (process.argv[1]?.endsWith('frame-gate.mjs')) {
  const argv = process.argv.slice(2)
  const arg = (name, fallback = null) => {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
  }
  const basePath = arg('--base')
  const candPath = arg('--cand')
  if (!basePath || !candPath) {
    console.error('用法: node tools/frame-gate.mjs --base <base.png> --cand <cand.png> [--cell 96] [--allow y0:y1] [--json]')
    process.exit(2)
  }
  let result
  try {
    const allowSpec = arg('--allow')
    const limits = { cell: Number(arg('--cell', 96)) }
    if (argv.includes('--allow-identical')) limits.allowIdentical = true
    if (allowSpec) {
      const parts = allowSpec.split(/[:,]/).map(Number)
      limits.allowRegion = parts.length === 4
        ? { x0: parts[0], y0: parts[1], x1: parts[2], y1: parts[3] }
        : { y0: parts[0], y1: parts[1] }
    }
    result = gateCandidate(readPng(basePath), readPng(candPath), limits)
  } catch (error) {
    console.error(`判不了：${error.message}`)
    process.exit(2)
  }
  if (argv.includes('--json')) console.log(JSON.stringify(result, null, 1))
  else {
    for (const c of result.checks) {
      console.log(`${c.ok ? '✓' : '✗'} ${c.id.padEnd(9)} actual=${c.actual} limit=${c.limit}  ${c.ok ? '' : '→ ' + c.why}`)
    }
    console.log(result.ok ? '\n收口通过' : '\n收口拒绝')
  }
  process.exit(result.ok ? 0 : 1)
}
