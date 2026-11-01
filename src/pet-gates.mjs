/**
 * pet-gates.mjs — 两条"别让挂件太吵"的闸门（纯函数，可单测）。
 *
 * 为什么要闸门（2026-11-01）：状态跳变 → 一次性动作（happy / alert）在**数据面**是对的，
 * 但直接播出来会变成噪音。参照实现里有两条独立证据：
 *   · vorssaint `SustainedAlertGate`：单个采样证明不了什么——读数要在**不同采样**上持续
 *     12 秒才配弹通知，且重复读同一次不算（用 readAt 去重），低于阈值立即 reset。
 *   · vorssaint `NotchMascotReactionGate`：相邻反应要有间隔（spacing）、同一个反应在
 *     repeatInterval 内不复现。
 * 我们照结构不照数字：阈值按"台账是分钟级、挂件轮询是 60s"重推。
 *
 * 分工（重要，别混）：
 *   · **表情**只由事实决定（health=attention 就是 😟）——闸门不改事实；
 *   · **闸门只管一次性动作**（抬一下手/眨一下眼）。把它做成"改状态"就又回到"表情即谎报"。
 */

/** 一次性动作（会被闸门过滤）；区间事件（task.start 等）**永不**过滤，否则栈会失衡。 */
export const ONESHOT_EVENTS = new Set(['gate.fail', 'task.done', 'tool.error', 'attention.raise'])

/**
 * 这次 attention 配不配"弹一下"。
 *
 * @param {{health?: string, failingRuns?: number, sustainedMs?: number}|null} status
 *   pet-status 的合成结果。`sustainedMs` = 这次失败从最早那条连续失败算起**站了多久**。
 * @param {{holdMs?: number}} [opts] holdMs：至少要站这么久（默认 2 分钟）
 * @returns {boolean}
 */
export function admitsAlert(status, opts = {}) {
  if (!status || status.health !== 'attention') return false
  const holdMs = opts.holdMs ?? 120_000
  const ms = status.sustainedMs
  // 拿得到时长：站够 holdMs 才算"持续"（单次采样不足以下结论）
  if (Number.isFinite(ms)) return ms >= holdMs
  // 拿不到时长（老 payload / 字段缺失）：退化成"至少连续两条"，宁严不松
  return Number(status.failingRuns ?? 0) >= 2
}

/**
 * 反应闸门：相邻一次性动作要隔开，同一动作不能连着刷。
 * 数字是**我们的**（台账分钟级、轮询 60s），不是抄来的 2.5s/30s。
 */
export function createReactionGate({ spacingMs = 3_000, repeatMs = 60_000 } = {}) {
  let last = null
  // 冷却按**名字**记（不是只记最后一个）：参照实现只留最后一格，于是
  // happy → alert → happy 里第二个 happy 会被放行（"同一个动作连着刷"没被挡住）。
  // 我们的动作集很小（gate.fail / task.done），按名字记代价为零、语义更准。
  const lastByName = new Map()
  return {
    /**
     * @param {string} name 事件名
     * @param {number} atMs 发生时刻（由调用方注入，便于单测）
     * @returns {boolean} 是否放行（放行时会记住这次）
     */
    admits(name, atMs) {
      if (last && atMs - last.at < spacingMs) return false          // 相邻反应太近
      const same = lastByName.get(name)
      if (same != null && atMs - same < repeatMs) return false       // 同一个动作在冷却期
      last = { name, at: atMs }
      lastByName.set(name, atMs)
      return true
    },
    /** 会话切换/重连后清空，避免被上一轮的记忆卡住。 */
    reset() { last = null; lastByName.clear() },
    peek: () => last,
  }
}

/**
 * 把 eventsFor 的输出过一遍闸门。
 *
 * 顺序纪律：**区间事件原样放行**（漏掉一条 task.end 会让状态栈再也弹不回去），
 * 只有一次性动作可能被丢弃。
 *
 * @param {string[]} events
 * @param {{reaction?: object, status?: object|null, nowMs?: number, holdMs?: number}} [opts]
 */
export function gateEvents(events, opts = {}) {
  const { reaction, status, nowMs = Date.now(), holdMs } = opts
  const out = []
  for (const ev of events) {
    if (!ONESHOT_EVENTS.has(ev)) { out.push(ev); continue }
    if (ev === 'gate.fail' && !admitsAlert(status, { holdMs })) continue
    if (reaction && !reaction.admits(ev, nowMs)) continue
    out.push(ev)
  }
  return out
}
