/**
 * pet-prefs.mjs — 挂件偏好的**唯一读写口**（persona / 尺寸 / 久坐阈值 / 文案开关 / 位置）。
 *
 * 为什么纯函数 + 注入 storage：这些偏好要在两个宿主（web GUI 与 dsh-os）里都可用，
 * 又必须能在 node 里单测 —— 所以不直接摸 `localStorage`，由调用方传进来。
 *
 * 三条纪律：
 *   · **读要容错**：损坏/旧版本/被别的键污染一律回落默认，不抛（挂件不该因为一个脏值白屏）。
 *   · **写要收敛**：只写白名单键，值一律 clamp（尺寸/阈值），避免手改 localStorage 造出 500px 的宠物。
 *   · 版本号进存储：将来改结构时能识别"这是旧值"，而不是把旧值当新值误读。
 */
export const PREFS_KEY = 'os-seams.pet.prefs.v1'

export const DEFAULT_PREFS = Object.freeze({
  persona: 'mermaid-maid',
  size: 48, // CSS px（Retina 上 96 设备像素，见 DESIGN-VI §8）
  idleMs: 90_000, // 多久没动静算困了
  voice: true, // 气泡用宠物口吻（关掉就只显示服务端事实）
  corner: 'br', // tl / tr / bl / br
  offset: null, // 拖动后的自定义位置 { x, y }（相对视口右下为基准，见 clampOffset）
})

const PERSONAS = ['mermaid-maid', 'whale-maid']
const SIZES = [40, 48, 56, 64]
const IDLE = [30_000, 60_000, 90_000, 180_000, 600_000]
const CORNERS = ['tl', 'tr', 'bl', 'br']

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback)
/**
 * 档位量的两种脏值要分开处理（混着做会产生"手改坏了却悄悄变成别的值"）：
 *   · **非法/越界**（非数字、NaN、< min、> max）⇒ 回默认，让人一眼看出"没生效"；
 *   · **合法但不在档位上**（比如手写 50）⇒ 取最近的一档（50→48），不打断。
 */
const pickInRange = (value, allowed, min, max, fallback) => {
  const n = Number(value)
  if (!Number.isFinite(n) || n < min || n > max) return fallback
  return allowed.reduce((best, v) => (Math.abs(v - n) < Math.abs(best - n) ? v : best), allowed[0])
}
const clampNum = (v, min, max, fallback) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** 任意输入 → 合法偏好。未知 persona 不当作"就用它"，而是回默认（避免空形象）。 */
export function normalize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const offset = src.offset && typeof src.offset === 'object'
    ? { x: clampNum(src.offset.x, -4000, 4000, 0), y: clampNum(src.offset.y, -4000, 4000, 0) }
    : null
  return {
    persona: pick(src.persona, PERSONAS, DEFAULT_PREFS.persona),
    size: pickInRange(src.size, SIZES, 32, 96, DEFAULT_PREFS.size),
    idleMs: pickInRange(src.idleMs, IDLE, 15_000, 3_600_000, DEFAULT_PREFS.idleMs),
    voice: typeof src.voice === 'boolean' ? src.voice : DEFAULT_PREFS.voice,
    corner: pick(src.corner, CORNERS, DEFAULT_PREFS.corner),
    offset,
  }
}

/** 读：storage 可以是 null（SSR/无 window），JSON 坏了也回落默认。 */
export function loadPrefs(storage) {
  if (!storage || typeof storage.getItem !== 'function') return { ...DEFAULT_PREFS }
  try {
    return normalize(JSON.parse(storage.getItem(PREFS_KEY) ?? 'null'))
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

/** 写：只写规范化后的值；storage 不可写（隐私模式/配额满）静默失败但返回是否成功。 */
export function savePrefs(storage, prefs) {
  if (!storage || typeof storage.setItem !== 'function') return false
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(normalize(prefs)))
    return true
  } catch {
    return false
  }
}

/**
 * 拖动后的位置：存成"相对某角的偏移"，这样窗口尺寸变化时不会飞到屏幕外。
 * 返回**落点坐标**（左上角），调用方直接用作 style.left/top。
 */
export function resolvePosition({ corner, offset, viewport, size, margin = 16 }) {
  const { w, h } = viewport
  const base = {
    tl: { x: margin, y: margin },
    tr: { x: w - size - margin, y: margin },
    bl: { x: margin, y: h - size - margin },
    br: { x: w - size - margin, y: h - size - margin },
  }[corner] ?? { x: w - size - margin, y: h - size - margin }
  if (!offset) return { x: Math.max(0, base.x), y: Math.max(0, base.y) }
  return {
    x: Math.min(Math.max(0, base.x + offset.x), Math.max(0, w - size)),
    y: Math.min(Math.max(0, base.y + offset.y), Math.max(0, h - size)),
  }
}
