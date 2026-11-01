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
test/*.test.mjs         72 用例（映射/结构/注册表 + 状态图守卫 + 反应/持续闸门）
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
- **闸门只管一次性动作，不改事实**（`src/pet-gates.mjs`）：
  `admitsAlert` 要求"这次失败站够久"（默认 2 分钟；拿不到时长则要求连续两条）才配弹
  ——单次采样不足以下结论；`createReactionGate` 让相邻反应有间隔、同一动作有冷却。
  **区间事件（task.start/task.end…）永不过滤**：漏一条 task.end，状态栈就再也弹不回去。
- 新增形象 = 加一个 `personas/<id>.svg` + `index.json` 一条 + `avatar-state.mjs` 的 `PERSONAS`；
  `index.json` 与 SVG 不一致会让**插件生成期**直接失败（这是刻意的）。
