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
    // 长时间没动静 ⇒ 压一层 sleep 区间（收摊时会被 idle.wake 收掉）
    'idle.sleep': 'sleep',
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
    // 任何活动都先叫醒：sleep 是"最软"的一层，醒了就退回去
    'idle.wake': ['idle.sleep', 'task.start', 'tool.start', 'session.start'],
  },
  /** 事件 → 放一次就回落的瞬时动作 */
  oneshot: {
    'gate.fail': 'alert',
    'tool.error': 'alert',
    'attention.raise': 'alert',
    // 干完一件活：放一次 happy（帧来自 atlas 的 happy 行），放完回落
    'task.done': 'happy',
  },
  /**
   * 事件 → **压过区间栈顶、但压不过一次性动作**的常驻覆盖（null = 清掉）。
   *
   * 为什么 `unknown` 必须是覆盖而不是又一层区间（2026-11-01 实测踩到）：
   * 区间是嵌套的——"判不了"时如果开了 busy/tool 区间，unknown 就被压在下面；
   * 等判得清时 close 只弹栈顶，unknown 永远弹不掉（它上面还有一层），宠物就卡在
   * "判不了"直到那个区间自己结束。覆盖层没有这个问题：进/出都只改一个字段。
   */
  sticky: {
    'status.unknown': 'unknown',
    'status.known': null,
  },
}

/**
 * 状态图自检（纯数据，可在 node 里跑）。
 *
 * 为什么需要：表格是数据，**写错不会报错，只会画错**。本轮就抓到一例——atlas 里
 * 备好了 `unknown` 行，但表里没有任何事件能进入它，于是"判不了"画成 idle。
 * 所以把「表引用的 state 必须在图集里」「每个 opener 必须有 closer」变成可断言的检查，
 * 换 persona / 换图集后重跑即可（`test/state-graph.test.mjs`）。
 *
 * @returns {string[]} 问题清单；空数组表示通过
 */
export function validateTables(tables = DEFAULT_TABLES, states = {}) {
  const problems = []
  const hasStates = states && Object.keys(states).length > 0
  const referenced = new Set()

  for (const [event, state] of Object.entries(tables.open ?? {})) {
    referenced.add(state)
    if (hasStates && !states[state]) problems.push(`open ${event} → 图集缺 state "${state}"`)
  }
  for (const [event, state] of Object.entries(tables.oneshot ?? {})) {
    referenced.add(state)
    if (hasStates && !states[state]) problems.push(`oneshot ${event} → 图集缺 state "${state}"`)
  }
  const stickyEntries = Object.entries(tables.sticky ?? {})
  let hasStickyClear = false
  for (const [event, state] of stickyEntries) {
    if (state === null || state === undefined) { hasStickyClear = true; continue }
    referenced.add(state)
    if (hasStates && !states[state]) problems.push(`sticky ${event} → 图集缺 state "${state}"`)
  }
  if (stickyEntries.length && !hasStickyClear) {
    problems.push('sticky 里没有清空入口（一旦进入就永远退不出来）')
  }
  const openers = Object.keys(tables.open ?? {})
  const closers = new Set(Object.values(tables.close ?? {}).flat())
  for (const opener of openers) {
    if (!closers.has(opener)) problems.push(`open ${opener} 没有任何 close 收它（区间会永久压栈）`)
  }
  for (const closer of closers) {
    if (!openers.includes(closer)) problems.push(`close 引用了不存在的 opener "${closer}"（拼错？）`)
  }
  return problems
}

export function createPlayer(opts = {}) {
  const tables = opts.tables ?? DEFAULT_TABLES
  const reducedMotion = Boolean(opts.reducedMotion)
  const states = opts.states // 形如 atlas.json 的 states（提供 row 与 durations）
  const onMissingState = opts.onMissingState // (state) => spec | undefined；不传则直接抛错
  const missing = new Set()

  let base = [{ opener: null, state: 'idle' }]
  let oneshot = null
  let drag = null
  let sticky = null // 常驻覆盖（例如"判不了"）：压过区间栈顶，压不过一次性动作
  let frame = 0
  let elapsed = 0

  const activeState = () => {
    if (drag) return drag
    if (oneshot) return oneshot
    if (sticky) return sticky
    return base[base.length - 1].state
  }

  /**
   * 取某 state 的行与逐帧时长。
   *
   * 没有图集（纯逻辑测试）时给中性默认值；**有图集就必须能在里面找到**，
   * 否则记进 `missing` 并交给 onMissingState 决定——不传钩子直接抛错。
   * 之前这里是 `states[state] || {row:0,...}`：换 persona 后 state 对不上会
   * **静默画第 0 行**，也就是"动画放错行"从错误变成沉默。
   */
  const spec = (state) => {
    const found = states && states[state]
    if (found && Array.isArray(found.durations) && found.durations.length) return found
    if (!states) return { row: 0, durations: [1000] }
    missing.add(state)
    const fallback = onMissingState ? onMissingState(state) : null
    if (fallback && Array.isArray(fallback.durations) && fallback.durations.length) return fallback
    throw new Error(
      `sprite-player: state "${state}" 不在图集里（可用：${Object.keys(states).join('/')}）`,
    )
  }

  function applyEvent(name) {
    if (!name || (!(name in tables.open) && !(name in tables.close) && !(name in tables.oneshot) && !(name in (tables.sticky ?? {})))) {
      return false // 未知事件忽略（不要静默当成 idle 事件处理）
    }
    // 先关后开：一个事件可以既关掉外层区间又开自己的
    const closers = tables.close[name]
    if (closers) {
      while (base.length > 1 && closers.includes(base[base.length - 1].opener)) base.pop()
    }
    // 常驻覆盖：进/出都只改一个字段（不会像区间那样被后来开的层压住）
    if (name in (tables.sticky ?? {})) {
      sticky = tables.sticky[name] ?? null
      frame = 0
      elapsed = 0
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
      sticky,
      // 图集里找不到的 state（有钩子时走回退行）。空数组 = 本次运行没缺过东西。
      // 消费者可以据此在 DOM 上留痕（`data-sprite-missing`），别让"画错行"只活在控制台。
      missingStates: [...missing],
    }
  }

  return { applyEvent, beginDrag, endDrag, tick, snapshot, baseDepth: () => base.length }
}
