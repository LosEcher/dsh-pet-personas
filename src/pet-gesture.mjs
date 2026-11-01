/**
 * pet-gesture.mjs — 指针手势分类：**点一下** vs **拖一下**。
 *
 * 为什么不用现成的 drag 库：这里只有两个动作，而且阈值本身就是产品语义
 * （轻点=说话、拖动=搬家）。公开实现里的参数几乎一致：pet4claude 用 LONG_PRESS_MS=220
 * 与 DRAG_VEL_THRESHOLD=4px。照抄这两个数字是照抄"手感"，不是照抄代码。
 *
 * 纯函数：输入按下/移动/抬起的坐标与时间，输出 'click' | 'drag' | 'none'。
 * 这样不用 jsdom 也能测阈值边界（含负向控制：抖一下不算拖）。
 */
export const LONG_PRESS_MS = 220
export const DRAG_THRESHOLD_PX = 4

/**
 * @param {object} p
 * @param {{x:number,y:number}} p.from 按下点
 * @param {{x:number,y:number}|null} p.to 抬起点（null = 手势还没结束）
 * @param {number} p.durationMs 按下时长
 * @param {number} [p.threshold] 位移阈值（默认 4px）
 * @returns {'click'|'drag'|'press'|'none'}
 *   click = 短按且几乎没动（→ 说话）
 *   drag  = 位移超过阈值（→ 搬家，无论按多久）
 *   press = 按住超过 220ms 但没动（→ 以后可以挂长按菜单，现在等同 click）
 */
export function classifyGesture({ from, to, durationMs, threshold = DRAG_THRESHOLD_PX }) {
  if (!from) return 'none'
  if (!to) return durationMs >= LONG_PRESS_MS ? 'press' : 'none'
  const dx = to.x - from.x
  const dy = to.y - from.y
  const moved = Math.hypot(dx, dy)
  // 拖动优先：先动起来的就算拖，哪怕很快松手（否则快速甩动会被当成点击）
  if (moved >= threshold) return 'drag'
  if (durationMs >= LONG_PRESS_MS) return 'press'
  return 'click'
}

/** 拖动增量 → 新的 offset（相对角落基准）。把"落点"和"基准"分开算，窗口缩放才不会漂。 */
export function offsetFromDrag({ startOffset, startPos, currentPos, base }) {
  const dx = currentPos.x - startPos.x
  const dy = currentPos.y - startPos.y
  return {
    x: Math.round((startOffset?.x ?? 0) + dx),
    y: Math.round((startOffset?.y ?? 0) + dy),
  }
}
