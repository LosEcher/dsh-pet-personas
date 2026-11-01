# dsh-pet-personas

> **非官方**：个人桌宠形象实验，不含任何厂商官方素材，也不代表其立场。
> 参考原图（`ref/`）**刻意不入库**，原因见 [ASSETS.md](ASSETS.md)。

DSH 助手形象（persona pack）的**唯一真源**：SVG 形象 + 状态映射 + 浏览器 demo。

消费者是 `dsplugins/dsh-os-seams` 的宠物浮层：它用 `scripts/gen-persona-assets.mjs` 读本仓的
`personas/*.svg` 与 `avatar-state.mjs`，生成内联模块并**在生成期过门禁**（4 表情组 / 120×120 /
无外链 / 无第三方标识 / index.json 与 SVG 一一对应）。所以本仓是源，插件里那份是**生成物**。

## 布局

```
avatar-state.mjs        状态 → 表情/姿态/class 的唯一映射（纯函数，9 用例）
personas/*.svg          12 个形象，每个 120×120，含 happy/worry/confused/focused 四表情组
personas/index.json     形象包注册表（label / parts / motion / voice / ipNote）
persona.css             demo 用样式（浮层里有自己的等价样式）
demo.html               本地 demo：4~12 形象 × 三维 × 交互
test/*.test.mjs         87 用例（映射/结构/注册表 + 状态图守卫 + 闸门 + 帧节奏/像素 + CSS 契约 + 语气/事实）
preview-*.png           浏览器实测截图
```

## 形象清单

| id | 形象 | 特征 |
|---|---|---|
| `cat` / `dog` / `lion` | 猫 / 狗 / 小狮子 | 通用动物原型 |
| `clip` | 回形针 | 通用纸夹（不复刻任何办公助手吉祥物） |
| `chibi` | Q 版助手 | 分层人形骨架 demo |
| `whale-maid` … `grok-maid` | 7 个「AI 女仆」设定形象 | 按参考图**抓特征**自绘：蓝发鲸尾 / 独角白 / 星星紫 / 黑白 / 向日葵橙 / 执扇深蓝 / 小恶魔金 |

「AI 女仆」系列的依据：用户确认这些是其 **AI 生成的设定形象，可自由使用**；
本仓的 SVG 是**按特征重绘**（不是位图搬运），文件内不含第三方商标或角色名。

## 复跑

```bash
node --test "test/*.test.mjs"      # 72 pass
python3 -m http.server 8791        # 然后开 http://127.0.0.1:8791/demo.html
```

## 约定

- 表情只能由 `health` 决定：`ok→happy / attention→worry / unknown→confused`；
  **unknown 永不 happy**（点一下也不行），缺字段一律 unknown。
- **「判不了」在播放器里是一层常驻覆盖**（`status.unknown` → `sticky`），不是一次性动作：
  否则没有任何事件能进入 atlas 的 `unknown` 行，宠物会画成 idle 的"睁眼在岗"。
  `test/state-graph.test.mjs` 用纯数据守住四件事：表引用的 state 在图集里、每个 state 都可达、
  每个 opener 都被 close 收、sticky 一定有清空入口。
- 交互只改表现：hover 抬升、点击气泡、`prefers-reduced-motion` 下无位移。
- **帧节奏有唯一真源**（`pixel/art/pet-cadence.json`）：`tools/slice-sprite-sheet.py` 把它写进
  `*.atlas.json`，测试断言两边一致。旧做法是**所有状态共用 `[1800,140]`**——等于放弃"节奏表达状态"
  （睡眠和打字一样快）。现在是 idle 1.8s 眨眼 / busy 520ms 打字 / alert 700ms 惊两次 / sleep 2.6s 慢 Z /
  happy 420ms 心跳一下 / unknown 单帧静置。数字按本仓两帧图集与 48px 显示尺寸重推（参照 vscode-pets
  的"每状态独立 GIF、帧率各不同"这一机制，不照搬其帧率）。
- **引用的帧必须非空**（`test/atlas-cadence.test.mjs` + `test/png-alpha.mjs`）：零依赖读 PNG alpha，
  断言①每状态引用的列非空、②非空列必须被引用。起因是 `unknown` 第二格 α=0 而 durations 走了两帧 ⇒
  宠物在"判不了"状态下**每 1.94 秒消失 140ms**。读像素用自带的 Node 解码器，不依赖本机装了哪个 venv。
- **动效属性归属表**（`persona.css` 顶部注释 + `test/persona-css.test.mjs`）：pop 只动 `scale/opacity`，
  状态动效只动 `translate/rotate`，朝向只动 `transform`。旧写法里 `[data-state] .av-sprite` 的
  `animation` 把 `.av-sprite` 的 pop **整条覆盖**（4 个状态从来没有过渡动画），现在每个状态规则都必须
  带 `var(--av-pop)`，且由测试机械咬住。
- **朝向**：拖拽时按水平位移方向写 `--av-face:-1`，`.av-sprite { transform: scaleX(var(--av-face,1)) }`
  （照 vscode-pets 的 faceLeft/faceRight；带 6px 死区，手抖不翻身）。
- **语气层与事实层分开**（`src/pet-voice.mjs`）：状态 → 宠物口吻的句子，但**句子里出现的数字/工具名/次数
  必须来自传入的 `facts`**（`tools` / `runningSessions` / `failingRuns` / `sustainedMs` / `approvalPending` /
  `night`）；事实缺席就整段去掉，不留"手上是 "这种空壳，也绝不猜一个数填上。unknown 永远不许安慰。
  - **风格**：`persona` 决定用词习惯（女仆/鲸鱼各一套）；**语气档** `tone` 三档
    `auto`（跟形象）/`plain`（只报事实、不演）/`playful`（加称呼与语气词）。任何档位下**事实不变**。
  - 轮换靠 `seq` 不靠随机 ⇒ 可断言（给定 seq 得到确定句子）。
- **素材"信息密度"要用起来**（`pinColumnForState`）：`alert` 两格其实是两档严重度（`！`/`！！`），
  `busy` 两格是「抱电脑/抬头」。按**事实选列**而不是循环播——否则"轻微/严重"会每 1.94 秒抖一次。
- **闸门只管一次性动作，不改事实**（`src/pet-gates.mjs`）：
  `admitsAlert` 要求"这次失败站够久"（默认 2 分钟；拿不到时长则要求连续两条）才配弹
  ——单次采样不足以下结论；`createReactionGate` 让相邻反应有间隔、同一动作有冷却。
  **区间事件（task.start/task.end…）永不过滤**：漏一条 task.end，状态栈就再也弹不回去。
- 新增形象 = 加一个 `personas/<id>.svg` + `index.json` 一条 + `avatar-state.mjs` 的 `PERSONAS`；
  `index.json` 与 SVG 不一致会让**插件生成期**直接失败（这是刻意的）。
