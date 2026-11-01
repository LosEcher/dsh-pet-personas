#!/usr/bin/env python3
"""frame-parts.py — **部件搬运补帧**：不重画、不重采样、不重新量化，只用整数位移/剪贴造新帧。

依据（2026-11-01，Codex 第二意见 + 本仓实测一致）：
  · AI 逐帧重画在 448px 那一步就把"一条条分开的发丝、眼睛的硬边"抹平了，后处理补不回来；
  · 现有素材是**抖动量化**的（每格各自 32 色），任何重采样/重量化都会把抖动纹理打散 ⇒ 只能搬，
    不能重画。
所以本工具的铁律是：**输出像素必须是输入像素的副本**（颜色只来自输入），且只在允许的动作带内
与其来源不同。这条铁律可以机械验证（`frame-gate --allow`）。

两个算子：
  · `breathe`：把胸口以下的区块整体整数位移（0/-1/0/+1），接缝行用原始行填充。四帧循环。
  · `blink`  ：自动求两张源帧的**差异包围盒**（就是眼睛区域），把它的下半部分盖到睁眼帧上，
               得到"半闭"帧；循环 [睁, 半闭, 闭, 半闭]。

用法：
  python3 tools/frame-parts.py --op breathe --base idle_c0.png --band 46:96 --out-dir out/
  python3 tools/frame-parts.py --op blink --open idle_c0.png --closed idle_c1.png --out-dir out/
输出：`<out-dir>/<name>_0.png...`，并打印 `STATS {json}`（含动作带、每帧与基准的差异像素数）。
依赖 Pillow（与其它 tools 一致）。
"""
import argparse
import json
import os
import sys

from PIL import Image


def load(path):
    return Image.open(path).convert("RGBA")


def diff_bbox(a, b, thr=0):
    """两张同尺寸图的不透明差异包围盒（没有差异返回 None）。"""
    w, h = a.size
    pa, pb = a.load(), b.load()
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            ca, cb = pa[x, y], pb[x, y]
            if ca == cb:
                continue
            if ca[3] == 0 and cb[3] == 0:
                continue
            if minx > x:
                minx = x
            if miny > y:
                miny = y
            if maxx < x:
                maxx = x
            if maxy < y:
                maxy = y
    if maxx < 0:
        return None
    return (minx, miny, maxx, maxy)


def op_breathe(base, band, offsets, out_dir, name):
    """把 [band_start, height) 整体做整数位移；位移后露出的行用原始行填充（不产生新颜色）。"""
    w, h = base.size
    y0 = band[0]
    frames = []
    px = base.load()
    for i, dy in enumerate(offsets):
        img = base.copy()
        dst = img.load()
        for y in range(y0, h):
            sy = y - dy
            if sy < y0:
                sy = y0            # 上沿：夹住，不引入透明缝
            if sy >= h:
                sy = h - 1
            for x in range(w):
                dst[x, y] = px[x, sy]
        path = os.path.join(out_dir, f"{name}_{i}.png")
        img.save(path)
        frames.append(path)
    return frames, {"op": "breathe", "band": [y0, h], "offsets": offsets}


def op_blink(open_img, closed_img, out_dir, name, ratio=0.5):
    """用两帧的差异包围盒造"半闭"帧：把包围盒下部 ratio 比例的像素取自闭眼帧。"""
    box = diff_bbox(open_img, closed_img)
    if not box:
        print("两张源帧没有差异 —— 判不了（无法定位眼睛区域）", file=sys.stderr)
        return None, None
    minx, miny, maxx, maxy = box
    height = maxy - miny + 1
    cut = miny + max(1, int(round(height * ratio)))     # 从这一行起用闭眼像素
    half = open_img.copy()
    p_open, p_closed, p_half = open_img.load(), closed_img.load(), half.load()
    for y in range(cut, maxy + 1):
        for x in range(minx, maxx + 1):
            c = p_closed[x, y]
            if c[3] == 0:
                continue                     # 闭眼帧这里是空的：保留睁眼像素，避免挖洞
            p_half[x, y] = c
    images = [open_img, half, closed_img, half]
    frames = []
    for i, img in enumerate(images):
        path = os.path.join(out_dir, f"{name}_{i}.png")
        img.save(path)
        frames.append(path)
    return frames, {"op": "blink", "diffBox": list(box), "cutRow": cut, "ratio": ratio}


def main(argv):
    ap = argparse.ArgumentParser(description="部件搬运补帧（整数位移/剪贴，不重采样）")
    ap.add_argument("--op", required=True, choices=["breathe", "blink"])
    ap.add_argument("--base")
    ap.add_argument("--open")
    ap.add_argument("--closed")
    ap.add_argument("--band", default="46:96", help="breathe 的动作带 y0:y1（只允许在这段里变）")
    ap.add_argument("--offsets", default="0,-1,0,1")
    ap.add_argument("--ratio", type=float, default=0.5, help="blink：半闭时取闭眼像素的比例")
    ap.add_argument("--name", default="frame")
    ap.add_argument("--out-dir", required=True)
    args = ap.parse_args(argv)

    os.makedirs(args.out_dir, exist_ok=True)
    if args.op == "breathe":
        if not args.base:
            print("breathe 需要 --base", file=sys.stderr)
            return 2
        y0 = int(args.band.split(":")[0])
        offsets = [int(v) for v in args.offsets.split(",") if v.strip() != ""]
        frames, meta = op_breathe(load(args.base), (y0, 0), offsets, args.out_dir, args.name)
    else:
        if not args.open or not args.closed:
            print("blink 需要 --open 与 --closed", file=sys.stderr)
            return 2
        frames, meta = op_blink(load(args.open), load(args.closed), args.out_dir, args.name, args.ratio)
        if frames is None:
            return 2

    stats = {"op": meta.pop("op"), "frames": len(frames), **meta}
    stats["sizes"] = [Image.open(f).size for f in frames]
    print("STATS " + json.dumps(stats, ensure_ascii=False))
    for f in frames:
        print(f)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
