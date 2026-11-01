/**
 * pet-voice.mjs — 宠物**怎么说话**（语气层）。
 *
 * 与"说什么"分开：事实结论只来自 pet-status 的 `display.text`（数字、结论都在那里），
 * 这里只做三件事：① 换成宠物的口吻；② 在事实**已经存在**的时候把事实说具体；③ 同状态多句轮换，
 * 免得每 30 秒重复同一句。
 *
 * 三条纪律（改文案前先读，违反其一就是"表情即谎报"的近亲）：
 *   · **不编事实**：句子里出现的数字/工具名/会话数，必须来自传入的 facts；
 *     传进来没有的维度一律用模糊词，不许猜一个填上。
 *   · **unknown 不许安慰**：判不了就说判不了，不许出现"应该没事 / 大概好的"。
 *   · **轮换靠 seq 不靠随机**：可断言、可复现（测试里给定 seq 就得到确定的句子）。
 *
 * 风格（persona）与语气（tone）都在这一层，不动状态机：
 *   persona 决定"是谁在说"（用词习惯），tone 决定"多克制"（plain 只报事实，playful 允许俏皮）。
 */

/** persona → 语气档（同一句事实，两个形象说法不同） */
export const PERSONA_STYLE = {
  'mermaid-maid': { name: '女仆', openers: ['主人，', '', ''], tail: ['', '（认真）', ''] },
  'whale-maid': { name: '鲸鱼', openers: ['', '嗯——', ''], tail: ['', '…', ''] },
}

export const TONES = ['auto', 'plain', 'playful']

/** 事实 → 一句"具体"的补充（只在对应事实存在时才产出） */
function factClause(facts = {}) {
  const parts = []
  const tools = Array.isArray(facts.tools) ? facts.tools.filter(Boolean) : []
  if (facts.state === 'busy') {
    if (tools.length) parts.push(`手上是 ${tools.slice(0, 2).join('、')}`)
    else if (Number(facts.runningSessions) > 0) parts.push(`${Number(facts.runningSessions)} 个会话在跑`)
  }
  if (facts.state === 'alert') {
    const runs = Number(facts.failingRuns)
    if (Number.isFinite(runs) && runs > 1) parts.push(`连着 ${runs} 次没过`)
    const mins = Number(facts.sustainedMs) >= 60_000 ? Math.round(Number(facts.sustainedMs) / 60_000) : null
    if (mins) parts.push(`${mins} 分钟了`)
    if (facts.approvalPending) parts.push('有个审批等你')
  }
  if (facts.state === 'happy' && Number(facts.runningSessions) === 0) parts.push('这会儿没人排队')
  if (facts.state === 'sleep' && facts.night) parts.push('夜里的活我盯着')
  return parts.length ? parts.join('，') : ''
}

/**
 * 每个 persona × 状态的一组候选句。
 * `{f}` = 事实补充位（没有事实时整段连引导词一起去掉，不能留下"手上是 "这种空壳）。
 */
const LINES = {
  'mermaid-maid': {
    idle: ['在的。', '有事叫我。', '我守着。'],
    busy: ['正在跑，{f}。', '还在跑，{f}。', '跑着呢，别急。'],
    alert: ['这个要你看一眼：{f}。', '有条不太对：{f}。', '过来看一下：{f}。'],
    sleep: ['先眯一会儿。', '有点困…', 'Zzz'],
    happy: ['搞定。', '成了，{f}。', '这件做完了。'],
    unknown: ['我看不清，别信我瞎猜。', '读不到状态，先别指望我。', '这会儿判不了。'],
  },
  'whale-maid': {
    idle: ['嗯，在。', '有事喊我。', '水里守着。'],
    busy: ['忙着呢，{f}。', '在跑，{f}。', '没停。'],
    alert: ['有点不对：{f}。', '看一眼吧：{f}。', '这里怪怪的。'],
    sleep: ['困…', '眯了。', 'Zzz'],
    happy: ['成了。', '收工，{f}。', '搞定了。'],
    unknown: ['看不见，别问我。', '瞎了，判不了。', '不知道，不敢说。'],
  },
}

/**
 * 「判不了」按**原因**分支（2026-11-01 用户反馈：所有 unknown 都说"我看不清"，看不出该做什么）。
 * 原因 id 来自 `status-to-events.unknownReason()`；没给原因才用兜底那组。
 * 每一组都遵守老纪律：不安慰、不猜、把"是谁的问题"说清楚（数据旧 / 台账坏 / 我读不到）。
 */
export const UNKNOWN_LINES = {
  stale: [
    '数据还是{age}的，门禁大概没跑。',
    '我手上这堆是{age}的，早就不能当真了。',
    '最后一次是{age}，之后没人喂我。',
  ],
  'no-ledger': [
    '它还没跑过一次，我什么都不知道。',
    '台账是空的，这不算好消息。',
  ],
  'bad-timestamp': [
    '台账里有一行时间看不懂，我跳过了。',
    '有一行记录的时间是坏的，判不了。',
  ],
  'bad-exit': [
    '台账里有个没见过的退出码，我不敢当好事。',
    '有行记录的退出码不认识，判不了。',
  ],
  'route-unreadable': [
    '是我这边读不到，不是世界坏了。',
    '桥断了，我暂时看不见。',
  ],
  'no-art': [
    '素材没装上，我连自己都画不出来。',
  ],
  unknown: [
    '我看不清，别信我瞎猜。',
    '读不到状态，先别指望我。',
    '这会儿判不了。',
  ],
}

const PLAIN = {
  idle: '没有待办。',
  busy: '有任务在跑。',
  alert: '需要你看一眼。',
  sleep: '夜里，我盯着。',
  happy: '刚完成一件。',
  unknown: '状态读不到。',
}

/** 把带 `{f}` 的模板按事实落地；没有事实就把括号整段去掉（不留空壳）。 */
function fill(template, clause) {
  if (!clause) return template.replace(/[，：]\{f\}|（\{f\}）|\{f\}/g, '').trim()
  return template.replace(/\{f\}/g, clause)
}

/**
 * @param {object} input
 * @param {string} input.state  idle|busy|alert|sleep|happy|unknown
 * @param {number} [input.seq]  轮换序号（同一状态多次调用递增；确定性，不用随机）
 * @param {string} [input.persona]
 * @param {'auto'|'plain'|'playful'} [input.tone]
 * @param {object} [input.facts] { tools, runningSessions, failingRuns, sustainedMs, approvalPending, night }
 */
/**
 * unknown 专用：按原因选句子，并把年龄塞进去（`{age}` 用 ageWords 的词，不塞裸时间戳）。
 * @param {{reasonId?: string, ageMs?: number, seq?: number, persona?: string, tone?: string}} input
 */
export function unknownLine(input = {}) {
  const reasonId = UNKNOWN_LINES[input.reasonId] ? input.reasonId : 'unknown'
  if (input.tone === 'plain') return PLAIN.unknown
  const lines = UNKNOWN_LINES[reasonId]
  const seq = Math.abs(Math.trunc(Number(input.seq) || 0))
  const template = lines[seq % lines.length]
  const age = ageWordsLocal(Number(input.ageMs) || 0)
  return template.replace(/\{age\}/g, age)
}

/** 本地实现，避免为了一个词表把 status-to-events 也拖进来（voice 只依赖纯文本） */
function ageWordsLocal(ms) {
  const min = Math.round(Math.max(0, ms) / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hours = Math.round(min / 60)
  if (hours < 48) return `${hours} 小时前`
  return `${Math.round(hours / 24)} 天前`
}

export function lineFor(input = {}, seqArg) {
  // 兼容旧签名 lineFor(state, seq)：老调用方（生成的 client 副本）传字符串时轮换仍生效。
  const arg = typeof input === 'string' ? { state: input, seq: seqArg } : input
  const state = LINES['mermaid-maid'][arg.state] ? arg.state : 'unknown'
  const inputState = arg
  const tone = TONES.includes(inputState.tone) ? inputState.tone : 'auto'
  // plain：只报事实，不带形象口吻（给"别演"的人）
  if (tone === 'plain') return PLAIN[state]
  // unknown 且给了原因 ⇒ 用按原因分的句子（比"我看不清"有用得多）
  if (state === 'unknown' && inputState.facts?.reasonId) {
    return unknownLine({
      reasonId: inputState.facts.reasonId,
      ageMs: inputState.facts.ageMs,
      seq: inputState.seq,
      tone,
    })
  }
  const persona = LINES[inputState.persona] ? inputState.persona : 'mermaid-maid'
  const lines = LINES[persona][state]
  const seq = Math.abs(Math.trunc(Number(inputState.seq) || 0))
  const template = lines[seq % lines.length]
  const clause = factClause({ ...inputState.facts, state })
  const text = fill(template, clause)
  if (tone !== 'playful') return text
  const style = PERSONA_STYLE[persona]
  return `${style.openers[seq % style.openers.length]}${text}`
}
