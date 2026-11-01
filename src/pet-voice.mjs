/**
 * pet-voice.mjs — 每个状态的**配套文案**（气泡）。事实结论仍来自 pet-status 的 display.text，
 * 这里只负责"宠物怎么说话"：短、具体、不吹牛。
 *
 * 三条纪律：
 *   · 不编事实：文案里不出现具体数字/结论（数字来自 display.text，避免两处不一致）；
 *   · unknown 必须说"我看不清"，不许说"应该没事"；
 *   · 同一状态多句轮换，避免每 30 秒重复同一句（靠 seq 轮换，不靠随机，便于测试）。
 */
export const VOICE = {
  idle: ['在的。', '有事叫我。', '我守着。'],
  busy: ['正在跑。', '手上有活。', '跑着呢，别急。'],
  alert: ['这个要你看一眼。', '有条不太对。', '过来看一下。'],
  sleep: ['先眯一会儿。', '有点困…', 'Zzz'],
  happy: ['搞定。', '成了。', '这件做完了。'],
  unknown: ['我看不清，别信我瞎猜。', '读不到状态。', '这会儿判不了。'],
}

/** 按状态取一句；seq 递增即轮换（不随机，便于断言） */
export function lineFor(state, seq = 0) {
  const lines = VOICE[state] ?? VOICE.unknown
  const i = Math.abs(Math.trunc(seq)) % lines.length
  return lines[i]
}
