# 公开实现调研：桌宠/AI agent 形象到底怎么做（2026-11-01）

> 上一轮我给的是"自己想到的两种做法"（vtracer 描摹、像素网格）。这轮去读了**真实在用的实现源码**，
> 结论是：**该抄的是它们的数据结构与状态机，不是我拍的脑袋设计**。下面每条都标了出处与我能复跑的证据。

## 1. 读到的四个实现（含源码/文档出处）

### 1.1 oneko.js —— 最小可用的网页桌宠（读了源码全文）

来源：[adryd325/oneko.js](https://github.com/adryd325/oneko.js)（`oneko.js` 全文，约 300 行）

可抄的六条：

| 做法 | 实现细节 |
|---|---|
| **图集 + 格坐标** | 一张 `oneko.gif`，每格 **32×32**；`spriteSets` 里记的是**负格坐标** `[col,row]`，渲染只改 `background-position:${col*32}px ${row*32}px` |
| **状态 = 行** | `idle / alert / tired / sleeping / N / NE / E / …` 每个状态是一组帧坐标（有的 1 帧，有的 2–3 帧） |
| **帧率不追高** | `requestAnimationFrame` 里 **>100ms 才走一帧**（≈10fps），像素宠物不需要 60fps |
| **低频随机 idle** | `idleTime>10` 且 `Math.random()*200==0`（约每 20s 一次）才随机挑 `sleeping/scratchSelf/scratchWall*`，并**根据当前贴边位置**选变体 |
| **工程细节** | `pointer-events:none`、`image-rendering:pixelated`、`aria-hidden`、`prefers-reduced-motion` **直接不启动**、位置存 `localStorage` |
| **追逐行为** | 距光标 <48px 就进入 idle；否则按八方向取整移动，并 clamp 在视口内 |

### 1.2 pet4claude —— **和我们的场景一模一样**（桌宠跟随 AI agent 状态）

来源：[codeberg xchacha20-poly1305/pet4claude `scripts/pet_daemon.py`](https://codeberg.org/xchacha20-poly1305/pet4claude/raw/branch/dev/scripts/pet_daemon.py)

这是本轮最有价值的发现：它就是个"跟着 Claude/Codex 会话状态变表情的桌宠"，而且代码注释把设计写清了。

| 做法 | 实现细节（原文语义） |
|---|---|
| **三层状态机 + 优先级** | `drag_state > oneshot_state > base_stack[-1]`；`base_stack` 是**循环区间的栈**，栈底永远 `(None,"idle")` **且永不弹出** |
| **事件开/关区间** | 三张表：`INTERVAL_OPEN`（事件→压入哪段循环）、`INTERVAL_CLOSE`（事件→要关掉**哪些 opener**开的区间）、`ONESHOTS`（事件→放一次就回落） |
| **嵌套靠"遇到不匹配就停"** | `_close_intervals` 从栈顶往下弹，一遇到不在 close_set 里的 opener 就停 ⇒ 外层区间不会被内层结束误杀 |
| **oneshot 优先且自动回落** | 放完一轮后回落到 `base_stack[-1]`，不是回 idle |
| **逐帧时长** | 每个动画有自己的 `durations[]`（不是统一帧率）：`current_duration_ms()` 取当前帧 |
| **图集契约** | `pet.json` 里声明 `CELL_W/CELL_H/ATLAS_W/ATLAS_H`，图集按 `(col=frame, row=state)` 裁剪；**尺寸不符会打日志** |
| **点击 vs 拖拽** | `LONG_PRESS_MS=220`、`DRAG_VEL_THRESHOLD=4`：按下后移动超阈值或长按超时=拖拽（`running-left/right`），否则松手=点击（`jumping` oneshot） |
| **会话生命周期** | 跟踪 `session_id → (parent_pid, agent_type)`；每 5s 用 `os.kill(pid,0)` **收割死会话**（Codex 没有 SessionEnd）；最后一个会话结束后**延迟 900ms 才退出**（刚好放完挥手） |
| **窗口形态** | frameless + always-on-top + 不接受焦点 + 半透明；内部 label `WA_TransparentForMouseEvents`（点不挡） |

### 1.3 zhizhiji-shimeji —— shimeji 家族的行为层（只读到架构页标题级，正文被 GitHub 页面壳截断）

来源：[YuZhu412/zhizhiji-shimeji CODE_ARCHITECTURE.md](https://github.com/YuZhu412/zhizhiji-shimeji/blob/main/CODE_ARCHITECTURE.md)（**未取证到正文**，所以只当"行为分层"这一条的旁证，不当依据）。

### 1.4 DiceBear —— 部件库/声明式风格（上一轮已读）

来源：[DiceBear definition schema](https://www.dicebear.com/create-styles/definition-schema/)：`canvas` + `components`(可随机部件) + `colors`，纯声明式，渲染逻辑在核心。

## 2. 我改了什么（全部落成代码 + 测试）

### 2.1 图集（atlas）取代"每状态一个 SVG"

`tools/make-atlas.mjs`：一张 24×24 底图 → 程序化派生 3 行 × 2 列（`idle` 正常/眨眼、`busy` 上移 1–2px、
`alert` 加叹号）→ 输出**单张 `pixel/atlas.svg`** + `pixel/atlas.json`（`cell/cols/rows/states[{row,durations}]`）。
体积：**47.4 KB raw（6 格）**，仍全部是 `<rect>`，可整份 gzip 压。

### 2.2 播放器（照 pet4claude 的三层语义）

`src/sprite-player.mjs`：纯函数（无 DOM/定时器），实现
`drag > oneshot > base_stack[-1]`、`INTERVAL_OPEN/CLOSE/ONESHOTS` 三张**数据表**、逐帧 `durations[]`、
`reducedMotion` 冻结首帧。**9 条测试**，其中三条负向控制：栈底哨兵不可弹、结束事件不能误杀外层区间、
未知事件必须返回 false 而不是静默改状态。

> 我第一版把 `close` 表写成"状态名"（`'busy'`），测试立刻抓到：栈里存的是**opener 事件名**，
> 不是状态名。这正是抄真实实现的价值——它的语义比我拍的多一条约束。

### 2.3 我们原本缺的（这次补上的部分）

| 缺口 | 之前的做法 | 现在的做法 |
|---|---|---|
| 嵌套（任务里嵌工具） | 平铺映射，表达不了"叠了几层" | 区间栈，测试覆盖嵌套与误杀 |
| 瞬时动作（报错闪一下） | 只有静态 class | `oneshot` 行 + 自动回落 |
| 帧时长 | 全局统一 CSS 动画时长 | 逐帧 `durations[]`，可慢可快 |
| 点击/拖拽区分 | 无 | 阈值方案（220ms / 4px）——等待接线 |

## 3. 还没抄的（明确列出，别假装完成）

1. **会话生命周期收割**（`os.kill(pid,0)` 每 5s）：我们是 web 场景，等价物是 `pet-status` 的会话数，已有；
   但"最后会话结束后延迟 N ms 收摊"没有做。
2. **逐工具的宠物切换**（`per-tool pet`）：我们只有一套形象，暂时不需要。
3. **八方向朝向移动**：我们不做追逐光标（浮层固定在右下角），故不适用。
4. **shimeji 的物理（重力/抛掷/爬边）**：需要独立窗口与物理层，超出"挂件"范围。

## 4. 一句话结论

公开实现的做法高度一致：**行=状态、列=帧、一张图集、三张事件表、一个带优先级的栈**。
我们的形象能不能"像参考图"取决于美术（描摹/手绘像素），而**能不能"对"取决于这个状态机**——
后者才是我们之前真正缺的、也是这轮补上的东西。

## 5. 接线结果（2026-11-01 10:2x，浏览器实测）

`dsh-os-seams` 的浮层已从"12 个矢量 persona + 平铺 class"换成**像素图集 + 三层状态机**（提交 `d87b5bf`）：

| 判据 | 实测 |
|---|---|
| 图集按 (col,row) 裁格 | `viewBox="0 24 24 24"`（busy 行第 0 帧），`shape-rendering="crispEdges"`，48×48 |
| 帧会走（no-preference） | 24 次采样见到 4 种格 `0:0 / 0:1 / 1:0 / 1:1`，**20 次切换**（含 idle 眨眼帧） |
| reduced-motion | `data-sprite=static`，**只随状态换行、不循环帧**（"不知道"不会假装在动） |
| 状态驱动 | `data-state=busy` 由 `pet-status.activity` 推来；事件表在 `status-to-events.mjs`，5 条测试含 2 条负向控制 |
| 单源 | 插件里的 `atlas.gen.mjs` / `sprite-player.mjs` 都是**生成物**（源在真源仓），生成期有门禁 |

**我自己在这一步踩的坑**：把 `setTimeout` 的返回值当时长读（`timerRef.current?.durationMs` 恒 `undefined`），
`tick(0)` 于是永不换帧——表现是"看起来在动其实没动"。已改成 `lastDurRef` 存上一帧时长。

还剩的接线（明确未做）：点击/拖拽阈值（220ms / 4px）与"最后会话结束后延迟收摊"。
