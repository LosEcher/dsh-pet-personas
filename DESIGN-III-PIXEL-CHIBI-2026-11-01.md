# 34px 挂件该用的不是"缩小的插画"，是**按目标尺寸画的像素 chibi**（2026-11-01 实测）

> 你的质疑成立：34px 下**不同形象确实有差别**，所以我上一轮说的"34px 看不出睫毛所以手写无所谓"
> 是错的——真正的问题不是"看不出细节"，而是**在 34px 上该怎么设计**。这里给实测对比。

## 1. 六种做法在 34px 的实际观感（同一台机器、同一张参考图）

| 做法 | 观感 | 结论 |
|---|---|---|
| 手绘矢量 120×120 → 34px | 一团糊，认不出是"蓝发女仆" | ❌ 最差：矢量细节在缩小时互相打架 |
| **把插画直接缩到 24px** | 糊成一坨（眼睛和头发混在一起） | ❌ **降采样 ≠ 像素画** |
| 像素 24×24 → 34px（非整数缩放） | 能认出人，但有 1px 抖动 | ⚠️ 需整数缩放 |
| **像素 24×24 原始尺寸** | 干净、锐利、可辨 | ✅ 小尺寸正解 |
| **像素 ×2 = 48px（整数）** | 最舒服：能看清发色/白褶边/围裙 | ✅✅ 挂件建议 48px |
| 肖像档（描摹，669KB） | 120px 下就是原图 | ✅ 但**不能**塞进 34px |

对比图：`preview-34px-comparison.png`（六个格子并排）。

## 2. 为什么"降采样"会糊，"按尺寸画"才锐

像素画的读法靠三件事，且都必须在**目标尺寸上重新设计**：

1. **1px 描边**把轮廓与背景分开；
2. **2–4px 的眼睛**（占脸的 1/3），不画睫毛不画高光；
3. **单一剪影 + 一个标志物**（鲸尾 / 向日葵 / 独角），颜色 6–8 个。

把 960px 插画缩到 24px，等于让 400 条路径去抢 576 个像素——每条都分不到一个像素，于是糊。
（我实测过：`px24` 就是一团，见对比页最右格。）

## 3. 本轮产物（可复跑）

```
pixel/whale-maid.txt   24×24 ASCII 网格（. 透明 / o 描边 / h 深发 / H 亮发 / w 褶边 / s 肤 / e 眼白 / p 瞳 / d 裙 / a 围裙）
pixel/whale-maid.svg   24×24，141 个 rect，7.8 KB raw / 823 B gzip
tools/pixel2svg.mjs    网格 → SVG（行内同色 run 合并；网格不合法即 exit 1）
test/pixel.test.mjs    7 用例：等高宽 / 未知字符 / run 合并 / 透明不出 rect / 体积预算
```

复跑：`node tools/pixel2svg.mjs pixel/whale-maid.txt pixel/whale-maid.svg && npm test`

**为什么用 `<rect>` 手写而不是 `<image>` 嵌 PNG**：仍然保持"纯矢量、可换色、可 diff"。
同色连续像素合并后 24×24 只要 141 个节点；不做合并会膨胀 3 倍以上（有负向控制用例守着）。

## 4. 三条可参考的公开资料

1. **pixel-art-sprites 技能参考**（像素角色的画法清单）：[skills/pixel-art-sprites](https://github.com/absolutelyskilled/absolutelyskilled/blob/57ca1866b8b4ea31a23a0971d70814826c2db6f6/skills/pixel-art-sprites/SKILL.md)
   —— 强调"目标尺寸设计、调色板上限、1px 轮廓、剪影优先"。
2. **2D 角色设计技能**（先定剪影与标志物，再抠细节）：[gamedev-2d-art-character-design](https://raw.githubusercontent.com/claude-dev-suite/claude-dev-suite/refs/heads/main/skills/gamedev/2d-art/character-design/SKILL.md)
3. **pix2svg**（像素图 → SVG 的贪心矩形合并，正是本仓 `pixel2svg.mjs` 的做法）：[LeSnow-Ye/pix2svg](https://github.com/LeSnow-Ye/pix2svg)

另：如果要"别人画好的"像素角色，可用 **CC0 素材集**（如 [spritecook-free-game-assets](https://github.com/cellinlab/spritecook-free-game-assets)）——
但那些是"通用勇者/村民"，不是"你的设定形象"；要像自己的角色，仍得按 §3 的网格自己画（或先描摹再人工像素化）。

## 5. 结论：三档，各用各的尺寸纪律

| 档 | 尺寸 | 做法 | 体积 |
|---|---|---|---|
| **像素 chibi** | 24 或 48（**整数缩放**） | 按目标尺寸手画网格 → `pixel2svg` | 7.8 KB / 823 B gzip |
| **矢量图标**（原 personas） | 120 → 34 缩放 | 手写分层矢量 | 5 KB |
| **肖像** | 120–480 | vtracer 描摹参考图 | 669 KB / 217 KB gzip |

**挂件改成 48px 像素档**（不是 34px 缩矢量）是这轮最直接的改法：
`PetStatusOverlay` 里把 `<span class="av av-pet">` 的尺寸从 34 改成 48，并挂 `image-rendering: pixelated`；
像素档 persona 走 `pixel/*.svg`，肖像档走设置页大图。
