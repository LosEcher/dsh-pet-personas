# 你给的 `Pixel Whale Maid Sprite Sheet.png` 怎么处理（2026-11-01）

## 1. 这张图是什么

- 1254×1254 RGBA，**透明底**（α 通道干净，不用抠白底）。
- 左边是 **11 个角色帧**（2 列 × 6 行，最后一行只有 1 个）；右边是**带 `pet.json` 的规格面板**。
- 每个角色在原图里约 **250×204 px**，而 `pet.json` 声明 `cell:[48,48]`、`atlas:[96,288]`
  ⇒ 这是一张**给人看的放大预览图**（约 4.3 倍），不是可直接切的原生 atlas。

## 2. 为什么不能直接按格切

我先按"裁 2×6 等分"试过，结果是**行错位、角色被压扁**。根因两个：

1. **格距与角色包围盒不重合**：横向两列中心距 ~386px，纵向行距 ~208px，而角色本身 ~250×204；
2. **相邻格的装饰会连成一块**：`busy` 行的"电脑/点赞"两格的装饰线相连，连通域分析给出一个
   跨两行的大块（h=412），按连通域切必然把两个角色塞进一格。

## 3. 实际用的切法（`tools/slice-sprite-sheet.py`）

1. α>128 做掩膜；用 `--right-cut 800` 把右侧 `pet.json` 面板排掉；
2. 连通域只用来**估格距**（取全部块的行/列范围），**不用来定边界**；
3. 按等间距格带（6 行 × 2 列）逐格**重新求格内的 α 包围盒** → 居中裁成正方形 → LANCZOS 缩到 48×48；
4. 统一 α 阈值（≥110 才保留），逐格量化到 24 色并拼成 `96×288` atlas；
5. 写 `atlas.json`（`cell/atlas/states[row,durations]`，行序 = idle/busy/alert/sleep/happy/unknown）。

## 4. 踩到的两个真问题（都有量化证据）

### 4.1 量化会把"语义色"抹掉

| 做法 | alert 行暖色像素（源图 5106） | PNG | WebP |
|---|---|---|---|
| 逐格 MEDIANCUT 24 色 | **0** | 26.4 KB | 7.8 KB |
| 逐格 MEDIANCUT 48/64 色 | **0** | 35–38 KB | 9.7–10.6 KB |
| 全局 MEDIANCUT 32 色 | **0** | 40 KB | 15.7 KB |
| **全局 MAXCOVERAGE 32 色** | **159** ✅ | 23.2 KB | **7.4 KB** |

MEDIANCUT 按像素数量分配调色板，"橙/红感叹号"这种**又小又饱和**的颜色分不到名额，直接被并进灰蓝——
而那正是"出事"这个状态的唯一视觉载体。已改用 **MAXCOVERAGE**，并在脚本里加了门禁：
**该行暖色像素被抹成 0 就 exit 1**（比例低不算失败：源图是 4.3 倍放大，暖色像素本就被抗锯齿摊薄）。

### 4.2 抖动会毁掉压缩

`dither=NONE` 必须显式设：开启抖动时同一张图 PNG 40 KB / WebP 15.7 KB，关掉后 23 KB / 7.4 KB。

## 5. 产物

```
pixel/art/whale-maid-sheet.atlas.png    96×288，23.2 KB
pixel/art/whale-maid-sheet.atlas.webp   **7.4 KB**（无损，data-URI 后 ~9.9 KB）
pixel/art/whale-maid-sheet.atlas.json    cell/atlas/states[row,durations]
pixel/art/whale-maid-sheet.preview.png  4× 放大预览（肉眼核对用）
tools/slice-sprite-sheet.py             可复跑：--cell/--rows/--cols/--right-cut/--colors
```

## 6. 已接进真实浮层（浏览器实测）

`dsh-os-seams` 的浮层改为**栅格 atlas + `background-position`**（oneko.js 同招）：

| 判据 | 实测 |
|---|---|
| 显示 | 48×48，`image-rendering: pixelated` |
| 裁格 | `background-size: 96px 288px`，`background-position: 0px -48px`（busy 行） |
| 帧循环 | 采样见到 `1:0` / `1:1` 两帧交替 |
| 素材 | `data:image/webp;base64,UklGR…`（真 WebP） |
| 体积 | atlas 7.4 KB（此前手绘矢量图集 47.4 KB） |

## 7. 下次给素材的最短路径

**只要一张原生的 96×288 PNG（或 WebP），cell 48×48、透明底、行=状态**——那我连切都不用切，
`tools/slice-sprite-sheet.py` 可以直接跳过，生成器直接读它就是 atlas。你这张是"放大预览图"，
所以中间多了切格 + 缩放 + 量化的三步（每步都有可测的损失风险）。

## 8. 为什么"还是糊"——不是像素低，是我们丢了 2 倍分辨率（2026-11-01 实测）

先给结论：**48px 素材 + 2× 屏幕 = 主动浪费一半分辨率**。浮件在 CSS 里确实只有 48px，
但本机 `devicePixelRatio = 2`，浏览器实际有 **96×96 个设备像素**可用。我们发的是 48×48 的图，
浏览器只能把它放大一倍铺满那 96 个像素 ⇒ 每 2×2 个设备像素是同一个色块，看起来就是"糊 + 马赛克"。

| 做法 | 上屏效果（2× 屏，96×96 设备像素） | 体积 |
|---|---|---|
| 48px atlas，放大 1× | 糊块，眼睛/发丝糊成一团 | 7–10 KB |
| **96px atlas，0.5 缩放到 48 CSS px** | **1 个素材像素 = 1 个设备像素，细节回来** | 29–34 KB |
| 96px atlas + `pixelated` | 半像素对齐会抖，反而更糟 | 29–34 KB |

实测（浏览器内取样式）：`devicePixelRatio=2`、元素 `48px×48px`、`background-size: 96px 288px`
（= 192×576 的 atlas 按 0.5 缩放）、`image-rendering: auto`。截图里能看清笔记本、眼睛、头发高光。

### 8.1 顺带修掉的第二个"糊"来源：采样方式

原来用 LANCZOS 平均缩小 ⇒ 源图 4~5 个像素被平均成一个，颜色互相调和，边缘出现灰过渡。
改成 **众数采样（majority）**：每个目标像素取源块里出现最多的不透明颜色 ⇒ 每像素都是纯色、边缘硬。
`tools/slice-sprite-sheet.py --sampler {area,majority,nearest}`，默认 `majority`。

对比（同一格 3× 放大）：`area` 最柔最灰、`majority` 边缘硬但更暗、`majority+16 色` 最"像素画"、
`majority+10 色` 已经丢脸（眼睛和头发并成一片）。**选 majority + 32 色**：硬边 + 保留五官。

### 8.2 所以"像素低就是这样么"——分三层回答

1. **48px 确实低**：48×48 里给脸只有 ~30×30，眼睫毛这一级细节物理上放不下（这是真的）。
2. **但我们之前连这 48px 都没用满**：屏幕上明明有 96 个设备像素，发的是 48px 图（第一节）。
3. **而且缩小时又平均了一次**：软边被平均成更软的边（第二节）。

三层都修完，现在的观感才是"48 CSS px 能给的极限"。要再清楚，只能改**尺寸**或**美术**：
- 把浮件做到 64–72 CSS px（Retina 下 128–144 设备像素）；
- 或者让美术按 96 网格直接画（而不是把 200px 的图缩小）。

### 8.3 现在的产物与复跑

```
pixel/art/sources.json         每个 persona 的切图参数（grid/sampler/colors/rightCut）
pixel/art/*.atlas.{png,webp}   cell=96，2 列 × 6 行（192×576），无损 WebP 29–34KB
npm run atlas:all              按清单重切全部（需要 Pillow+numpy 的 python）
```

测试预算随之调整：`test/atlas.test.mjs` 的体积上限 16KB → **40KB**（为 Retina 付的钱，
注释里写了原因，避免后人"优化"回去）。

## 9. 状态接线 / 过渡 / 文案（2026-11-01 第二轮）

之前只有 idle/busy/alert 三个状态在用，atlas 里的 `sleep` / `happy` 两行是**切好了但没接线**。
这轮补齐：

| 项 | 现在的行为 | 判据 |
|---|---|---|
| **sleep** | 90 秒没有任何状态变化 ⇒ 压一层 `sleep` 区间；任何状态变化立刻 `idle.wake` 叫醒 | `idleEvent()` 单测 4 条（含"继续不动不重复触发"） |
| **happy** | `busy→idle`（干完一件活）与 `attention→ok`（恢复了）各放一次 `happy` oneshot，放完回落 | `eventsFor()` 单测（含"attention 期间变闲不放 happy"的负向控制） |
| **过渡** | 状态切换时 `av-sprite-pop` 160ms 小弹跳（scale 0.92→1.03→1）；靠 React `key` 变化重放，不靠计时器 | 浏览器实测 `animation: 0.16s ease-out av-sprite-pop` |
| **reduced-motion** | 弹跳与逐帧推进都关掉，但**状态换行照旧**（不会因为省动效就变成一直 idle） | CSS `@media` + hook 里不启动计时器 |
| **文案** | `pet-voice.mjs`：每状态 3 句轮换；`unknown` 只能说"看不清/读不到/判不了"；hover 时显示宠物口吻，静止显示服务端事实文本 | 单测断言 unknown 不含"正常/没事"，且轮换生效 |

**为什么 happy 不能每次轮询都放**：pet-status 每 30s 轮询一次，如果"idle 就 happy"那就是一直抽搐。
只在**跳变**触发，且 `attention→idle` 不放（那是"出过事又闲了"，不是干完了）。

**文案与事实分家**：气泡的"事实"（几个会话在跑、源是什么时间）始终来自 `display.text`；
`pet-voice` 只负责语气。两处都不许编数字——否则同一件事在两个地方对不上。
