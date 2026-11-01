#!/usr/bin/env python3
"""slice-sprite-sheet.py — 把"给人看的预览大图"切成可用的 48px atlas。

交付给我的 sheet 通常不是原生 atlas：一张 48×48 的角色被放大到 ~200–250px，2 列 × 6 行拼在一张
1024×1536 或 1254×1254 的透明底预览图上。不能按像素直接切——尺寸不是 48 的整数倍，格距也不等于
角色包围盒。所以要先**从像素读网格**，再逐格求包围盒、居中裁方、缩到 cell。

三种网格模式（按 sheet 形态选，选错会切歪，见 DESIGN-VI §2）：
  --grid gaps     ★首选：用 α 投影找"整行/整列为空"的带当分隔线。装饰相连也骗不到它。
  --grid exact    等分整图：只适合"每格占满画布、装饰不外溢"的 sheet。
  --grid content  用内容总范围估格距：兜底（第一张 whale sheet 就是这种：行间没有空带）。

产物：<prefix>.atlas.png / .webp / .json + <prefix>.preview.png（4× 放大，肉眼核对）
退出码：0 成功 / 1 切格数不足或语义色被抹 / 2 参数错
"""
import json
import os
import sys
from collections import deque

import numpy as np
from PIL import Image

STATES = ['idle', 'busy', 'alert', 'sleep', 'happy', 'unknown']


def components(mask_np, scale=4, min_px=200):
    """α 掩膜的连通域（下采样后 BFS）。只用来估格距，不用来定边界。"""
    ds = mask_np[::scale, ::scale]
    H, W = ds.shape
    seen = np.zeros_like(ds, dtype=bool)
    boxes = []
    for y in range(H):
        for x in range(W):
            if not ds[y, x] or seen[y, x]:
                continue
            q = deque([(y, x)])
            seen[y, x] = True
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
                        if 0 <= ny < H and 0 <= nx < W and ds[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            q.append((ny, nx))
            if n > min_px:
                boxes.append([x0 * scale, y0 * scale, x1 * scale + scale, y1 * scale + scale])
    return boxes


def empty_runs(v, thr=3, minlen=6):
    out, st = [], None
    for i, x in enumerate(v):
        if x <= thr and st is None:
            st = i
        elif x > thr and st is not None:
            if i - st >= minlen:
                out.append((st, i - 1))
            st = None
    if st is not None and len(v) - st >= minlen:
        out.append((st, len(v) - 1))
    return out


def content_bands(mnp, gaps, total, axis):
    """按空带切出内容带。axis='row' 沿 y 切行；axis='col' 沿 x 切列。

    ⚠️ 列方向必须切 `mnp[:, a:b]`（而不是 `mnp[a:b]`）。我第一版把两种都写成按行切，
    结果"列带"其实是竖着切的横带，算出来的 x 范围能超过整图宽度（实测 x1=1049 > 1024），
    于是每格都框进了相邻两列的内容。
    """
    cuts = [0] + [g[1] + 1 for g in gaps] + [total]
    bands = []
    for a, b in zip(cuts, cuts[1:]):
        seg = mnp[a:b] if axis == 'row' else mnp[:, a:b]
        prof = seg.sum(axis=1) if axis == 'row' else seg.sum(axis=0)
        idx = np.where(prof > 3)[0]
        if idx.size:
            bands.append((a + int(idx.min()), a + int(idx.max()) + 1))
    return bands


def bbox_in(mnp, x0, x1, y0, y1, min_px=150):
    band = mnp[y0:y1, x0:x1]
    if band.sum() < min_px:
        return None
    ys, xs = np.where(band)
    return (x0 + int(xs.min()), y0 + int(ys.min()), x0 + int(xs.max()) + 1, y0 + int(ys.max()) + 1)


def compute_grid(mode, mnp, boxes, rows, cols, right_cut):
    H, W = mnp.shape
    x_hi = right_cut or W
    grid = {}

    if mode == 'gaps':
        rbands = content_bands(mnp, empty_runs(mnp.sum(axis=1)), H, 'row')
        cgaps = empty_runs(mnp.sum(axis=0))
        cbands = content_bands(mnp, cgaps, W, 'col')
        if len(rbands) != rows or not cbands:
            return None, 'gaps 模式没找到 %d 行（得到 %d）' % (rows, len(rbands))
        if len(cbands) < cols:
            # 没有整列空带时，别用中点（装饰不对称会把一格切进别人身上）：
            # 在中间 40% 范围里找**列投影最小**的位置当分隔线。
            x0, x1 = cbands[0]
            span = x1 - x0
            lo, hi = x0 + int(span * 0.30), x0 + int(span * 0.70)
            cut = lo + int(np.argmin(mnp[:, lo:hi].sum(axis=0)))
            cbands = [(x0, cut), (cut, x1)]
        for ri, (y0, y1) in enumerate(rbands[:rows]):
            for ci, (x0, x1) in enumerate(cbands[:cols]):
                bb = bbox_in(mnp, x0, x1, y0, y1)
                if bb:
                    grid[(ri, ci)] = bb
        # **单角色行**（例如 unknown 只有一格）：若该行带里只有 1 个连通域，就只填第 0 列，
        # 否则这个角色会被列分隔线切成两半（实测 row5 就是这样变成"半个头 + 半个头"）。
        single_rows = set()
        for ri, (y0, y1) in enumerate(rbands[:rows]):
            in_row = [b for b in boxes if y0 - 5 <= (b[1] + b[3]) / 2 <= y1 + 5]
            if len(in_row) == 1:
                b = in_row[0]
                grid[(ri, 0)] = (b[0], b[1], b[2], b[3])
                grid.pop((ri, 1), None)
                single_rows.add(ri)
        return grid, None, {'mode': 'gaps', 'rowBands': rbands[:rows],
                            'colBands': cbands[:cols], 'singleRows': single_rows}

    elif mode == 'exact':
        pitch_y = H / rows
        pitch_x = x_hi / cols
        for ri in range(rows):
            for ci in range(cols):
                bb = bbox_in(mnp, int(ci * pitch_x), int((ci + 1) * pitch_x),
                             int(ri * pitch_y), int((ri + 1) * pitch_y))
                if bb:
                    grid[(ri, ci)] = bb
        return grid, None, None

    else:  # content：用内容总范围估格距（兜底）
        if not boxes:
            return None, 'content 模式需要连通域'
        y_min = min(b[1] for b in boxes); y_max = max(b[3] for b in boxes)
        x_lo = min(b[0] for b in boxes); x_hi2 = min(x_hi, max(b[2] for b in boxes))
        pitch_y = (y_max - y_min) / rows
        x_split = x_lo + (x_hi2 - x_lo) / cols
        for ri in range(rows):
            y0 = int(round(y_min + ri * pitch_y)); y1 = int(round(y_min + (ri + 1) * pitch_y))
            for ci in range(cols):
                x0 = int(round(x_lo + ci * ((x_hi2 - x_lo) / cols)))
                x1 = int(round(x_lo + (ci + 1) * ((x_hi2 - x_lo) / cols)))
                bb = bbox_in(mnp, x0, x1, y0, y1)
                if bb:
                    grid[(ri, ci)] = bb
    return grid, None, None


def warm_count(arr):
    r, g, b, al = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]
    return int(((al > 128) & (r > g + 30) & (r > b + 30)).sum())


def main(argv):
    if len(argv) < 3:
        print(__doc__, file=sys.stderr); return 2
    src, prefix = argv[1], argv[2]
    cell, rows, cols, right_cut, colors, mode = 48, 6, 2, None, 24, 'gaps'
    i = 3
    while i < len(argv):
        k = argv[i]
        if k == '--cell': cell = int(argv[i + 1]); i += 2
        elif k == '--rows': rows = int(argv[i + 1]); i += 2
        elif k == '--cols': cols = int(argv[i + 1]); i += 2
        elif k == '--right-cut': right_cut = int(argv[i + 1]); i += 2
        elif k == '--colors': colors = int(argv[i + 1]); i += 2
        elif k == '--grid': mode = argv[i + 1]; i += 2
        else: print('未知参数 ' + k, file=sys.stderr); return 2

    im = Image.open(src).convert('RGBA')
    mask_img = im.split()[3].point(lambda a: 255 if a >= 128 else 0)
    if right_cut:
        mask_img.paste(0, (right_cut, 0, im.width, im.height))
    mnp = np.asarray(mask_img) > 128
    boxes = components(mnp)

    grid, err, band_h = compute_grid(mode, mnp, boxes, rows, cols, right_cut)
    if err or not grid:
        print(err or '没能算出网格', file=sys.stderr); return 1
    if len(grid) < rows:
        print('只切到 %d 格，少于行数 %d' % (len(grid), rows), file=sys.stderr); return 1

    # **统一取景边长**：逐格按自己的包围盒裁成正方形会让每个角色缩放不一致（大的变小、小的变大，
    # 摆在一起像不同角色）。这里取所有格包围盒的最大边作为统一边长，每格以自身中心裁同一尺寸。
    # 取景边长：优先用"最矮的行带高度"——否则按最大包围盒取景会**裁到下一行角色的头顶**
    # （实测：行带宽 213–262 不等，用 262 当边长，每格底下都会带进一条别人的头发）。
    # 每格取"自身包围盒的最大边"裁成正方形 —— 先保证**角色完整**；
    # 溢出到邻格的像素用下面的行/列带遮罩清掉（比缩小取景更不损角色，也不会裁掉尾巴/装饰）。
    sides = {k: max(b[2] - b[0], b[3] - b[1]) for k, b in grid.items()}
    info = band_h if isinstance(band_h, dict) else None
    atlas = Image.new('RGBA', (cell * cols, cell * rows), (0, 0, 0, 0))
    for (row, col) in sorted(grid):
        x0, y0, x1, y1 = grid[(row, col)]
        side = sides[(row, col)]
        left = (x0 + x1) // 2 - side // 2
        top = (y0 + y1) // 2 - side // 2
        crop = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        src_box = (max(0, left), max(0, top), min(im.width, left + side), min(im.height, top + side))
        piece = im.crop(src_box)
        crop.paste(piece, (src_box[0] - left, src_box[1] - top))
        if info:  # 行/列带遮罩：清掉溢出到邻格的部分
            ry0, ry1 = info['rowBands'][row]
            # 单角色行不套列遮罩：那个角色本来就横跨两列，按列切会把它削掉一半（实测 row5）
            if row in info.get('singleRows', ()):
                cx0, cx1 = 0, im.width
            else:
                cx0, cx1 = info['colBands'][col] if col < len(info['colBands']) else (0, im.width)
            m = Image.new('L', (side, side), 0)
            ax0, ay0 = max(cx0, left), max(ry0, top)
            ax1, ay1 = min(cx1, left + side), min(ry1, top + side)
            if ax1 > ax0 and ay1 > ay0:
                m.paste(255, (ax0 - left, ay0 - top, ax1 - left, ay1 - top))
            a_old = crop.split()[3]
            crop.putalpha(Image.composite(a_old, Image.new('L', (side, side), 0), m))
        small = crop.resize((cell, cell), Image.LANCZOS)
        a2 = small.split()[3].point(lambda v: 255 if v >= 110 else 0)
        if colors:
            # **必须 MAXCOVERAGE**：MEDIANCUT 会把"小而饱和"的装饰色（alert 行的橙红感叹号）
            # 抹成灰蓝 —— 实测源图 alert 行 5106 个暖色像素，MEDIANCUT 后剩 0，MAXCOVERAGE 保留 159。
            q = small.convert('RGB').quantize(colors=colors, method=Image.MAXCOVERAGE,
                                              dither=Image.NONE).convert('RGBA')
            q.putalpha(a2)
        else:
            q = small.copy(); q.putalpha(a2)
        atlas.paste(q, (col * cell, row * cell), q)

    src_np = np.asarray(im).astype(int)
    atl_np = np.asarray(atlas).astype(int)
    for row, name in ((2, 'alert'), (4, 'happy')):
        if (row, 0) not in grid:
            continue
        y0, y1 = grid[(row, 0)][1], grid[(row, 0)][3]
        before = warm_count(src_np[y0:y1])
        after = warm_count(atl_np[row * cell:(row + 1) * cell])
        if before >= 50 and after == 0:
            print('警告：%s 行的暖色像素被量化抹成 0/%d（换 --colors 0 或提高 colors）' % (name, before),
                  file=sys.stderr)
            return 1

    atl_path = prefix + '.atlas.png'
    atlas.save(atl_path, optimize=True)
    atlas.save(prefix + '.atlas.webp', 'WEBP', lossless=True)
    meta = {
        'cell': [cell, cell],
        'atlas': [cell * cols, cell * rows],
        'states': {n: {'row': idx, 'durations': [1800, 140] if cols > 1 else [1800]}
                   for idx, n in enumerate(STATES[:rows])},
        'source': os.path.basename(src),
        'gridMode': mode,
        'slicedCells': len(grid),
    }
    with open(prefix + '.atlas.json', 'w') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    atlas.resize((atlas.width * 4, atlas.height * 4), Image.NEAREST).save(prefix + '.preview.png')
    print('%s: %s → %dx%d cells=%d  png=%dB webp=%dB' % (
        prefix, mode, cols, rows, len(grid), os.path.getsize(atl_path),
        os.path.getsize(prefix + '.atlas.webp')))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
