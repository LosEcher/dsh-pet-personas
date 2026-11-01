# 素材与授权边界（ASSETS）

本仓分三类内容，授权不同，别混着引用：

| 类别 | 例子 | 授权 | 说明 |
|---|---|---|---|
| **代码与工具** | `src/*.mjs`、`tools/*`、`test/*` | MIT（见 `LICENSE`） | 随便用 |
| **自绘产物** | `personas/*.svg`、`pixel/art/*.atlas.{webp,png,json}`、`persona.css` | MIT | 我们自己生成的矢量图与图集 |
| **参考素材（不入库）** | `ref/**` | **不适用** | 别人给的 / AI 生成的原图，来源与授权不可控，**刻意不提交** |

## 为什么 `ref/` 不入库

1. **授权不明**：这些图是需求方提供或由第三方模型生成的，二次分发没有明确许可；
2. **体积**：约 14 MB，对仓没价值（我们只需要 atlas）；
3. **可重建**：atlas 由 `tools/slice-sprite-sheet.py` 从 `ref/` 切出，参数记录在 `pixel/art/sources.json`；
   需要重切时把原图放回 `ref/` 即可。

`refs.manifest.json`（记录 `ref/` 下的哈希与尺寸）同样不入库：它是本地产物。

## 与 DeepSeek 的关系

**非官方**。本仓是个人桌宠形象实验，不包含任何 DeepSeek 官方素材，也不代表官方立场。
形象（`mermaid-maid` / `whale-maid`）是按"像素桌宠"需求自制的角色，与任何商标无关。

## 如果你要复用这些 atlas

- 直接拿去用没问题（MIT 部分），但**不要**把它们说成某厂商官方形象；
- 若你要替换成自己的形象，按 `pixel/art/sources.json` 的契约准备一张
  `2 列 × 6 行`、透明底、每格 ≥96px 的 sprite sheet，然后 `npm run atlas:all`。
