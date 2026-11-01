# 桌宠 / 助手形象：技术路线调研与形象可配置设计（2026-11-01）

> 目标：DSH 助手可以换成**人形 Q 版 / 猫 / 狗 / 回形针 / 小狮子**等形象，每种形象对同一份状态有对应的
> 表情与交互反馈；渲染要轻、可离线、可机械验收。
> 结论先说：**走"纯 SVG 分层骨架 + 形象包（persona pack）"，不要指望一次上 Live2D。**

## 1. 调研：四条主流路线与实测数字

| 路线 | 运行时 | 资产 | 交互状态机 | 50 实例帧率 | 可访问性 | 备注 |
|---|---|---|---|---|---|---|
| **纯 SVG（CSS/SMIL）** | **0 KB**（浏览器原生） | 每个形象 1–3 KB | 靠外层 class / JS 状态（要自己写，但简单） | **120 FPS** | **原生 ARIA / `<title>`** | 微交互与吉祥物解析度高；复杂骨骼变形能力弱 |
| Lottie（Bodymovin） | ~60 KB gzip | 8–45 KB JSON/条 | 时间轴 + 手工 JS | **42 FPS（掉帧）** | canvas 内需手工 aria | 设计师在 AE 里做很方便；**JSON 解析阻塞主线程**，多实例会 GC 抖动 |
| Rive | ~140 KB WASM | 1.5–8 KB `.riv` | **原生可视化状态机** | 118 FPS | canvas 内需手工 aria | 角色动画/状态机最强，代价是多一个 WASM 运行时与构建链 |
| Live2D Cubism | SDK（Web/Native…） | moc3 模型（较大） | 参数驱动 + 物理 | 高 | canvas | 二次元"会呼吸"的头部；**发行许可**是硬门槛（见 §4） |

数字来源：[SVG vs Lottie vs Rive 2026 基准](https://mail.iconstash.io/articles/svg-vs-lottie-vs-rive-animation-benchmark/)（0 KB / 60 KB / 140 KB；120 / 42 / 118 FPS）。

**判读**：我们这里是**一个常驻小挂件**，不是 50 个实例的落地页英雄区 —— 所以 Rive 的性能优势用不上，
而 SVG 的 **0 KB + 原生 ARIA + 主题令牌可继承** 三个优点全部直接吃到。这也是母仓
`DESKTOP-PET-SUPERAGENT-WIRING-2026-11-01.md` §4 选内置 SVG 的同一个理由。

## 2. 公有形象的历史经验（这类东西当年是怎么做的）

- **Office 助手（大眼夹一族）**：本质是**一张精灵图 + 动画名族**，每个助手一套帧；社区复刻版（如
  [Ar9av/clippy](https://github.com/Ar9av/clippy/commit/95d4d2df15809049bc292234b7326350a2f54b49)）做的就是
  "**可切换的 assistant sprites** + 把选择传下去"。动画名族通常可归成五类：
  **待机变体**（呼吸/眨眼/换个姿势）、**手势**（指左/指右/指向下方）、**情绪**（恭喜/疑惑/惊讶）、
  **任务态**（在写/在查/在打印）、**退场**（隐藏/道别）。
- **Shimeji 系**：把"宠物"当**有自由意志的小实体**——走、爬窗口边、被拖起来会挣扎。它的价值不在美术，
  在**行为节律**（随机发呆/随机走动/被戳反应）。
- **瑞星小狮子**：跑杀毒任务时跳舞、报毒时立起来、闲置时打瞌睡 —— 即**状态→姿态**的强映射，
  这也是我们对 `health/activity/approval` 三维做映射的同一思路。

**共同点**：这类东西的"活"来自**状态与姿态的确定性映射 + 低频随机变体**，而不是高保真渲染。
所以 SVG 完全够用，缺的是**映射表**与**节律**，不是画质。

## 3. Q 版人形能不能用 SVG 画？能，但要接受三条限制

**能做的**：分层骨架已经完全够画 Q 版（头身比 1:1.5~1:2）——
`头 / 发（前/后各一层）/ 眼（白+瞳+高光，可换形）/ 眉 / 口（3–5 个形状）/ 身（连衣裙/卫衣）/ 手（3 个姿势）/ 尾或耳（配件）`，
表情靠**替换眼/口组**，呼吸靠 `translateY` 关键帧，眨眼靠 `scaleY`，歪头靠 `rotate`。
本目录 `personas/` 里的四个形象就是这套分层法的最小实现（含 4 种表情组）。

**做不到（别承诺）**：

| 想要的效果 | SVG 的实情 | 替代 |
|---|---|---|
| 头发/裙摆的物理飘动 | 只能手写关键帧，做不好软体 | Live2D 物理 or Rive 骨骼 |
| 转身立体感 | 需要逐帧画不同角度（等于做精灵图） | VRM/3D |
| 口型对语音 | 没有音素绑定 | Rive/Live2D MotionSync |
| 4K 级细节与渐变 | 文件会变大、渲染反而慢 | 位图精灵或分层 PNG |

**所以推荐的分层**：`SVG 骨架（默认）` → 需要"更骚"时给**同一个 persona ID 挂一个可选 Lottie/Rive 渲染器**，
但**状态映射与 persona 元数据共用一份**（见 §5）。这样升级渲染器不会产生第二套状态逻辑。

## 4. 许可与 IP（这是硬门槛，不是审美问题）

| 对象 | 判定 |
|---|---|
| **Live2D** | 开发/测试阶段**无需许可**；但**正式发行**（含测试上线）前需与 Live2D 签 SDK 发行许可（出版许可协议）并付费；个人/小规模发行可**免除**许可与费用（可扩展应用除外），AI 聊天机器人另有分支流程 —— 见[官方许可页](https://www.live2d.com/zh-CHS/sdk/license/)。⇒ **内部自用可先不碰**；一旦要发布带 Live2D 的桌面版，必须先走许可。 |
| **Office 助手 / 大眼夹** | 微软的角色与商标。**不要**复刻其造型、不要用其名称做卖点。 |
| **瑞星小狮子** | 同上（瑞星的角色）。 |
| **网上公开的二次元形象** | "能下载" ≠ "可用"。同人图常见授权是"个人非商业、需署名、禁止改作"，**改作（改成 SVG/改色/换脸）恰恰是最常被禁的**。 |

**我们已经在做的事**（母仓 A4 那条纪律）：仓库与用户可见文本里**不出现厂名冠名**，
只用**通用原型**（回形针 = 纸夹、小狮子 = 动物）。本目录 `personas/*.svg` 是**自绘**，
测试里有一条硬门禁：SVG 内不得出现 `Clippy / Microsoft / 瑞星 / Rising / DeepSeek`（见 §7）。

## 5. 形象包（persona pack）契约

形象 = 数据，不是分支。一个形象包 Declarative 描述"它怎么表达"：

```jsonc
{
  "id": "cat",
  "label": { "zh": "猫猫", "en": "Cat" },
  "renderer": "svg",                 // svg | lottie | rive | sprite（同一 id 可换渲染器）
  "asset": "personas/cat.svg",
  "viewBox": [0, 0, 120, 120],
  "parts": ["head", "body", "tail", "paws"],   // 骨架部件（CSS 可单独动）
  "faces": ["happy", "worry", "confused", "focused"],
  "marks": ["exclaim"],
  "motion": { "busy": "bob-fast", "idle": "bob-slow", "none": "none" },
  "voice": { "zh": { "happy": "喵~", "worry": "喵？", "confused": "喵？？" } },
  "ipNote": "自绘通用动物；非任何厂商吉祥物"
}
```

**注册表**：`personas/index.json` 列所有包；运行时按 `persona` 切换，未知 id 回落 `cat`（与
`avatar-state.mjs` 的 `PERSONAS` 一致；测试保证二者不漂）。

## 6. 交互反馈矩阵（确定性映射 + 低频随机变体）

事实三维来自 `/os-seams/pet-status`：`health(ok|attention|unknown) × activity(busy|idle|unknown) × approval(pending|none|unknown)`。
**交互**只改表现，不改事实（点一下不会让 `unknown` 变 `ok`）。

| 触发 | 表现 | 判据（可测） |
|---|---|---|
| 待机 8–15s | 眨眼（5.2s 周期）、呼吸（busy 快 / idle 慢）、偶发换姿势（**低频随机，非持续抖动**） | `class` 含 `av-motion-bob-*`；无动画时 `av-motion-none` |
| 鼠标悬停 | 抬升 2px（`translateY(-2px)`） | `av-hover` |
| 点击 | 气泡一句话（"在的，有事说。"），**face 可临时变 happy，但 `health` 不变** | `pose.health` 与点击前相等 |
| 正在输入 | `face=focused`（眯眼/专注），不弹气泡 | `av-face-focused` |
| `approval=pending` | 右上角 `!` 标记 + 优先级最高的气泡 | `av-mark-exclaim` |
| `health=attention` | `face=worry` + 眉形下压 | `av-face-worry` |
| `health=unknown` | `face=confused` + 头顶 `?`；**绝不出现 happy** | 负向控制：`deriveAvatar({health:'unknown'},{click:true}).face === 'confused'` |
| `activity=busy` | 呼吸加快；可选"打字"小动作 | `av-body-work` + `bob-fast` |
| 长时间无变化（> 30 min） | 打瞌睡（闭眼、慢呼吸） | `av-body-sleep`（未实现，见 §8） |
| 报错/成功 | 一次性动作（抖一下 / 蹦一下），**不循环** | 一次性 class，300–600 ms 后移除 |
| `prefers-reduced-motion` | **关掉所有位移**，只保留表情切换 | CSS `@media` + JS `reduceMotion` 双保险 |

**为什么强调"低频随机"**：连续抖动会让人误以为"它在忙"，而忙/闲是有事实依据的维度 ——
随机变体只在 `activity=idle` 且无交互 8s+ 后触发，且不改变 `body` 语义。

## 7. 验收（可机械复跑）

```bash
cd <本仓根>
node --test "test/*.test.mjs"      # 15 pass：状态映射 9 + 形象结构 5 + 注册表一致性 1
```

| # | 断言 | 现状 |
|---|---|---|
| 1 | 三态 → 三表情；`unknown` **永不** happy（点一下也不行） | ✅ 负向控制 |
| 2 | 缺字段/非法值一律 `unknown`（不默认 ok/idle） | ✅ |
| 3 | `approval=pending` 才有 `!` | ✅ |
| 4 | `reducedMotion` 关掉位移与 hover 抬升 | ✅ |
| 5 | 每个 persona 的 SVG 含 4 表情组 + mark + body/head，`viewBox` 统一 120×120 | ✅ |
| 6 | SVG **不得**引用外部 URL / `<image>`（离线可用、不受第三方变更影响） | ✅ |
| 7 | SVG 内**不得**出现厂商标识（IP 门） | ✅ |
| 8 | CSS 必须有 `display:none` 兜底 + 每种表情点亮规则 + `prefers-reduced-motion` | ✅ |

浏览器实测（本目录 `demo.html` + 本地静态服务）：
4 个形象同时渲染、`class` 串为 `av-persona-* av-face-happy av-body-work av-mark-exclaim av-motion-bob-fast`（截图 `preview-ok-pending.png`）。

## 8. 现在有什么 / 还缺什么（诚实清单）

**已有**
- `avatar-state.mjs`：三维 + 交互 → 姿态/表情/气泡/class 的唯一映射（纯函数，9 用例）
- `personas/{cat,dog,clip,lion,chibi}.svg`：**5 个自绘形象**（含一个 **Q 版人形**），各含 4 表情组（结构由用例守住）
- `personas/index.json`：形象包注册表（含 `ipNote`，注册表与代码常量的漂移有测试守住）
- `preview-5personas.png` / `preview-ok-pending.png`：浏览器实测截图
- `persona.css`：表情切换、呼吸/眨眼、hover、reduced-motion
- `demo.html`：4 形象 × 三维 × 交互的可玩面板（本轮已浏览器实测）

**已验证可行**：`personas/chibi.svg` 就是一张**Q 版人形**的 SVG —— 5 个部件分层
（`hair-back / body / arms / head / hair-front`）+ 4 组眼口，120×120 下 15 个用例全过、浏览器实测可渲染。
所以"SVG 能不能画人形/Q 版"这个问题的答案是**能**；代价在**美术**（要按分层重画），不在技术。

**缺**（按价值排序）
1. **把参考图做成 Q 版人形形象包**：本目录 `media_*.jpg` 那两张（claude 咖啡厅 / 蓝发鲸尾女仆）是**参考风格**。
   要落地就按 §3 分层重画；前提是**确认有权使用该角色**（自生成/委托的请保留生成记录），否则用通用 Q 版。
2. **接入 DSH 浮层**：把母仓 `PetStatusOverlay` 里的 emoji 换成 `<span class="av ...">` + 内联 SVG；
   契约现成（`deriveAvatar(petStatus, {persona})` → `classes`）。**需要一次宿主重载**（host 侧已就绪，client 侧改动只需刷新）。
3. **瞌睡态 / 一次性动作**（报错抖动、成功蹦跳）：映射表已留位置，CSS 未写。
4. **语音/气泡文案表**：`voice` 字段已在契约里，尚未接 TTS。
5. **节律引擎**：低频随机变体（发呆/换姿势）目前未实现，只有一个固定循环。

## 9. 复现与落地（2026-11-01 10:0x 实测）

### R1 复现：`personas/whale-maid.svg`（鲸尾女仆）

按参考图的三组元素自绘：**蓝发（前/后两层）+ 鲸尾 + 女仆白褶边头饰/围裙/领结**，加鲸鳍耳、腮红与胡须点。
六个部件分层（`tail / hair-back / body / arms / head / hair-front`）+ 4 组眼口，120×120。

| 判据 | 结果 |
|---|---|
| 结构（4 表情组 + av-mark + 120×120） | ✅ 用例覆盖 |
| 无外链 / 无 `<image>` / 无厂商标识 | ✅ 用例覆盖 |
| 四表情实际切换（每态**恰好 1 组**可见） | ✅ `happy/worry/confused/focused` 各 1 组，其余 `display:none` |
| 截图 | `preview-whale-maid.png`（单体）、`preview-whale-maid-faces.png`（四表情条） |
| 测试总数 | **15 pass**（映射 9 + 结构 5 + 注册表一致性 1） |

### R2 落地：真实浮层已换成 SVG 形象（`dsh-os-seams` @ `21277e2`）

| 判据 | 实测（浏览器，**无宿主重载**） |
|---|---|
| `[data-pet-status]` 内含 SVG | ✅ `svg` 存在，包在 `span.av.av-pet` 里 |
| class 随三态变化 | ✅ `av-persona-cat av-face-happy av-body-work av-mark-none av-motion-*` |
| 每态恰好 1 组表情可见 | ✅ `visibleExpr = ['av-expr av-expr-happy']` |
| unknown 不显示 happy | ✅ 由 `avatar-state` 的负向控制用例守住（点一下也不变） |
| 普通点击不改事实 | ✅ 点击后 `data-health` 仍为 `ok`，只弹气泡"在的，有事说。" |
| 换形象 | ✅ shift+点击 `cat → dog → clip → …`，`localStorage['os-seams.pet.persona']` 持久化 |
| reduced-motion = reduce | ✅ `av-motion-none`、`animationName: none`、无位移 |
| reduced-motion = no-preference（CDP 模拟） | ✅ `av-pet-bob-fast 0.9s`，`transform: translateY(-1.499)`（动画中） |
| 截图 | `preview-overlay-whale-maid.png`（真实浮层里的鲸尾女仆 + 气泡） |

形象清单（6 个）：`cat / dog / clip / lion / chibi / whale-maid`；`personas/index.json` 与代码常量的一致性有测试守住。

**R3 回归**：`bash scripts/pet-acceptance.sh` → `PASS=8 FAIL=0 BLOCKED=0`。

**一个操作提示**：浮层现在是「普通点击=气泡、**shift+点击=换形象**、右键=折叠」。之所以不做成设置面板：
浮层只有 34px 高，塞表单会把"一眼看懂"变成"点开找"。要正式配置面，走 settings 卡片（下一步）。

**仍未做**：settings 卡片（可视化选形象）、瞌睡态与一次性动作、节律引擎、以及把 `media_*.jpg` 里
另外两张参考图做成更多形象（需要确认角色授权）。

## 10. 真源落位与形象扩容（2026-11-01 10:1x）

**资质确认（用户 2026-11-01）**：参考图里的「AI 女仆」系列是用户**自己 AI 生成的设定形象，可使用**。
因此形象命名与形象特征可以对应到这些设定；本仓仍坚持**按特征自绘 SVG**（不搬运位图），
文件内不含第三方商标/角色名。

**真源迁到协作区**：`~/syncfolder/project/dsh-pet-personas`（独立 git 仓，已登记进
`los-workspace/.workspace/projects.json`，`check-project-registry OK`）。
理由：`~/Downloads` 是暂存区，而这是要长期维护、会被插件消费的美术资产。

```
dsh-pet-personas/
  avatar-state.mjs        映射（9 用例）— 唯一真源
  personas/*.svg          12 个形象（各 4 表情组）
  personas/index.json     注册表（label/parts/motion/voice/ipNote）
  demo.html  persona.css  本地 demo
  test/*.test.mjs         72 用例（含状态图守卫与反应/持续闸门）
```

**消费关系（重要）**：插件 `dsh-os-seams` 里的 `src/client/persona-assets.mjs` 与
`src/client/avatar-state.mjs` 是**生成物**：`scripts/gen-persona-assets.mjs` 从真源读取、
在**生成期**过门禁（4 表情组 / 120×120 / 无外链 / 无第三方标识 / **index.json 与 SVG 一一对应**）、
再内联成模块。真源缺失 ⇒ `exit 2`；注册表与文件不一致 ⇒ 生成失败。

**12 个形象**：`cat / dog / clip / lion / chibi` + `whale-maid（蓝发鲸尾）/ gpt-maid（独角白）/
gemini-maid（星星紫）/ glm-maid（黑白）/ claude-maid（向日葵橙）/ qwen-maid（执扇深蓝）/ grok-maid（小恶魔金）`。

浏览器实测：在真实浮层里 **shift+点击循环到全部 12 个**（`data-persona` 逐个变化），
截图 `preview-overlay-claude-maid.png`（向日葵橙发女仆）。

## 11. Kimi 评审与采纳（2026-11-01）

**评审=Kimi 2.4.1（只读，≈9 min，`kimi -p`），采纳 11 条 / 部分采纳 2 条 / 明确不改 3 条。**

### 采纳（都已落地，可用 `npm test` 复跑）

| # | 问题 | 改法 |
|---|---|---|
| 1 | 34px 下 1 SVG 单位只有 0.283px：`r=1.5` 高光、`stroke-width=1` 围裙中线、`r=1.3` 纽扣、`.8` 扇骨全是亚像素噪声 | 亚像素元素**删除**；嘴/眉/眼线统一 `2.8`；猫胡须 `1.6→2.8`（那是识别特征，不删） |
| 2 | `?`/`!` 用 `<text>`（34px 下字高 3.4px，且依赖字体） | 全部换成**矢量**：`av-qmark` 描边路径、`av-bang` 竖条+圆点。产物里 `<text>` 计数 = **0** |
| 3 | 眨眼选择器缩放整个 `.av-expr`，嘴和眉一起被压扁 | 先移除该规则（改由 `.av-eyes` 承载，见"未采纳"），宁可不眨也不压嘴 |
| 4 | 呼吸动画与外层 hover 抢 `transform`，hover 抬升失效 | 呼吸移到**内层 `svg`**，`.av` 只负责 hover |
| 5 | `.av` 写死 `color`，`currentColor` 并不跟随主题 | 改 `color: inherit` |
| 6 | 真源 `persona.css` 与插件注入版**已漂移** | 注入 CSS 改由生成器从真源生成（`persona-css.gen.mjs`） |
| 7 | 节律太急促（0.9s/3px） | busy **1.4s/1px**、idle **4.2s/0.5px** |
| 8 | `activity=unknown` 与 `idle` 都是慢呼吸（"不知道忙不忙"被画成"闲着"） | unknown → **不呼吸**（`motion: none`），加负向控制用例 |
| 9 | `gemini` 星星 `scale(.62) translate(-4,-6)` 把星形拉到左上角 | 改成围绕自身的正确写法，星形回到刘海两侧 |
| 10 | `gemini` 双马尾、`qwen` 编发、`grok` 卷发**没进轮廓**（只靠圆点暗示） | 各自补了大轮廓部件（`av-twintail` / `av-braid` 泪滴三节 / `av-curls` C 形卷） |
| 11 | 七个女仆缺上眼睑 | 统一加 `av-lashes`（对所有表情生效，`stroke-width=2.8`） |

### 部分采纳

- **状态歧义**：Kimi 建议「任一维度 unknown 就变 confused」。只采纳了 activity 那半边（见 #8）；
  **approval 不采纳**——它是**刻意静默维**（没有待批数据时我们不宣称"没有待批"），若据此变 confused，
  浮层会永远显示"疑惑"。改为在 `pose.unknownDims` 里**如实暴露**，由消费者决定措辞，表情仍只由 `health` 决定。
- **一次性动作**：keyframes 与 class（`av-once-error/success/nod`）已进 CSS；**状态跳变时加 class 的 JS 接线未做**。

### 明确不改

1. 不引入 Lottie/Rive/Live2D（0KB 运行时 + 离线矢量的契约优先）。
2. 不把表情/参考图转位图或精灵图（28px 下信息层级不会因此变好）。
3. 不把状态判断塞进 CSS 或复制进 12 个 SVG（`deriveAvatar` 仍是唯一决定者）。

### 本轮自己踩到并补上的门禁

按 Kimi 建议批量改 SVG 时，我用**非贪婪正则**插入 `<g>`，把 3 个文件改成了**非法 XML**
（`claude-maid` / `gpt-maid` 漏闭合、`qwen-maid` 多闭合）——而当时的结构测试只做**子串断言**，全绿通过。
已修，并新增两条铁门禁：**XML 标签平衡校验**（`test/xml-lite.mjs`，零依赖）+ 1 条负向控制（故意漏 `</g>` 必红）。
