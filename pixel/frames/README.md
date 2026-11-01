# pixel/frames — 部件搬运造出来的帧（**提案**，还没进图集）

路线来源：2026-11-01 拉 Codex 做的第二意见 —— 结论是"**原像素复用 + 整数位移 + 手绘补缝**"优先，
AI 逐帧重画最后；理由与我们自己的实测一致（损伤发生在 448px 重画那一步，后处理补不回来）。

工具：`tools/frame-parts.py`。铁律：**输出像素必须是输入像素的副本**（颜色只来自输入，不重采样、
不重量化），否则抖动纹理会被打散。

## 通过：`idle-breathe/`（4 帧循环）

```bash
python3 tools/frame-parts.py --op breathe --base pixel/art/<col0 切出的帧>.png \
  --band 60:96 --offsets 0,-1,0,1 --name idle_breathe --out-dir pixel/frames/idle-breathe
node tools/frame-gate.mjs --base <col0> --cand pixel/frames/idle-breathe/idle_breathe_1.png --allow 60:96
```

四帧全部过门禁，关键那条是 **`outsideRegion = 0`**：动作带（y≥60）之外的像素**一个都没动**。
其中第 0/2 帧与基准逐像素相同 —— 循环的休息帧本来如此，用 `--allow-identical` 表达（Codex 也明确
"允许重复帧和不等时长，别强求六张独特图"）。

⚠️ 但这套帧的**净收益有限**：呼吸本来已经由 CSS 的 `av-breathe` 做了；真正的缺口是"更多**不同姿势**"。

## 被否：`_sheet-idle-blink-rejected-2026-11-01.png`（眨眼自动合成）

想法：两张源帧的**差异包围盒**就是眼睛区域，把包围盒下半部取自闭眼帧 ⇒ 半闭帧。
实测：差异包围盒是 **[1,10,95,86]≈整张图**（这套素材的两帧在全身都有细微差异），于是"半闭"帧实际
变成"上半身睁眼 + 下半身闭眼"的横向拼接，脸上一道灰带（见被否的图）。

结论：**差异框自动定位眼睛在这套素材上不成立**；要做眨眼必须**显式给眼睛框**（需人工标注一次），
`frame-parts.py --op blink` 保留了这个能力，但需要 `--box` 参数（尚未加，等有人愿意标一次）。

## 下一批该做什么

- 给每个状态标一次"动作区矩形"（眼睛 / 手 / 胸腹），再批量跑 `frame-parts.py`；
- 或者接受"呼吸由 CSS 表达"，把精力放回**状态语义**（已经做完的那批）。
