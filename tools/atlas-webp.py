#!/usr/bin/env python3
"""atlas-webp.py — 由 `<prefix>.atlas.png` 重新生成 `<prefix>.atlas.webp`（无损）。

为什么必须单独有这一步（2026-11-01 踩坑）：插件用的**不是 PNG 而是 WebP**（data-URI 有 56KB 上限，
PNG 太大）。`slice-sprite-sheet.py` 会同时写 png/json/webp 三个文件，但 `compose-atlas.mjs` 合成
（加帧、扩列）时只写了 png/json ⇒ **WebP 还是旧的 2 列**，而 meta 已经是 4 列。

症状：`background-size` 按 meta 算成 384×576 的显示尺寸，浏览器里那张图只有 192 宽 ⇒
**横向被拉伸 2 倍 + 列定位全错**，看起来就是"人物被裁、宽高比不对"。

用法：
  python3 tools/atlas-webp.py --atlas pixel/art/mermaid-maid-sheet [--quality-lossless]
依赖 Pillow。
"""
import argparse
import os
import sys

from PIL import Image


def main(argv):
    ap = argparse.ArgumentParser(description="由 atlas.png 生成无损 atlas.webp")
    ap.add_argument("--atlas", required=True, help="图集前缀（不含 .atlas.png）")
    args = ap.parse_args(argv)

    src = args.atlas + ".atlas.png"
    dst = args.atlas + ".atlas.webp"
    if not os.path.exists(src):
        print(f"缺 {src}", file=sys.stderr)
        return 2
    img = Image.open(src).convert("RGBA")
    img.save(dst, "WEBP", lossless=True)
    print(f"{dst}: {img.width}x{img.height} {os.path.getsize(dst)}B")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
