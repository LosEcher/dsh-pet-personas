/**
 * sprite-player.mjs — 纯函数式的**图集播放器**（无 DOM、无定时器，可单测）。
 *
 * 这不是我自己发明的结构：它照着公开实现的语义搬过来的（2026-11-01 调研）：
 *   · **pet4claude**（codeberg xchacha20-poly1305/pet4claude 的 `pet_daemon.py`）用的是三层状态机，
 *     优先级 `drag_state > oneshot_state > base_stack[-1]`，其中 `base_stack` 是**循环区间的栈**：
 *     事件 push 一段区间、结束事件 pop 掉匹配的顶部项，栈底永远是 `(None,'idle')` 且**永不弹出**；
 *     oneshot 是一次性覆盖（waving/jumping/failed），放完自动回落到 `base_stack[-1]`。
 *   · **每帧时长不同**（`durations[]` 逐帧），而不是统一帧率——慢动作就该慢。
 *   · **oneko.js** 补的三条工程细节：`prefers-reduced-motion` 直接不启动、`image-rendering: pixelated`、
 *     元素 `aria-hidden` + `pointer-events:none`（宠物不该抢焦点/挡点击）。
 *
 * 为什么值得抄这个结构：我们的三维状态（health/activity/approval）原本是**平铺**映射到 class，
 * 一遇到"任务跑着 → 出错了 → 任务结束"这种**嵌套 + 瞬时**的组合就表达不了：
 * 平铺只能描述"现在是什么"，栈能描述"现在叠了什么、什么时候退回去"。
 */

export const DEFAULT_TABLES = {
  /** 事件 → 压入的循环区间名 */
  open: {
    'session.start': 'busy',
    'tool.start': 'busy',
    'task.start': 'busy',
  },
  /**
   * 事件 → 它要关掉**哪些 opener 开的**区间（对照 opener 事件名，不是状态名）。
   * 这一点照 pet4claude 的 `INTERVAL_CLOSE`（值是 opener 集合）：从栈顶向下弹，
   * 遇到第一个不匹配就停 —— 这样"task 里嵌 tool"能按栈序退，不会把外层一起收掉。
   */
  close: {
    // session.end = 整场结束，可以把下面几层一起收掉；tool.end/task.end 只收自己那层
    'session.end': ['session.start', 'tool.start', 'task.start'],
    'tool.end': ['tool.start'],
    'task.end': ['task.start'],
  },
  /** 事件 → 放一次就回落的瞬时动作 */
  oneshot: {
    'gate.fail': 'alert',
    'tool.error': 'alert',
    'attention.raise': 'alert',
  },
}

export function createPlayer(opts = {}) {
  const tables = opts.tables ?? DEFAULT_TABLES
  const reducedMotion = Boolean(opts.reducedMotion)
  const states = opts.states // 形如 atlas.json 的 states（提供 row 与 durations）

  let base = [{ opener: null, state: 'idle' }]
  let oneshot = null
  let drag = null
  let frame = 0
  let elapsed = 0

  const activeState = () => {
    if (drag) return drag
    if (oneshot) return oneshot
    return base[base.length - 1].state
  }

  const spec = (state) => (states && states[state]) || { row: 0, durations: [1000] }

  function applyEvent(name) {
    if (!name || (!(name in tables.open) && !(name in tables.close) && !(name in tables.oneshot))) {
      return false // 未知事件忽略（不要静默当成 idle 事件处理）
    }
    // 先关后开：一个事件可以既关掉外层区间又开自己的
    const closers = tables.close[name]
    if (closers) {
      while (base.length > 1 && closers.includes(base[base.length - 1].opener)) base.pop()
    }
    const opener = tables.open[name]
    if (opener) base.push({ opener: name, state: opener })
    const flash = tables.oneshot[name]
    if (flash) { oneshot = flash; frame = 0; elapsed = 0 }
    return true
  }

  function beginDrag(direction) {
    drag = direction === 'right' ? 'busy' : 'busy' // 当前只有 busy 一行可借；方向留给以后加行
    frame = 0
  }

  function endDrag() {
    drag = null
    frame = 0
    elapsed = 0
  }

  /** 推进时间；返回当前该画哪一格 */
  function tick(deltaMs) {
    const state = activeState()
    const { durations } = spec(state)
    if (reducedMotion) return snapshot(state, 0)
    elapsed += Math.max(0, deltaMs)
    let guard = 0
    while (elapsed >= durations[Math.min(frame, durations.length - 1)] && guard < 1000) {
      elapsed -= durations[Math.min(frame, durations.length - 1)]
      const n = activeState()
      const d = spec(n).durations
      frame = (frame + 1) % d.length
      if (frame === 0 && oneshot) {
        oneshot = null // 一次性动作放完一轮 ⇒ 回落
        break
      }
      guard += 1
    }
    return snapshot(activeState(), frame)
  }

  function snapshot(state = activeState(), f = frame) {
    const s = spec(state)
    const durs = s.durations
    return {
      state,
      row: s.row,
      col: Math.min(f, durs.length - 1),
      durationMs: durs[Math.min(f, durs.length - 1)],
      baseDepth: base.length,
      oneshot,
      drag,
    }
  }

  return { applyEvent, beginDrag, endDrag, tick, snapshot, baseDepth: () => base.length }
}
