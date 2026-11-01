/**
 * avatar-state.mjs — 形象 ↔ 状态的**唯一映射**（纯函数，可在 node 里单测）。
 *
 * 设计约束（与母仓 DESKTOP-PET-SUPERAGENT-WIRING §3 同源）：
 *   1. 输入只有**已判定的事实**：health ∈ ok|attention|unknown、activity ∈ busy|idle|unknown、
 *      approval ∈ pending|none|unknown。这里不猜、不推导、不读文件。
 *   2. 任一维度 unknown ⇒ 表情不得是"开心/正常"，只能是「疑惑/看不清」。
 *      （"表情即谎报"是这类挂件最典型的翻车方式。）
 *   3. 交互只改变**表现**，不改变事实：hover/click 改变姿势与气泡，但 `pose.health` 保持原值，
 *      所以"点一下变高兴"不会污染状态判断。
 *   4. `reduceMotion` 一律关闭位移动画（只保留表情），这是 a11y 的硬要求。
 */

export const PERSONAS = [
  // 通用原型（无第三方权利）
  'cat', 'dog', 'clip', 'lion', 'chibi',
  // 参考图复刻的"AI 女仆"设定形象（用户确认：AI 生成、可自由使用）
  'whale-maid', 'gpt-maid', 'gemini-maid', 'glm-maid', 'claude-maid', 'qwen-maid', 'grok-maid',
]

const HEALTH_FACE = { ok: 'happy', attention: 'worry', unknown: 'confused' }
const ACTIVITY_POSE = { busy: 'work', idle: 'rest', unknown: 'idle-wait' }
const APPROVAL_MARK = { pending: 'exclaim', none: null, unknown: null }

/**
 * @param {{health?: string, activity?: string, approval?: string}} status
 * @param {{hover?: boolean, click?: boolean, typing?: boolean, reduceMotion?: boolean, persona?: string}} [interaction]
 */
export function deriveAvatar(status = {}, interaction = {}) {
  const health = ['ok', 'attention', 'unknown'].includes(status.health) ? status.health : 'unknown'
  const activity = ['busy', 'idle', 'unknown'].includes(status.activity) ? status.activity : 'unknown'
  const approval = ['pending', 'none', 'unknown'].includes(status.approval) ? status.approval : 'unknown'

  const persona = PERSONAS.includes(interaction.persona) ? interaction.persona : 'cat'

  // 表情：unknown 永远压过 happy（负向控制的核心）
  let face = HEALTH_FACE[health]
  let bubble = null
  if (interaction.click) {
    // 点击只是"理你一下"，不改变 health 判定
    bubble = health === 'unknown' ? '我看不清，别信我瞎猜。' : '在的，有事说。'
    face = health === 'unknown' ? 'confused' : 'happy'
  }
  if (interaction.typing && !interaction.click) {
    face = health === 'unknown' ? 'confused' : 'focused'
    bubble = null
  }

  const pose = {
    health,
    activity,
    approval,
    // 哪些维度是 unknown（供消费者降级措辞）。注意：`approval` 是**刻意静默维**
    //（没有待批数据时我们不宣称"没有待批"），所以它 unknown **不得**把表情改成 confused，
    // 否则浮层会永远显示"疑惑"。表情仍只由 health 决定。
    unknownDims: [
      ...(health === 'unknown' ? ['health'] : []),
      ...(activity === 'unknown' ? ['activity'] : []),
      ...(approval === 'unknown' ? ['approval'] : []),
    ],
    face,
    body: ACTIVITY_POSE[activity],
    mark: APPROVAL_MARK[approval],
    persona,
    // 动画开关：reduceMotion 关掉所有位移，只留表情变化
    // activity=unknown 必须是「不呼吸」，不能与 idle 同款 —— 否则"不知道忙不忙"会被画成"闲着"
    motion: interaction.reduceMotion || activity === 'unknown' ? 'none' : activity === 'busy' ? 'bob-fast' : 'bob-slow',
    hoverLift: Boolean(interaction.hover) && !interaction.reduceMotion,
    bubble,
    // 供 DOM 直接落 class：`av-face-<face>` / `av-mark-exclaim` / `av-motion-bob-fast`
    classes: [
      `av-persona-${persona}`,
      `av-face-${face}`,
      `av-body-${ACTIVITY_POSE[activity]}`,
      APPROVAL_MARK[approval] ? `av-mark-${APPROVAL_MARK[approval]}` : 'av-mark-none',
      `av-motion-${interaction.reduceMotion || activity === 'unknown' ? 'none' : activity === 'busy' ? 'bob-fast' : 'bob-slow'}`,
      interaction.hover && !interaction.reduceMotion ? 'av-hover' : '',
    ].filter(Boolean),
  }
  return pose
}

/** 气泡文案：措辞只作"交互反馈"，事实结论仍来自 pet-status 的 display.text。 */
export function bubbleText(pose, statusText) {
  if (pose.bubble) return pose.bubble
  if (typeof statusText === 'string' && statusText) return statusText
  return ''
}
