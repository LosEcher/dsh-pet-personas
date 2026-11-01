/**
 * status-to-events.mjs — 把 pet-status 的**状态跳变**翻译成播放器事件。
 *
 * 纪律（都是踩过的）：
 *   · 一次性动作只在**真跳变**时触发；每次轮询都触发 ⇒ 宠物永远在抽搐。
 *   · `unknown` 不是"出事了"：不产生 alert，也不产生 happy。
 *   · 忙→闲 既是"任务结束"（收区间）也是"干完了"（放一次 happy），两个事件要一起发。
 *   · `unknown` 是**持续状态**而不是一次性动作：进入时压一层 `status.unknown` 区间、
 *     离开时收起。少了这一层，health=unknown 不产生任何事件 ⇒ 播放器停在 idle，
 *     等于把"我看不清"画成"睁眼在岗"（表情即谎报）。atlas 里的 unknown 行就是给它用的。
 */
const judged = (health) => health === 'ok' || health === 'attention'

export function eventsFor(prev, next) {
  if (!next) return []
  const p = prev || {}
  const out = []
  const prevBusy = p.activity === 'busy'
  const nextBusy = next.activity === 'busy'
  const prevAttention = p.health === 'attention'
  const nextAttention = next.health === 'attention'
  // "判得清"只有 ok / attention 两种。**next** 缺字段、'unknown'、任何别的值 ⇒ 就是判不了。
  // **prev** 要三分：有判定 / 判定是 unknown / 根本没有上一次观察（首次挂载或旧调用方只给了部分字段）
  // ——第三类不能算"刚才在 unknown 里"，否则首次收到正常状态会凭空发一条 status.known。
  const prevJudged = !prev || p.health == null ? null : judged(p.health)
  const nextUnknown = !judged(next.health)
  const prevUnknown = prevJudged === false
  const enteringUnknown = nextUnknown && prevJudged !== false
  const leavingUnknown = prevUnknown && !nextUnknown

  // 离开 unknown 先把区间收掉，后面开的新区间才叠得对（close 先于 open）
  if (leavingUnknown) out.push('status.known')

  if (nextBusy && !prevBusy) out.push('task.start')
  if (!nextBusy && prevBusy) {
    out.push('task.end')
    // 干完一件活：happy 只在"从忙到闲且结果不是出事"时放；判不了时不庆祝
    if (!nextAttention && !nextUnknown) out.push('task.done')
  }
  if (nextAttention && !prevAttention) out.push('gate.fail')
  // 出事恢复到正常：也值得高兴一下（只在 attention→ok 的真跳变）
  if (!nextAttention && prevAttention && next.health === 'ok') out.push('task.done')

  if (enteringUnknown) out.push('status.unknown')
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

/**
 * 过期阈值**必须跟服务端一致**（2026-11-01 实际故障）：服务端 `pet-status` 的 `ttlH` 是 36 小时，
 * 客户端却硬编码 6 小时 ⇒ 同一份数据在两边得到相反的结论：服务端说 `ok`，挂件说"数据太旧了"。
 * 现在统一由 payload 的 `ttlH` 决定（缺省才回退 STALE_MS），并从 payload 里取。
 */
export function staleMsFromTtl(ttlH, fallbackMs = STALE_MS) {
  const h = Number(ttlH)
  return Number.isFinite(h) && h > 0 ? h * 3600_000 : fallbackMs
}

/** 把毫秒年龄说成人话（V1：新鲜度渲染成词，不渲染裸时间戳；也不要把 UTC 时钟当本地时间展示）。 */
export function ageWords(ageMs) {
  const ms = Math.max(0, Number(ageMs) || 0)
  const min = Math.round(ms / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hours = Math.round(min / 60)
  if (hours < 48) return `${hours} 小时前`
  return `${Math.round(hours / 24)} 天前`
}

/**
 * 「判不了」的原因 → 一句人话 + 下一步。原因来自服务端 `healthReason`，不是猜的。
 * 为什么必须分开（2026-11-01 用户反馈）：所有 unknown 都只说"我看不清"，用户不知道
 * 是"数据旧"、"从没跑过"、"台账坏了"还是"桥读不到" —— 而这四种该做的事完全不同。
 */
export function unknownReason(reason) {
  const r = String(reason ?? '')
  if (r.startsWith('stale(')) return { id: 'stale', hint: '门禁大概没跑，去看一眼' }
  if (r === 'no-ledger') return { id: 'no-ledger', hint: '它还没跑过一次' }
  if (r === 'bad-timestamp') return { id: 'bad-timestamp', hint: '台账里有一行时间看不懂' }
  if (r.startsWith('bad-exit')) return { id: 'bad-exit', hint: '台账里有个没见过的退出码' }
  if (r === 'route-read-failed') return { id: 'route-unreadable', hint: '是我这边读不到，不是世界坏了' }
  if (r === 'missing-persona' || r === 'no-atlas') return { id: 'no-art', hint: '素材没装上' }
  return { id: 'unknown', hint: '' }
}

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
