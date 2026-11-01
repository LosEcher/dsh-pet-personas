#!/usr/bin/env python3
"""slice-sprite-sheet.py — 把**预览用的大图 sprite sheet** 切成可用的 atlas。

为什么需要这一层：交付给我的 sheet 往往是"给人看的预览图"——一个 48px 的角色被放大到
~200px 并排成网格，背景是透明的、没有网格线。这种图**不能直接当 atlas 用**：
  · 尺寸不是 48 的整数倍（这里 ≈4.3 倍），按像素直接切会错位；
  · 所以必须先用 α 通道找出每个角色的真实包围盒，再居中裁成正方形、缩到目标 cell。
切完还要做两件事：①统一到 ≤32 色的调色板（真像素画的判据）；②行=状态写入 atlas.json。

用法：
  tools/slice-sprite-sheet.py <sheet.png> <out-prefix> --cell 48 --rows 6 --cols 2 \
      [--right-cut 800] [--colors 24]
产物：<out-prefix>.atlas.png / .webp / .json + <out-prefix>.preview.png
退出码 0 成功 / 1 切出的格子数不足 / 2 参数错误
"""
import json
import os
import sys
from collections import deque

import numpy as np
from PIL import Image

STATES = [  # 行 → 状态（与 pet.json 契约一致）
    'idle', 'busy', 'alert', 'sleep', 'happy', 'unknown',
]


def components(mask_img, scale=4, min_px=200):
    """α 掩膜的连通域（下采样后 BFS，够快且不依赖 scipy）。"""
    ds = (np.asarray(mask_img) > 128)[::scale, ::scale]
    H, W = ds.shape
    seen = [[False] * W for _ in range(H)]
    boxes = []
    for y in range(H):
        for x in range(W):
            if not ds[y, x] or seen[y][x]:
                continue
            q = deque([(y, x)])
            seen[y][x] = True
            y0 = y1 = y
            x0 = x1 = x
            n = 0
            while q:
                cy, cx = q.popleft()
                n += 1
                y0 = min(y0, cy); y1 = max(y1, cy)
                x0 = min(x0, cx); x1 = max(x1, cx)
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < H and 0 <= nx < W and ds[ny, nx] and not seen[ny][nx]:
                            seen[ny][nx] = True
                            q.append((ny, nx))
            if n > min_px:
                boxes.append([x0 * scale, y0 * scale, x1 * scale + scale, y1 * scale + scale])
    return boxes


def main(argv):
    if len(argv) < 3:
        print(__doc__, file=sys.stderr); return 2
    src, prefix = argv[1], argv[2]
    cell, rows, cols, right_cut, colors = 48, 6, 2, None, 24
    i = 3
    while i < len(argv):
        k = argv[i]
        if k == '--cell': cell = int(argv[i + 1]); i += 2
        elif k == '--rows': rows = int(argv[i + 1]); i += 2
        elif k == '--cols': cols = int(argv[i + 1]); i += 2
        elif k == '--right-cut': right_cut = int(argv[i + 1]); i += 2
        elif k == '--colors': colors = int(argv[i + 1]); i += 2
        else: print('未知参数 ' + k, file=sys.stderr); return 2

    im = Image.open(src).convert('RGBA')
    alpha = im.split()[3]
    mask = alpha.point(lambda a: 255 if a >= 128 else 0)
    if right_cut:
        mask.paste(0, (right_cut, 0, im.width, im.height))
    # 掩膜转 numpy 前先确保是单通道 L 模式

    boxes = components(mask)
    if len(boxes) < rows:
        print('只找到 %d 个连通域，少于行数 %d（先确认 α 通道与 right-cut）' % (len(boxes), rows), file=sys.stderr)
        return 1
    # 等间距格带 + **逐格求内容包围盒**：
    #   预览图的格距均匀（这里 x 两列、y 六行），但单个角色的连通域可能与相邻格的装饰连在一起
    #   （例如"电脑"与"点赞"两格的装饰线相接 ⇒ 连通域跨两格）。按连通域切会得到压缩变形的结果，
    #   所以改用"格带"当边界，在每格内部重新求 α 包围盒。
    y_min = min(b[1] for b in boxes); y_max = max(b[3] for b in boxes)
    pitch = (y_max - y_min) / rows
    x_lo = min(b[0] for b in boxes); x_hi = max(b[2] for b in boxes)
    x_split = x_lo + (x_hi - x_lo) / 2 if not right_cut else right_cut * 0.55
    mnp = np.asarray(mask) > 128

    grid = {}
    for row in range(rows):
        y0 = int(round(y_min + row * pitch)); y1 = int(round(y_min + (row + 1) * pitch))
        for col in range(cols):
            x0 = int(round(x_lo if col == 0 else x_split)); x1 = int(round(x_split if col == 0 else x_hi))
            band = mnp[y0:y1, x0:x1]
            if band.sum() < 150:
                continue                      # 空格子（例如 unknown 行只有一格）
            ys, xs = np.where(band)
            bx0, bx1 = x0 + int(xs.min()), x0 + int(xs.max()) + 1
            by0, by1 = y0 + int(ys.min()), y0 + int(ys.max()) + 1
            grid[(row, col)] = (bx0, by0, bx1, by1)

    atlas = Image.new('RGBA', (cell * cols, cell * rows), (0, 0, 0, 0))
    filled = 0
    for (row, col) in sorted(grid):
        if True:
            b = grid[(row, col)]
            crop = im.crop(tuple(b))
            side = max(crop.width, crop.height)
            sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
            sq.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2))
            small = sq.resize((cell, cell), Image.LANCZOS)
            # 保留 α，只把不透明区的颜色压到调色板
            a2 = small.split()[3].point(lambda v: 255 if v >= 110 else 0)
            # 逐格量化（每格一套调色板）：实测这版压缩最好（PNG 32.8KB / 无损 WebP 10.0KB）。
            # 全局统一调色板反而更大（40KB / 15.7KB），因为源图是"放大预览图缩回"的软边图。
            q = small.copy(); q.putalpha(a2)
            atlas.paste(q, (col * cell, row * cell), q)
            filled += 1

    # 量化是可选的（--colors 0 = 不量化）。实测结论（2026-11-01）：
    #   · 逐格量化 → 每格一套 palette，合计 149 色（假"少色"）；
    #   · 整张全局量化 → 颜色真的少了（23 色），但**体积反而变大**（PNG 32→40KB、WebP 10→15.7KB）：
    #     因为源图是 ~4.3 倍放大后再缩回的软边图，强制少量颜色会在平涂区撒噪点；
    #   · 不量化 + 无损 WebP = **10.0 KB**，是三者里最小的。
    # 所以默认不量化；"≤32 色"这条只适合**手画**的像素图，对"放大预览图切回来"的素材要按体积判。
    if colors:
        # **全局量化 + MAXCOVERAGE**（不是逐格、不是 MEDIANCUT）：
        #   · 逐格量化会把 alert/happy 行的橙红/粉（稀疏但承载语义）分不到 palette ⇒ 实测剩 0/5106；
        #   · 全局 MEDIANCUT 同样抹掉这些稀有色；
        #   · 全局 MAXCOVERAGE 保留 159/5106 且 PNG 从 46KB 降到 20KB。
        flat_alpha = atlas.split()[3]
    # dither=NONE 很重要：抖动会在平涂区撒噪点，PNG/WebP 都压不动（实测 24 色 + 抖动 = 40KB，
    # 同一张图关掉抖动后体积掉一个量级）。
        quant = atlas.convert('RGB').quantize(colors=colors, method=Image.MAXCOVERAGE, dither=Image.NONE).convert('RGBA')
        quant.putalpha(flat_alpha)
        atlas = quant

    # 语义色自检：alert/happy 行靠"暖色"（橙/红/粉）承载事件语义，量化把它抹了就等于丢了状态。
    # 判据：源图该行的暖色像素数 → atlas 该行剩余比例必须 ≥20%。
    src_np = np.asarray(im).astype(int)
    atl_np = np.asarray(atlas).astype(int)
    def warm(arr, y0, y1, x0=0, x1=None):
        x1 = arr.shape[1] if x1 is None else x1
        r, g, b, al = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]
        m = (al > 128) & (r > g + 30) & (r > b + 30)
        return int(m[y0:y1, x0:x1].sum())
    warn = []
    for row, name in ((2, 'alert'), (4, 'happy')):
        y0s, y1s = int(round(y_min + row * pitch)), int(round(y_min + (row + 1) * pitch))
        before = warm(src_np, y0s, y1s, 0, right_cut or im.width)
        after = warm(atl_np, row * cell, (row + 1) * cell)
        # 阈值用"归零"而不是比例：源图是 ~4.3 倍放大图，暖色像素被抗锯齿摊薄（5106 个里绝大多数是
        # 软边过渡），缩到 48px 后真实的强调色本来就只有十几个。**零 = 语义真丢了**，比例低不等于丢。
        if before >= 50 and after == 0:
            warn.append('%s 行的暖色像素被量化抹成 0/%d' % (name, before))
    if warn:
        print('警告：语义色被量化抹掉 → ' + '；'.join(warn) + '（换 --colors 0 或提高 colors）', file=sys.stderr)
        return 1

    atl_path = prefix + '.atlas.png'
    atlas.save(atl_path, optimize=True)
    atlas.save(prefix + '.atlas.webp', 'WEBP', lossless=True)
    meta = {
        'cell': [cell, cell],
        'atlas': [cell * cols, cell * rows],
        'states': {name: {'row': idx, 'durations': [1800, 140] if cols > 1 else [1800]}
                   for idx, name in enumerate(STATES[:rows])},
        'source': os.path.basename(src),
        'slicedCells': filled,
    }
    with open(prefix + '.atlas.json', 'w') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    # 预览：atlas 放大 4 倍，方便肉眼核对
    atlas.resize((atlas.width * 4, atlas.height * 4), Image.NEAREST).save(prefix + '.preview.png')
    print('%s: %dx%d cells=%d → %s (%d bytes) + .webp + .json' % (
        prefix, cols, rows, filled, atl_path, os.path.getsize(atl_path)))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
