#!/bin/bash
# trace-persona.sh — 把一张 AI 生成的角色图**矢量化**成"肖像级" SVG（不是挂件级）。
#
# 为什么需要这条管线（2026-11-01 实证）：手写 20~40 个图元**画不出**参考图的动漫平涂光泽、
# 睫毛与裙褶层次 —— 那是几百条路径的信息量。想要"像"，只能让工具去描线，而不是让人去猜路径。
#
# 依赖：vtracer（cargo install vtracer）、rsvg-convert（brew install librsvg）、python3 + pillow
#
# 用法：tools/trace-persona.sh <输入图> <输出名> [--crop-bottom 0.20] [--keep-white]
# 产物：portraits/<名字>.traced.svg（矢量）+ portraits/<名字>.traced.preview.png（480px 预览）
#
# 参数取舍（实测，输入 960×960 的 Q 版立绘）：
#   -p 6 -f 12 → 845 KB raw / 281 KB gzip
#   -p 5 -f 12 → 669 KB raw / 217 KB gzip   ← 默认（画质肉眼无差，体积小 20%）
#   --preset poster → 2004 KB（过度保留噪声，不用）
#   ⚠️ vtracer 0.6.5 在 -f 20/24 时会 panic（RUST_BACKTRACE 提示）⇒ 别把 speckle 调太大
set -uo pipefail
IN="${1:?需要输入图}"; NAME="${2:?需要输出名}"; shift 2
CROP_BOTTOM=0
KEEP_WHITE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --crop-bottom) CROP_BOTTOM="$2"; shift 2 ;;
    --keep-white) KEEP_WHITE=1; shift ;;
    *) echo "未知参数 $1" >&2; exit 2 ;;
  esac
done
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/portraits"; mkdir -p "$OUT_DIR"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PY="$(command -v python3)"
VTRACER="${VTRACER:-$HOME/.cargo/bin/vtracer}"
RSVG="${RSVG:-/opt/homebrew/bin/rsvg-convert}"
[ -x "$VTRACER" ] || { echo "缺 vtracer（cargo install vtracer）" >&2; exit 2; }
[ -x "$RSVG" ] || { echo "缺 rsvg-convert（brew install librsvg）" >&2; exit 2; }

"$PY" - "$IN" "$TMP/cut.png" "$CROP_BOTTOM" "$KEEP_WHITE" <<'PY'
import sys
from PIL import Image
src, out, crop_bottom, keep_white = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4] == '1'
im = Image.open(src).convert('RGBA')
w, h = im.size
if crop_bottom > 0:                     # 去掉底部字幕/水印带
    im = im.crop((0, 0, w, int(h * (1 - crop_bottom))))
if not keep_white:                      # 白底转透明（粗版背景分割；需要更好效果请换 rembg）
    px = im.load(); W, H = im.size
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if r > 236 and g > 236 and b > 236:
                px[x, y] = (255, 255, 255, 0)
im.save(out)
print('prepared', im.size)
PY

"$VTRACER" -i "$TMP/cut.png" -o "$OUT_DIR/$NAME.traced.svg" -p 5 -f 12 --path_precision 2 -m spline --hierarchical stacked
"$RSVG" -w 480 "$OUT_DIR/$NAME.traced.svg" -o "$OUT_DIR/$NAME.traced.preview.png"
RAW=$(( $(stat -f%z "$OUT_DIR/$NAME.traced.svg") / 1024 ))
GZ=$(( $(gzip -c "$OUT_DIR/$NAME.traced.svg" | wc -c) / 1024 ))
echo "portraits/$NAME.traced.svg  raw=${RAW}KB gzip=${GZ}KB"
[ "$GZ" -le 300 ] && echo "✅ 在肖像级预算内（gzip ≤300KB）" || echo "⚠️ 超预算（gzip >300KB）：提高 -p 降低精度或裁小画布"
