#!/usr/bin/env python3
"""png2svg.py — 把**已经是像素画**的 PNG（1:1，无缩放）转成等价的 SVG（run 合并的 <rect>）。

为什么不用 vtracer：像素画不需要描摹曲线，逐像素矩形化是**无损**的（色值、边界都对），
而且产物可 diff、可换色。为什么用 Python：只依赖 Pillow 的 PNG 解码，比在 Node 里手写
PNG 解压 + filter 反演更不容易出错（那边要处理 5 种 filter 与交错）。

用法：tools/png2svg.py <in.png> <out.svg> [--alpha-threshold 128] [--max-colors 0]
退出码：0 成功 / 1 输入不是像素画（颜色数超限）/ 2 参数错误
"""
import sys
from collections import Counter
from PIL import Image


def main(argv):
    if len(argv) < 3:
        print('用法: png2svg.py <in.png> <out.svg> [--alpha-threshold N] [--max-colors N] [--quantize N]', file=sys.stderr)
        return 2
    src, dst = argv[1], argv[2]
    alpha_thr = 128
    max_colors = 0
    quantize = 0
    i = 3
    while i < len(argv):
        if argv[i] == '--alpha-threshold':
            alpha_thr = int(argv[i + 1]); i += 2
        elif argv[i] == '--max-colors':
            max_colors = int(argv[i + 1]); i += 2
        elif argv[i] == '--quantize':
            quantize = int(argv[i + 1]); i += 2
        else:
            print('未知参数 ' + argv[i], file=sys.stderr); return 2

    im = Image.open(src).convert('RGBA')
    w, h = im.size
    if quantize:
        # AI 出的"像素风"图往往是降采样后的多色噪声，必须先把颜色压到调色板大小，
        # 否则逐像素矩形化会得到几千个 1px 矩形（体积爆炸且视觉更脏）。
        alpha = im.split()[3]
        rgb = im.convert('RGB').quantize(colors=quantize, method=Image.MEDIANCUT).convert('RGBA')
        rgb.putalpha(alpha.point(lambda a: 255 if a >= alpha_thr else 0))
        im = rgb
    px = im.load()
    colors = Counter()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a >= alpha_thr:
                colors[(r, g, b)] += 1
    if max_colors and len(colors) > max_colors:
        print('不是像素画：%d 种颜色 > %d（先量化）' % (len(colors), max_colors), file=sys.stderr)
        return 1

    # 2D 贪心合并：先按行做 run，再把"同 x、同宽、同色"的上下相邻 run 并成一块。
    # 只做行内合并时 48×48 会出 ~1150 个 rect（66KB）；2D 合并后通常降到 1/3 以下。
    grid = [[None] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            grid[y][x] = (r, g, b) if a >= alpha_thr else None

    rects = []
    used = [[False] * w for _ in range(h)]
    for y in range(h):
        x = 0
        while x < w:
            c = grid[y][x]
            if c is None or used[y][x]:
                x += 1
                continue
            x2 = x
            while x2 + 1 < w and grid[y][x2 + 1] == c and not used[y][x2 + 1]:
                x2 += 1
            width = x2 - x + 1
            yy = y
            while yy + 1 < h and all(grid[yy + 1][xx] == c and not used[yy + 1][xx] for xx in range(x, x + 1 + x2 - x)):
                yy += 1
            for ry in range(y, yy + 1):
                for rx in range(x, x2 + 1):
                    used[ry][rx] = True
            rects.append('<rect x="%d" y="%d" width="%d" height="%d" fill="#%02x%02x%02x"/>'
                         % (x, y, width, yy - y + 1, c[0], c[1], c[2]))
            x = x2 + 1

    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" shape-rendering="crispEdges">\n' % (w, h)
           + '\n'.join(rects) + '\n</svg>\n')
    with open(dst, 'w') as f:
        f.write(svg)
    print('%s  %dx%d  colors=%d  rects=%d  %d bytes' % (dst, w, h, len(colors), len(rects), len(svg)))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
