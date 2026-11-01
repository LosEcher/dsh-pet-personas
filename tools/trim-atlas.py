#!/usr/bin/env python3
"""trim-atlas.py — 裁掉图集每一格底部的"隔壁行残片"。

为什么需要（2026-11-01 实测）：`whale-maid` 的源图行与行之间**没有整行空白**，当初用
`--grid content` 切片时行带算高了一截，于是每一格底部都压进了下一行的一小条（preview 图上
就是每个角色脚下那道"被压扁的横条"）。`mermaid-maid` 用 `--grid gaps`，没有这个问题。

判据（不是猜的）：逐格统计**底部若干行**的不透明像素数，残片与角色之间会形成一个**低谷**
（残片是下一行角色的顶部，越往下越宽）。取 `y ∈ [cell-16, cell)` 里像素数的**最小值位置**当切点：

    idle    y=85 处 count=1     （几乎空）
    busy    y=85 处 count=21
    alert   y=86 处 count=0
    sleep   y=85 处 count=23
    happy   y=87 处 count=0
    unknown 本来就没有残片

这条规则只依赖"残片比角色窄"这一个可观测事实，不依赖行号；切完再用 `--check` 复算，
确认每一格底部 8 行确实是空的（unknown 那种本来就干净的格子会被判为"无需裁剪"）。

用法：
  python3 tools/trim-atlas.py --atlas pixel/art/whale-maid-sheet [--cell 96] [--dry-run] [--check]
依赖 Pillow。
"""
import argparse
import json
import sys

from PIL import Image


def row_profiles(img, cell):
    w, h = img.size
    cols, rows = w // cell, h // cell
    px = img.load()
    out = []
    for r in range(rows):
        prof = []
        for y in range(cell):
            n = 0
            for x in range(w):
                if px[x, r * cell + y][3] >= 110:
                    n += 1
            prof.append(n)
        out.append(prof)
    return out


def find_top_cut(prof, cell, window=16):
    """顶部残片同理：格子上沿也可能压着上一行角色的底部（实测 busy/alert/sleep 的 y=0 就有内容）。"""
    best_y, best_n = None, None
    for y in range(0, min(window, cell)):
        n = prof[y]
        if best_n is None or n < best_n:
            best_y, best_n = y, n
    if best_n is None:
        return None
    if all(prof[y] == 0 for y in range(0, best_y)):
        return None
    return best_y


def find_cut(prof, cell, window=16):
    """在底部 window 行里找像素数最小处当切点；返回 None 表示这一格底部本来就干净。"""
    start = max(0, cell - window)
    best_y, best_n = None, None
    for y in range(start, cell):
        n = prof[y]
        if best_n is None or n < best_n:
            best_y, best_n = y, n
    if best_n is None:
        return None
    # 底部已经是空的（切点之后的行全空）⇒ 无需裁剪
    if all(prof[y] == 0 for y in range(best_y + 1, cell)):
        return None
    return best_y


def main(argv):
    ap = argparse.ArgumentParser(description="裁掉图集每格底部的隔壁行残片")
    ap.add_argument("--atlas", required=True, help="图集前缀（不含 .atlas.png）")
    ap.add_argument("--cell", type=int, default=96)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--check", action="store_true", help="只检查每格上下是否已干净")
    ap.add_argument("--bottom-only", action="store_true", help="只裁底部（默认上下都裁）")
    args = ap.parse_args(argv)

    png_path = args.atlas + ".atlas.png"
    meta_path = args.atlas + ".atlas.json"
    img = Image.open(png_path).convert("RGBA")
    w, h = img.size
    cols, rows = w // args.cell, h // args.cell
    if w % args.cell or h % args.cell:
        print(f"尺寸 {w}x{h} 不是 {args.cell} 的整数倍", file=sys.stderr)
        return 2
    meta = json.load(open(meta_path))
    names = {v["row"]: k for k, v in meta["states"].items()}

    profiles = row_profiles(img, args.cell)   # 每行用两格合看的轮廓，仅用于报告
    px = img.load()
    report = []
    dirty = 0
    def cell_profile(r, c):
        prof = []
        for y in range(args.cell):
            n = 0
            for x in range(c * args.cell, (c + 1) * args.cell):
                if px[x, r * args.cell + y][3] >= 110:
                    n += 1
            prof.append(n)
        return prof

    for r in range(rows):
        # 逐格判定：同一行的两格残片高度可能不同（实测 alert 左右就不一样），
        # 共用一条切点会在一格里留下碎片。
        cut = find_cut(profiles[r], args.cell)
        top = None if args.bottom_only else find_top_cut(profiles[r], args.cell)
        occupied = [y for y in range(args.cell) if profiles[r][y] > 0]
        bottom_dirty = occupied and occupied[-1] >= args.cell - 4
        report.append((names.get(r, f"row{r}"), cut, top, bottom_dirty))
        if args.check:
            continue
        for c in range(cols):
            prof = cell_profile(r, c)
            if not any(prof):
                continue
            cell_bottom = find_cut(prof, args.cell)
            cell_top = None if args.bottom_only else find_top_cut(prof, args.cell)
            if cell_bottom is not None:
                dirty += 1
                for y in range(cell_bottom, args.cell):
                    for x in range(c * args.cell, (c + 1) * args.cell):
                        px[x, r * args.cell + y] = (0, 0, 0, 0)
            if cell_top is not None:
                dirty += 1
                for y in range(0, cell_top + 1):
                    for x in range(c * args.cell, (c + 1) * args.cell):
                        px[x, r * args.cell + y] = (0, 0, 0, 0)

    print(f"{args.atlas}: {cols}×{rows} 格，cell={args.cell}")
    for name, cut, top, bottom_dirty in report:
        print(f"  {name:9s} 底部切点={'无' if cut is None else cut:<3} 顶部切点={'无' if top is None else top:<3} 底部4行有内容={bottom_dirty}")

    if args.check:
        bad = [n for n, cut, top, _ in report if cut is not None or top is not None]
        if bad:
            print(f"✗ 仍有残片：{bad}", file=sys.stderr)
            return 1
        print("✓ 每格底部都干净")
        return 0

    if dirty == 0:
        print("没有需要裁剪的行")
        return 0
    if args.dry_run:
        print("dry-run：未写盘")
        return 0
    img.save(png_path)
    print(f"已写回 {png_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
