/**
 * status-to-events.mjs — 把 pet-status 的**状态跳变**翻译成播放器事件。
 *
 * 纪律（都是踩过的）：
 *   · 一次性动作只在**真跳变**时触发；每次轮询都触发 ⇒ 宠物永远在抽搐。
 *   · `unknown` 不是"出事了"：不产生 alert，也不产生 happy。
 *   · 忙→闲 既是"任务结束"（收区间）也是"干完了"（放一次 happy），两个事件要一起发。
 */
export function eventsFor(prev, next) {
  if (!next) return []
  const p = prev || {}
  const out = []
  const prevBusy = p.activity === 'busy'
  const nextBusy = next.activity === 'busy'
  const prevAttention = p.health === 'attention'
  const nextAttention = next.health === 'attention'

  if (nextBusy && !prevBusy) out.push('task.start')
  if (!nextBusy && prevBusy) {
    out.push('task.end')
    // 干完一件活：happy 只在"从忙到闲且结果不是出事"时放
    if (!nextAttention) out.push('task.done')
  }
  if (nextAttention && !prevAttention) out.push('gate.fail')
  // 出事恢复到正常：也值得高兴一下（只在 attention→ok 的真跳变）
  if (!nextAttention && prevAttention && next.health === 'ok') out.push('task.done')
  return out
}

/**
 * 数据新鲜度 → 能不能当成"还活着"来画。
 *
 * 为什么这算显示不变量而不是口味：pet-status 的 `asOf` 是**源数据的时间**，
 * 不是拿到它的时间。一个 12 小时前的"世界还好"，画成睁眼的 idle 就是在骗人——
 * 与网页上"新鲜度渲染成词"（V1）是同一条纪律，只是在挂件上表现为**表情**。
 *
 * 判据（不可判也要说清）：
 *   · asOf 缺失/解析不了 ⇒ 视为 stale（判不了不是好消息）；
 *   · now - asOf > staleMs ⇒ stale；
 *   · 未来时间（时钟回拨）⇒ 不算 stale（不能因为时钟错就把一切判死），但夹到 0 差值。
 */
export const STALE_MS = 6 * 3600_000

export function isStale(asOf, now, staleMs = STALE_MS) {
  if (!asOf) return true
  const t = typeof asOf === 'number' ? asOf : Date.parse(String(asOf))
  if (!Number.isFinite(t)) return true
  const age = Math.max(0, now - t)
  return age > staleMs
}

/**
 * 夜间节律：23:00–07:00（本地时区）且没有异常 ⇒ 该睡。
 * 只在 health 正常时才成立；attention 就是 attention，不能因为到点而"睡过去"。
 */
export function inNightWindow(nowMs, { start = 23, end = 7 } = {}) {
  const hour = new Date(nowMs).getHours()
  return start > end ? (hour >= start || hour < end) : (hour >= start && hour < end)
}

/**
 * 久坐检测：没有任何状态变化超过 idleMs ⇒ 困了；有变化 ⇒ 立刻叫醒。
 * 拆成纯函数是为了能单测（时间由调用方注入，不读 Date.now）。
 */
export function idleEvent({ lastChangeAt, now, idleMs, asleep }) {
  const idle = now - lastChangeAt
  if (!asleep && idle >= idleMs) return 'idle.sleep'
  if (asleep && idle < idleMs) return 'idle.wake'
  return null
}
