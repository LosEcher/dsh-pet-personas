#!/usr/bin/env python3
"""refs-scan.py — 盘点 ref/ 里的参考图，给出**可机械复跑**的适用性判据。

判据（不是主观"好看不好看"）：
  · colors  —— 不透明区域的颜色种数。>64 ⇒ 不是 1:1 像素画（不能无损矩形化）
  · alpha   —— 是否带透明通道（能否直接叠在浮层上）
  · grid    —— 每个色块的平均像素数（≈1 表示 1:1 像素画；远大于 1 表示被放大过）
  · 尺寸档  —— 48 级（挂件）/ 576 级（放大像素画）/ 千级（插画、肖像档、设计参考）

用法：tools/refs-scan.py ref/ > refs.manifest.json
"""
import json
import os
import sys
from collections import Counter
from PIL import Image

ALPHA_THR = 128


def scan(path):
    im = Image.open(path)
    fmt, size, mode = im.format, im.size, im.mode
    rgba = im.convert('RGBA')
    w, h = rgba.size
    px = rgba.load()
    colors = Counter()
    opaque = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a >= ALPHA_THR:
                colors[(r, g, b)] += 1
                opaque += 1
    ncolor = len(colors)
    # 平均色块面积：相同颜色像素的平均连通规模（粗估"是不是格子画"）
    avg_block = (opaque / ncolor) if ncolor else 0
    if size[0] <= 64:
        tier = 'widget-48'
    elif size[0] <= 1024 and ncolor <= 64:
        tier = 'pixel-upscaled'
    else:
        tier = 'illustration'
    return {
        'file': os.path.basename(path),
        'format': fmt,
        'size': list(size),
        'mode': mode,
        'hasAlpha': mode in ('RGBA', 'LA', 'P') and rgba.getextrema()[3][0] < 255,
        'colors': ncolor,
        'opaquePixels': opaque,
        'avgBlockPx': round(avg_block, 2),
        'is1to1PixelArt': bool(size[0] <= 64 and ncolor <= 64),
        'tier': tier,
        'bytes': os.path.getsize(path),
    }


def main(argv):
    if len(argv) < 2:
        print('用法: refs-scan.py <ref-dir>', file=sys.stderr)
        return 2
    d = argv[1]
    rows = []
    for name in sorted(os.listdir(d)):
        p = os.path.join(d, name)
        if not os.path.isfile(p):
            continue
        try:
            rows.append(scan(p))
        except Exception as e:
            rows.append({'file': name, 'error': str(e)})
    json.dump({'scannedAt': None, 'count': len(rows), 'refs': rows}, sys.stdout, ensure_ascii=False, indent=1)
    print('', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
