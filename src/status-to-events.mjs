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
 * 久坐检测：没有任何状态变化超过 idleMs ⇒ 困了；有变化 ⇒ 立刻叫醒。
 * 拆成纯函数是为了能单测（时间由调用方注入，不读 Date.now）。
 */
export function idleEvent({ lastChangeAt, now, idleMs, asleep }) {
  const idle = now - lastChangeAt
  if (!asleep && idle >= idleMs) return 'idle.sleep'
  if (asleep && idle < idleMs) return 'idle.wake'
  return null
}
