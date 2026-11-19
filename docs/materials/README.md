# 材料与术语知识库（人工入口）

本目录只保留这一份人工说明。材料与术语的**单一事实源**在 `knowledge/`，不再入库任何派生的 Markdown 大表；
需要表格视图时用 `kb render-md` 按需导出（产物在 `packages/node/dist/materials/`，不入库）。

## 数据文件

| 文件 | 内容 |
| --- | --- |
| `knowledge/materials.jsonl` | 材料记录，每行一条；键、英中名、类别、形态、组成、出处、GT6/GT6CE 落点 |
| `knowledge/glossary.jsonl` | 术语记录，每行一条；形态前缀、词缀、等级、机器、方块、物品、流体、界面等非材料词 |
| `knowledge/material-derivations.json` | 规则派生族（反物质镜像、系统命名元素、任意占位、试剂 Y 系列、带质量数的同位素）与内部占位键 |

三者的机器可读契约在 `knowledge/schemas/`：

- `material.schema.json`：`MaterialRecord`
- `glossary.schema.json`：`GlossaryRecord`
- `material-derivations.schema.json`：`MaterialDerivationsConfig`

## 字段要点

- `id` 为 kebab-case 稳定标识；`keys.{gt6,gt6ce,gt6w}` 逐条列出完整语言键，不把多个键挤进一格。
- `en.canonical` 是英文规范名，`en.aliases` 收英美双拼与内部名别名；`zh.canonical` 是项目规范译名，不得含顿号。
- `zh.legacy` 是**带出处的条目数组**：`status` 取 `legacy`（语料曾实际使用的旧译）、`rejected`（明确不采用的冲突/误译候选）、`proposed`（尚未定案的建议）；`source` 写明单值来源（如 `gt6-lang`、`gt6ce-lang`、`docs-materials`（指基线 `aece60c` 已移除的 `docs/materials/*.md` 历史分表）等）。
- `category` 与 `traits` 正交：类别只写一次（`element`/`compound`/`alloy`/`mineral`/`gem`/`rock`/`wood`/`fluid`/`food`/`dye`/`isotope`/`particle`/`other`），`traits` 只放规则驱动的附加特征（`metal`/`ore`/`dust-based`/`chemical-acid`/`magical`/`radioactive`/`celestial`/`vanilla-derived`/`biome-wood`）。
- `composition` 可选：没有证据就省略字段，不写 `unknown`。
- `origin`：`kind` 取 `real-world`/`minecraft`/`mod`/`fiction`/`gt6`/`unknown`（`minecraft` 严格用于名称或设定首创于原版 Minecraft 且现实中不存在的材料；原版中的现实事物归 `real-world` 并在 `alsoIn` 记 `"Minecraft"`），`source` 是首创出处名，`evidence` 取 `verified`/`inferred`/`unknown`，`urls` 只放外部首创信源（禁止 MT.java 反循环出处）。
- `targets`：`numericId`、`modTag`、`mtRef`（MT.java 位置）与 `gt6ce` 收录状态（`active`/`removed`/`renamed`/`legacy-only`）。
- 术语用 `seeAlso` 表达撞车消歧与同族关系；共用同一中文名时用 `allowSameZhReason` 登记理由。

## 操作闭环

```bash
# 门禁：schema、键、跨表键冲突、中文撞车、出处与派生规则
(cd packages/node && npm run kb:validate)

# 三方对账：materials + glossary + derivations 必须 100% 覆盖语料键
(cd packages/node && npm run kb:reconcile -- --gt6ce ../GregTech6CE/core/src/main/resources/assets/gt6ce/lang/en_us.json)

# 检索：按 id / 英文 / 中文 / 语言键查材料与术语全貌
(cd packages/node && npm run kb:query -- 三元金属)

# 按需导出阅读视图（仅写入 packages/node/dist/ 内子目录；总览文件为 index.md）
(cd packages/node && npm run kb:render-md)
```

`kb reconcile` 在 `unaccounted > 0` 或存在重复登记时返回 1；正常输出形如
`总 2227、材料 …、术语 …、派生 …、内部占位 …、未解释 0`。

## 数据来源

- `packages/legacy/workplace/en/GregTech.lang`、`zh/GregTech.lang`：GT6 材料键与英中名称。
- `GregTech6CE/core/src/main/resources/assets/gt6ce/lang/en_us.json`、`zh_cn.json`：GT6CE 材料键与译名。
- `GregTech6CE/docs/decisions/parity/material-removal.md`：停注材料与数值 ID。
- `_reference/gregtech6_w/src/main/java/gregapi/data/MT.java`：官方派生材料定义、别名与 mod 标签。
- 外部信源：Wikipedia、GTNH 中文/英文 Wiki、MC百科、FTB Wiki、Fandom、huijiwiki、术语在线及各 mod/作品 Wiki；详见技能 `.agents/skills/wtf-material/sources/`。

## 后续

- 网页与本地控制台的交互式浏览视图在 #58 提供；在此之前用 `kb query` 与 `kb render-md` 查表。
- 本目录是翻译辅助资料，不是 GT6 官方文档。材料是否属于某个 mod/作品，以代码、官方 changelog 和外部信源为准。
