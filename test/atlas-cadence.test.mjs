/**
 * atlas-cadence.test.mjs — 帧节奏的**单一真源**与"引用的帧必须非空"。
 *
 * 直接动因（2026-11-01 实测）：`unknown` 行的第二格 α 全为 0，而 atlas.json 的 durations 是
 * `[1800, 140]` ⇒ 宠物在"判不了"状态下每 1.94 秒**消失 140 毫秒**。没有任何断言会红：
 * 预览图上空格只像"那格没画"，而播放器照 durations 走。
 *
 * 判据只能是像素：① 每状态引用的每一列都必须非空；② 非空的列必须被某个状态引用（不许静默丢素材）；
 * ③ 节奏必须等于 `pixel/art/pet-cadence.json`（唯一真源，切片脚本也读它）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPng, opaqueCount } from '../tools/png-alpha.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const artDir = join(root, 'pixel', 'art')
const cadence = JSON.parse(readFileSync(join(artDir, 'pet-cadence.json'), 'utf8'))
const atlases = readdirSync(artDir).filter((f) => f.endsWith('.atlas.json'))

test('节奏真源覆盖全部状态，且每条都是正数毫秒', () => {
  const expected = ['idle', 'busy', 'alert', 'sleep', 'happy', 'unknown']
  for (const state of expected) {
    const entry = cadence[state]
    assert.ok(entry && Array.isArray(entry.durations), `cadence 缺 ${state}`)
    assert.ok(entry.durations.length >= 1, `${state} 至少要一帧`)
    for (const ms of entry.durations) {
      assert.ok(Number.isInteger(ms) && ms > 0, `${state} 的时长必须是正整数字（实际 ${ms}）`)
    }
  }
})

test('每个 atlas 的 durations 必须等于 cadence 真源（不许各写一份）', () => {
  assert.ok(atlases.length > 0, '一个 atlas 都没有')
  for (const file of atlases) {
    const meta = JSON.parse(readFileSync(join(artDir, file), 'utf8'))
    for (const [state, spec] of Object.entries(meta.states)) {
      assert.deepEqual(spec.durations, cadence[state].durations,
        `${file} 的 ${state} 节奏与 pet-cadence.json 不一致（重跑切片）`)
    }
  }
})

test('引用的列必须非空；非空的列必须被引用（两向都查）', () => {
  for (const file of atlases) {
    const meta = JSON.parse(readFileSync(join(artDir, file), 'utf8'))
    const pngPath = join(artDir, file.replace('.atlas.json', '.atlas.png'))
    assert.ok(existsSync(pngPath), `${file} 缺同名 atlas.png`)
    const png = readPng(pngPath)
    const [cw, ch] = meta.cell
    const cols = Math.round(meta.atlas[0] / cw)
    const used = new Set()
    for (const [state, spec] of Object.entries(meta.states)) {
      for (let c = 0; c < spec.durations.length; c += 1) {
        const n = opaqueCount(png, c * cw, spec.row * ch, cw, ch)
        assert.ok(n > 0, `${file} 的 ${state} 引用了空帧（row=${spec.row} col=${c}）⇒ 会闪成消失`)
        used.add(`${spec.row}:${c}`)
      }
    }
    for (let r = 0; r < Math.round(meta.atlas[1] / ch); r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const n = opaqueCount(png, c * cw, r * ch, cw, ch)
        if (n > 0) assert.ok(used.has(`${r}:${c}`), `${file} 的 row=${r} col=${c} 有素材但没被任何状态引用`)
      }
    }
  }
})

test('unknown 是单帧（"判不了"必须稳定可见，不能闪烁）', () => {
  for (const file of atlases) {
    const meta = JSON.parse(readFileSync(join(artDir, file), 'utf8'))
    assert.equal(meta.states.unknown.durations.length, 1,
      `${file} 的 unknown 必须是单帧：它本来就只有一格素材，多帧会闪成消失`)
  }
})

test('负向控制：把 unknown 恢复成 [1800,140] 会让"引用非空"判据变红', () => {
  const file = atlases[0]
  const meta = JSON.parse(readFileSync(join(artDir, file), 'utf8'))
  const png = readPng(join(artDir, file.replace('.atlas.json', '.atlas.png')))
  const [cw, ch] = meta.cell
  const fake = { ...meta.states.unknown, durations: [1800, 140] }   // 旧配置
  const emptyFrameHit = fake.durations
    .map((_, c) => opaqueCount(png, c * cw, fake.row * ch, cw, ch))
    .some((n) => n === 0)
  assert.equal(emptyFrameHit, true, '这条负向控制失效了：空帧检测没抓到 [1800,140]')
})
