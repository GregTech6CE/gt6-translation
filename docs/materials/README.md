# 材料、术语与游戏对象知识库（人工入口）

本目录只保留这一份人工说明。材料、规则术语与游戏对象的**单一事实源**在 `knowledge/`，不再入库任何派生的 Markdown 大表；
需要阅读时可直接打开 `packages/web` 里的「知识库」视图，或用 `kb render-md` 按需导出（产物在 `packages/node/dist/materials/`，不入库）。

## 数据文件

| 文件 | 内容 |
| --- | --- |
| `knowledge/materials.jsonl` | 材料记录，每行一条；键、英中名与后缀、类别、形态、组成、出处、形态变体、GT6/GT6CE 落点 |
| `knowledge/glossary.jsonl` | 规则术语记录，每行一条；形态前缀（`prefix`）、词缀（`affix`）、等级（`tier`）、机制（`mechanic`）、界面（`ui`）、单位（`unit`） |
| `knowledge/entities.jsonl` | 具体游戏对象记录，每行一条；涵盖 11 个对象域：单方块机器（`machine`）、多方块与结构件（`multiblock`）、存储容器（`storage`）、管道线缆与物流（`logistics`）、覆盖板与面板（`cover`）、工具（`tool`）、通用物品（`item`）、食物与饮品（`food`）、蜜蜂（`bumblebee`）、独立方块（`block`）、非材料流体（`fluid`） |
| `knowledge/material-derivations.json` | 规则派生材料族（反物质镜像、系统命名元素、任意占位、试剂 Y 系列、带质量数的同位素）与内部占位键 |
| `knowledge/entity-derivations.json` | 规则派生实体族（MTE 材质/等级/尺寸变体、MultiItem 同类重复与蜂种/喷漆/模具、MetaTool 变体、tooltip、岩石与装饰方块族、非材料流体及材料同名/兼容流体族）与非实体占位键 |

五者的机器可读契约在 `knowledge/schemas/`：

- `material.schema.json`：`MaterialRecord`
- `glossary.schema.json`：`GlossaryRecord`
- `entity.schema.json`：`EntityRecord`
- `material-derivations.schema.json`：`MaterialDerivationsConfig`
- `entity-derivations.schema.json`：`EntityDerivationsConfig`

> 注：非实体杂项界面文案域（如 `.32767` 通配符 `gt.meta.*`、`gt.td.*`、`gt.tooltip.*`、`gt.lang.*`、`gt.behaviour.*`、`gt.tileentity.*`、`gt.drink.*`、`written.book.*`、`qwertech.machines.*`）与 GT6CE 语料均不纳入 `entities.jsonl`；同时 `Loader_MultiTileEntities.java` 字面量注册但 golden `GregTech.lang` 缺键的 5 个 MTE ID（`20421`/`20422`/`20424`/`20425`/`31023`）已在 `entities.jsonl` 建档（无悬空 `keys.gt6`）并在 `entity-derivations.json` 注明。

## 字段要点

- 材料 `id` 由 GT6 权威语言键（`gt.material.*` 优先，无则取 GT6CE 键）小写派生，同键分拆时附限定后缀（如 `moon-rock`、`hydrochloricacid-gas`）；`glossary` 与 `entities` 保留 kebab-case 稳定标识。`keys.{gt6,gt6ce,gt6w}` 逐条列出完整语言键，不把多个键挤进一格。
- `en.canonical` 是英文规范名，`en.suffix` 是可选的模板或消歧后缀（如 `Dye`、`Rock`、`Gas`，界面展示为 `Black (Dye)`），`en.aliases` 收英美双拼与内部名别名。
- `zh.canonical` 是项目规范译名词干（不得含顿号），`zh.suffix` 是可选的模板后缀（如 `染料`、`矿`、`木`，界面展示为 `黑色（染料）`，`formatFullZh` 拼接为 `黑色染料`）。
- 同一材料的不同形态/义项若导致译名不同或产生多义词（如 `hydrochloricacid` 盐酸 vs `hydrochloricacid-gas` 氯化氢、`mercury` 汞 vs `mercuryrock` 水星岩），应拆成不同 `id` 的独立词条，用 `variantOf`（同种材料的不同形态）或 `seeAlso`（跨表关联/多义消歧）串联。
- `zh.legacy` 是**带出处的条目数组**：`status` 取 `legacy`（语料曾实际使用的旧译）、`rejected`（明确不采用的冲突/误译候选）、`proposed`（尚未定案的建议）；`source` 写明单值来源（如 `gt6-lang`、`gt6ce-lang`、`docs-materials`（指基线 `aece60c` 已移除的 `docs/materials/*.md` 历史分表）等）。
- `category` 与 `traits` 正交：类别只写一次（`element`/`compound`/`alloy`/`mineral`/`gem`/`rock`/`wood`/`fluid`/`food`/`dye`/`isotope`/`particle`/`other`），`traits` 只放规则驱动的附加特征（`metal`/`ore`/`dust-based`/`chemical-acid`/`magical`/`radioactive`/`celestial`/`vanilla-derived`/`biome-wood`）。
- `composition` 为可选结构化对象 `{ formula, source, gt6?, note? }`：同时记录主化学式/组分式、来源与可选 GT6 配平式及备注；无固定组成或未知时省略整体字段，不写 `未知`/`unknown`。
- `origin`：`kind` 取 `real-world`/`minecraft`/`mod`/`fiction`/`gt6`/`unknown`（`minecraft` 严格用于名称或设定首创于原版 Minecraft 且现实中不存在的材料；原版中的现实事物归 `real-world` 并在 `alsoIn` 记 `"Minecraft"`），`source` 是首创出处名，`alsoIn` 结构化记录其他出现来源（不再写进 `notes` 正文），`evidence` 取 `verified`/`inferred`/`unknown`，`urls` 只放外部首创信源（禁止 MT.java 反循环出处）。
- `notes` 仅保留结构化字段未承载的补充背景，同一段信息只记录在一处，不写模板套话或重复字段值的评语。
- `targets`：`numericId`、`modTag`、`mtRef`（MT.java 位置）与 `gt6ce` 收录状态（`active`/`removed`/`renamed`/`legacy-only`）。
- 跨三张表的关联与撞车消歧用 `seeAlso` 指向对方 `id`；共用同一完整中文名（`formatFullZh`）时在各方登记 `allowSameZhReason`。

## 操作闭环

```bash
# 门禁：schema、键、三表跨表键冲突、中文撞车、出处、变体与派生规则
(cd packages/node && npm run kb:validate)

# 五文件联合对账：materials + glossary + entities + material-derivations + entity-derivations 必须 100% 覆盖 GT6 材料与实体语料键
(cd packages/node && npm run kb:reconcile -- --gt6ce ../GregTech6CE/core/src/main/resources/assets/gt6ce/lang/en_us.json)

# 检索：按 id / 英文 / 中文 / 后缀组合 / 语言键查材料、术语与对象全貌
(cd packages/node && npm run kb:query -- 三元金属)

# 按需导出阅读视图（仅写入 packages/node/dist/ 内子目录；总览文件为 index.md）
(cd packages/node && npm run kb:render-md)
```

`kb reconcile` 在 `unaccounted > 0` 或存在重复登记时返回 1；正常输出分三段（`gt6-legacy` 材料 2,227 键、`gt6-entities` 实体+流体 13,199 键、`gt6ce` 兼容材料 1,666 键），每段形如：
`总 …、材料 …、术语 …、对象 …、派生 …、内部占位 …、未解释 0`。

## 数据来源

- `packages/legacy/workplace/en/GregTech.lang`、`zh/GregTech.lang`：GT6 材料键与英中名称。
- `GregTech6CE/core/src/main/resources/assets/gt6ce/lang/en_us.json`、`zh_cn.json`：GT6CE 材料键与译名。
- `GregTech6CE/docs/decisions/parity/material-removal.md`：停注材料与数值 ID。
- `_reference/gregtech6_w/src/main/java/gregapi/data/MT.java`：官方派生材料定义、别名与 mod 标签。
- 外部信源：Wikipedia、GTNH 中文/英文 Wiki、MC百科、FTB Wiki、Fandom、huijiwiki、术语在线及各 mod/作品 Wiki；详见技能 `.agents/skills/wtf-material/sources/`。

## 后续

- 本目录是翻译辅助资料，不是 GT6 官方文档。材料是否属于某个 mod/作品，以代码、官方 changelog 和外部信源为准。
