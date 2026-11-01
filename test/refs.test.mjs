import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(ROOT, 'refs.manifest.json')

test('refs 清单存在且覆盖 ref/ 下所有图像', () => {
  assert.ok(existsSync(MANIFEST), '缺 refs.manifest.json（跑 npm run refs:scan）')
  const d = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  assert.ok(d.count >= 20, `参考图只有 ${d.count} 个，疑似盘点漏了`)
  for (const r of d.refs) assert.ok(r.tier, `${r.file} 没有 tier`)
})

test('关键事实（2026-11-01 实测，防止后人重复造轮子）：48px 那两张**不是** 1:1 像素画', () => {
  const d = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  const small = d.refs.filter((r) => r.size && r.size[0] <= 64)
  assert.ok(small.length >= 2, '应当有 48px 级参考图')
  for (const r of small) {
    assert.equal(r.is1to1PixelArt, false, `${r.file} 被当成 1:1 像素画了`)
    assert.ok(r.colors > 64, `${r.file} 颜色数 ${r.colors} 太少，判据需复核`)
    assert.equal(r.hasAlpha, false, `${r.file} 应当是不透明白底（需要先抠底）`)
  }
})

test('48px 级矢量化成本远超栅格：这是选型依据，不是口味', () => {
  const svg = readFileSync(join(ROOT, 'pixel/art/whale-maid.vector.svg'))
  const webp = readFileSync(join(ROOT, 'pixel/art/whale-maid.48.webp'))
  assert.ok(svg.length > webp.length * 5, `矢量 ${svg.length}B 未显著大于栅格 ${webp.length}B`)
  assert.ok(webp.length < 6 * 1024, `48px WebP 应当 <6KB，实际 ${webp.length}B`)
})
