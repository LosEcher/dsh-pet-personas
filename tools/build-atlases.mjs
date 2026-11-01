#!/usr/bin/env node
/**
 * build-atlases.mjs — 按 `pixel/art/sources.json` 把所有 persona 的 atlas 重新切一遍。
 *
 * 为什么要这张清单：不同 sheet 需要不同的 `--grid` 模式（有整行空带的用 gaps，
 * 行间相连的用 content），把参数写进代码或 shell 一行里都会很快失配。清单是唯一真源。
 */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(ROOT, 'pixel/art/sources.json'), 'utf8'))
const py = process.env.PYTHON ?? 'python3'

let failed = 0
for (const s of manifest.sources) {
  const args = [join(ROOT, 'tools/slice-sprite-sheet.py'), s.src, s.out,
    '--cell', String(manifest.cell), '--rows', '6', '--cols', '2',
    '--colors', String(manifest.colors), '--sampler', manifest.sampler, '--grid', s.grid]
  if (s.rightCut) args.push('--right-cut', String(s.rightCut))
  const r = spawnSync(py, args, { cwd: ROOT, stdio: 'inherit' })
  if (r.status !== 0) { console.error(`✗ ${s.id} 切图失败`); failed += 1 }
}
process.exit(failed ? 1 : 0)
