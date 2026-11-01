import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHEETS = ['whale-maid-sheet', 'mermaid-maid-sheet']

for (const stem of SHEETS) {
  test(`${stem}: atlas.json 与 webp 一致（cell 整除、row 不越界、WebP 魔数）`, () => {
    const j = join(ROOT, 'pixel/art', `${stem}.atlas.json`)
    const w = join(ROOT, 'pixel/art', `${stem}.atlas.webp`)
    assert.ok(existsSync(j) && existsSync(w), `缺 ${stem} 的 atlas 产物`)
    const meta = JSON.parse(readFileSync(j, 'utf8'))
    const [cw, ch] = meta.cell
    const [aw, ah] = meta.atlas
    assert.equal(aw % cw, 0); assert.equal(ah % ch, 0)
    for (const [name, st] of Object.entries(meta.states)) {
      assert.ok(st.row < ah / ch, `${stem}.${name} row 越界`)
      assert.ok(st.durations.every((d) => d > 0), `${stem}.${name} durations 非法`)
    }
    const buf = readFileSync(w)
    assert.equal(buf.subarray(0, 4).toString('ascii'), 'RIFF')
    assert.equal(buf.subarray(8, 12).toString('ascii'), 'WEBP')
    assert.ok(buf.length < 16 * 1024, `${stem} webp ${buf.length}B 超 16KB 预算`)
  })
}

test('两个 atlas 都含 6 个状态（idle/busy/alert/sleep/happy/unknown）', () => {
  for (const stem of SHEETS) {
    const meta = JSON.parse(readFileSync(join(ROOT, 'pixel/art', `${stem}.atlas.json`), 'utf8'))
    assert.deepEqual(Object.keys(meta.states).sort(),
      ['alert', 'busy', 'happy', 'idle', 'sleep', 'unknown'])
  }
})
