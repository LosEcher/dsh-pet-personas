#!/usr/bin/env python3
"""frame-intake.py — 把"生成图"收口成"图集能用的 96px 候选帧"。

为什么需要这一步（2026-11-01 实测）：M3 的 Qwen-Image-Edit 出图是 448×448 **不透明**（背景被填白），
而图集要的是 96×96 **透明底、≤32 色、整像素**。直接把生成图塞进 atlas 会同时坏掉三件事：
像素风、角色轮廓、以及播放时的透明边界。

三步收口（每一步都有明确取舍，不是美化）：
  1. **缩放**：默认 `majority`（面积加权多数色）而不是 LANCZOS —— 像素风要"整块颜色"，不是插值渐变；
  2. **取轮廓**：用**基准帧的 alpha** 当遮罩（生成图的背景不可信）。这等于声明"角色的形状由手绘素材
     决定，模型只负责改内部细节"——这也是它唯一的可靠用法；
  3. **限色**：量化到 ≤32 色（与现有每格一致，实测 12 格恒为 32）。

输出：`<out.png>`（96×96 RGBA）+ 一行 `STATS {json}` 供上层记账。

用法：
  python3 tools/frame-intake.py --base <96px 基准帧.png> --cand <生成图.png> --out <候选帧.png>
        [--cell 96] [--colors 32] [--alpha-threshold 110]
依赖 Pillow（与 tools/slice-sprite-sheet.py 相同）。
"""
import argparse
import json
import sys

from PIL import Image


def majority_resize(img, cell):
    """面积加权多数色缩放：每个目标像素取它覆盖的源区域里出现最多的颜色。"""
    src = img.convert("RGBA")
    w, h = src.size
    out = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
    px = out.load()
    for y in range(cell):
        y0, y1 = int(y * h / cell), max(int(y * h / cell) + 1, int((y + 1) * h / cell))
        for x in range(cell):
            x0, x1 = int(x * w / cell), max(int(x * w / cell) + 1, int((x + 1) * w / cell))
            counts = {}
            for sy in range(y0, y1):
                for sx in range(x0, x1):
                    counts[src.getpixel((sx, sy))] = counts.get(src.getpixel((sx, sy)), 0) + 1
            px[x, y] = max(counts.items(), key=lambda kv: kv[1])[0]
    return out


def mode_filter(img, n=3):
    """n×n 多数色滤波：像素风去噪的经典手段（比中值滤波更保边，因为颜色只会取自邻域里已有的颜色）。"""
    src = img.convert("RGBA")
    out = src.copy()
    r = n // 2
    px_src = src.load()
    px_out = out.load()
    w, h = src.size
    for y in range(h):
        for x in range(w):
            counts = {}
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h:
                        c = px_src[nx, ny]
                        counts[c] = counts.get(c, 0) + 1
            # 平票时保留原像素，避免把细节抹平
            best = max(counts.items(), key=lambda kv: (kv[1], kv[0] == px_src[x, y]))
            px_out[x, y] = best[0]
    return out


def main(argv):
    ap = argparse.ArgumentParser(description="生成图 → 96px 候选帧（缩放/取轮廓/限色）")
    ap.add_argument("--base", required=True, help="96px 基准帧（提供轮廓 alpha）")
    ap.add_argument("--cand", required=True, help="生成图（任意尺寸）")
    ap.add_argument("--out", required=True)
    ap.add_argument("--cell", type=int, default=96)
    ap.add_argument("--colors", type=int, default=32)
    ap.add_argument("--alpha-threshold", type=int, default=110)
    ap.add_argument("--resize", default="majority", choices=["majority", "lanczos"],
                    help="缩放方式：majority=面积多数色（默认，块感强）；lanczos=平滑后量化")
    ap.add_argument("--mode-filter", type=int, default=0,
                    help="缩放后做 n×n 多数色滤波（3 或 5），用于压掉重采样噪点")
    args = ap.parse_args(argv)

    base = Image.open(args.base).convert("RGBA")
    cand = Image.open(args.cand).convert("RGBA")
    if base.size != (args.cell, args.cell):
        print(f"基准帧尺寸必须是 {args.cell}×{args.cell}（实际 {base.size}）", file=sys.stderr)
        return 2

    if args.resize == "lanczos":
        small = cand.resize((args.cell, args.cell), Image.LANCZOS).convert("RGBA")
    else:
        small = majority_resize(cand, args.cell)

    # 限色：先量化 RGB，再把基准帧的 alpha 二值化后贴回去
    if args.colors:
        small = small.convert("RGB").quantize(colors=args.colors, method=Image.MAXCOVERAGE,
                                              dither=Image.NONE).convert("RGBA")
    if args.mode_filter >= 3:
        small = mode_filter(small, args.mode_filter)

    mask = base.getchannel("A").point(lambda v: 255 if v >= args.alpha_threshold else 0)
    small.putalpha(mask)

    small.save(args.out)
    colors = {}
    for p in small.convert("RGBA").getdata():
        if p[3] >= args.alpha_threshold:
            colors[p[:3]] = colors.get(p[:3], 0) + 1
    print("STATS " + json.dumps({
        "out": args.out,
        "cell": args.cell,
        "colors": len(colors),
        "opaque": sum(colors.values()),
        "alpha_from": "base",
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
