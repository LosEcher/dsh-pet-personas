import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveAvatar, PERSONAS } from '../avatar-state.mjs'

test('health 三态映射到三种表情', () => {
  assert.equal(deriveAvatar({ health: 'ok' }).face, 'happy')
  assert.equal(deriveAvatar({ health: 'attention' }).face, 'worry')
  assert.equal(deriveAvatar({ health: 'unknown' }).face, 'confused')
})

test('负向控制①：unknown 不得出现 happy（点一下也不行）', () => {
  const clicked = deriveAvatar({ health: 'unknown' }, { click: true })
  assert.notEqual(clicked.face, 'happy')
  assert.equal(clicked.face, 'confused')
  assert.equal(clicked.health, 'unknown', '点击不得改写事实')
})

test('负向控制②：缺字段一律 unknown，不默认 ok/idle', () => {
  const p = deriveAvatar({})
  assert.equal(p.health, 'unknown')
  assert.equal(p.activity, 'unknown')
  assert.equal(p.approval, 'unknown')
  assert.equal(p.mark, null)
})

test('负向控制③：非法值不落成通过（health=banana ⇒ unknown）', () => {
  assert.equal(deriveAvatar({ health: 'banana', activity: 'sleeping' }).face, 'confused')
})

test('approval=pending 才有惊叹标记', () => {
  assert.equal(deriveAvatar({ approval: 'pending' }).mark, 'exclaim')
  assert.equal(deriveAvatar({ approval: 'none' }).mark, null)
  assert.equal(deriveAvatar({ approval: 'unknown' }).mark, null)
})

test('reduced motion 关掉位移动画与 hover 抬升', () => {
  const p = deriveAvatar({ health: 'ok', activity: 'busy' }, { hover: true, reduceMotion: true })
  assert.equal(p.motion, 'none')
  assert.equal(p.hoverLift, false)
  assert.ok(p.classes.includes('av-motion-none'))
})

test('负向控制④：activity=unknown 不得与 idle 同款（不呼吸，而不是慢呼吸）', () => {
  assert.equal(deriveAvatar({ health: 'ok', activity: 'unknown' }).motion, 'none')
  assert.equal(deriveAvatar({ health: 'ok', activity: 'idle' }).motion, 'bob-slow')
  assert.equal(deriveAvatar({ health: 'ok', activity: 'busy' }).motion, 'bob-fast')
})

test('unknownDims 如实暴露，但 approval=unknown 不得把表情改成 confused（静默维）', () => {
  const p = deriveAvatar({ health: 'ok', activity: 'idle', approval: 'unknown' })
  assert.deepEqual(p.unknownDims, ['approval'])
  assert.equal(p.face, 'happy', 'approval 是静默维：没有数据不等于看不清')
  const q = deriveAvatar({ health: 'unknown' })
  assert.equal(q.face, 'confused')
  assert.ok(q.unknownDims.includes('health'))
})

test('busy 与 idle 的动作不同；hover 抬升只在非 reduced 下出现', () => {
  assert.equal(deriveAvatar({ activity: 'busy' }).motion, 'bob-fast')
  assert.equal(deriveAvatar({ activity: 'idle' }).motion, 'bob-slow')
  assert.equal(deriveAvatar({}, { hover: true }).hoverLift, true)
})

test('persona 可切换且非法值回落 cat', () => {
  for (const p of PERSONAS) assert.equal(deriveAvatar({}, { persona: p }).persona, p)
  assert.equal(deriveAvatar({}, { persona: 'dragon' }).persona, 'cat')
  assert.ok(deriveAvatar({}, { persona: 'lion' }).classes.includes('av-persona-lion'))
})

test('classes 覆盖 face/body/mark/motion 四类，便于 CSS 直接消费', () => {
  const c = deriveAvatar({ health: 'attention', activity: 'busy', approval: 'pending' }).classes
  for (const want of ['av-face-worry', 'av-body-work', 'av-mark-exclaim', 'av-motion-bob-fast']) {
    assert.ok(c.includes(want), `缺 ${want}: ${c.join(',')}`)
  }
})
