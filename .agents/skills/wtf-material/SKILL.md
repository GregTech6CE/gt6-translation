---
name: wtf-material
description: 查清一个材料“是什么、英文叫什么、中文叫什么、从哪来”。当用户给出 GT6/Minecraft 材料名、语言键（如 gt.material.*）、lang 条目、任务书或物品名，问“这是什么材料”“这材料哪来的”“英文名/中文名是什么”“是不是现实材料”“该怎么翻译”时使用；也用于 GT5/GTNH/GT6CE/高版本材料对照和汉化术语排查。
---

# wtf-material：材料详情溯源

查一个材料的**组成、形态、英文名、中文名、出处**。只把有证据的内容当作事实；证据不足时明确标注推断或未知。

## 【材料定义】

- **组成**：材料可能是单一元素、材质、化合物，或者几种材料的混合（如合金、复合物）。
- **形态**：材料可能是气态、液态、固态、等离子体；同一种材料在不同形态下的名称可能不同（例如 Iron 与 Molten Iron）。
- **英文**：材料在英语中的名字，与之关联的有英文俗名、拉丁文学名；由相同单词或词缀组成的材料之间可能存在词源或设定上的联系。
- **中文**：材料在简体中文中的名字，与之关联的有中文俗名、中文学名、港澳台等地区词；不同地区对同一材料的称呼可能不同，具有相同字或部首的材料之间可能存在联系。
- **出处**：材料名称的来源。可能是现实中的材料（元素、化合物、宝石、矿物等，需要结合专业文献查证），也可能是虚构材料（其他 Minecraft mod、高版本材料、有名的文学/影视/游戏作品等，需要在搜索引擎、MC百科和相关作品的 Wiki 农场页面查证）。

## 【知识库优先】

材料与术语的现行规范译名、组成、形态、出处已经结构化在 `knowledge/`，**先查知识库，再决定要不要外查**：

- `knowledge/materials.jsonl`：材料单一事实源，每行一条 `MaterialRecord`，字段见 `knowledge/schemas/material.schema.json`。
- `knowledge/glossary.jsonl`：非材料术语（形态前缀、词缀、等级、机器、方块、流体、界面），字段见 `knowledge/schemas/glossary.schema.json`。
- `knowledge/material-derivations.json`：规则派生族（反物质镜像 `Anti{base}`、系统命名元素、`Any*` 占位、试剂 Y 系列、带质量数的同位素）与内部占位/彩蛋键，字段见 `knowledge/schemas/material-derivations.schema.json`。这些键**刻意不建材料条目**，不要再为它们补行。
- `docs/materials/README.md`：唯一的人工入口说明；派生的 Markdown 大表已不再入库。

```bash
# 在 packages/node 下执行
npm run kb:query -- <英文名|中文名|语言键|id> [--json]
npm run kb:validate
npm run kb:reconcile -- --gt6ce ../GregTech6CE/core/src/main/resources/assets/gt6ce/lang/en_us.json
npm run kb:render-md      # 按需导出到 packages/node/dist/materials/（总览为 index.md），不入库
```

命中后按字段取值：`zh.canonical` 是**现行规范译名**，`zh.legacy[]` 是带出处的历史/候选译名条目（`status` 为 `legacy`/`rejected`/`proposed`，`source` 为 `gt6-lang`/`gt6ce-lang`/`docs-materials`），`zh.stateNames` 是分形态名称，`origin.{kind,source,evidence,urls}` 是出处与证据等级，`targets.*` 是 GT6/GT6CE 落点（`numericId`/`modTag`/`mtRef`/`gt6ce`）。

## 【反循环出处红线】

- `origin.urls` **只放外部首创信源**：现实条目放百科、术语库或专业文献；mod 条目放该 mod 的官方页、GitHub 或 Wiki；作品条目放作品 Wiki。
- `MT.java`（GT6、GT6CE、gregtech6_w 的代码）只能证明「GT6 收录了它」，不能证明名称首创于某处。它只能写进 `targets.mtRef`；写进 `origin.urls` 会被 `kb validate` 直接判 `error`（`origin.mt-ref`）。
- 找不到外部信源时，把 `origin.evidence` 降为 `inferred` 或 `unknown` 并在 `notes` 说明，不要用 MT.java 充数；`kb validate` 不再逐条警告缺链接，只在 `stats.evidence` 统计分布。

## 【操作流程】

### 0. 先查知识库

```bash
npx tsx src/cli/main.ts kb query <材料名>
```

命中就直接用知识库里的字段回答，并说明数据来自 `knowledge/materials.jsonl`。没命中再走下面的外查流程。

### 1. 固定证据

先整理用户已经给出的信息，再决定查什么。逐项回答：

- 用户提供了什么？材料英文名、中文名、语言键、物品 ID、截图、某个 mod 的 lang 条目，还是模糊描述？信息以什么形式出现？
- 本仓库里有没有相关文件和提交？优先查：
  - `knowledge/materials.jsonl`、`knowledge/glossary.jsonl`：现行规范译名与结构化出处。
  - `packages/legacy/workplace/en/GregTech.lang`、`zh/GregTech.lang`：GT6 英/中语料，材料键通常是 `gt.material.<内部名>`。
  - `packages/legacy/workplace/zh/GregTech.unknown.lang`：未命中的条目。
  - `packages/node/project.jsonc`：词表、替换规则和既有译名。
  - 工作区里的其他 checkout：`../GregTech6CE`、`_reference/gregtech6_w`、`_reference/GregTech6-Original` 等。
  - `git log -S '<材料名>'`：这个词是什么时候、因为什么进入语料的。
- 如果是 Minecraft lang 格式，分别记下**键名、英文值、中文值**（中文可能为空、缺失或仍是英文）。GT6 的 `GregTech.lang` 是 Forge config 风格（`S:key=value`，`#` 注释），新版资源包则是 `zh_cn.json` / `en_us.json`。

### 2. 搜集信息

围绕已知字段查，不要只查一个名字就下结论。可用的信源包括（不限于）：

- **搜索引擎**：先用英文名查现实/作品出处，再用中文名查中文社区；摘要不能当证据，必须打开原页。
- **DeepSeek 搜索工具**：快速拿到多语言结果、日期和候选页面，仍要回到原始页面核对。
- **Wikipedia（中文、英文）**：现实元素、化合物、矿物、宝石、合金，以及作品条目。
- **huijiwiki（GTNH 站、作品站）**：GTNH 中文资料和各类作品 Wiki。
- **Fandom**：Minecraft mod、Terraria、Star Trek、最终幻想等作品的 Wiki 农场。
- **Gamepedia**：已并入 Fandom，旧域名会重定向；老链接要换域名再查。
- **术语在线**：查现实材料的规范中文名、英文名和学科义项。
- **MC百科**：中文 mod 条目、物品/材料页、教程和汉化链接。
- **GTNH百科**：中文站 `gtnh.huijiwiki.com`，英文站 `wiki.gtnewhorizons.com`；GT5U 体系，可作高版本材料参考。
- **FTB Wiki**：`ftb.fandom.com`，有 GregTech 各版本条目，注意版本差异。
- **GT6 官方页面（changelog）**：GitHub 仓库、`CHANGELOG.md`、`MT.java` 等代码；材料内部名和组成的强证据，但**只作收录证据，不作首创出处**。
- **各来源 Mod 的 GitHub 仓库中的汉化（包括 GTNH）**：查同名词在其他 mod/整合包里的译名和用法。
- **本仓库及其前身的 GitHub**：GT6TG 的 docs、issue、PR、release，以及前身 `gregtech6-chinese-translation` 的术语表和材料语料；查译名决策和历史版本。
- **browser use**：页面被反爬、需要登录、或要交互式搜索时使用。

每个信源的信息、涵盖范围和具体注意事项写在 `./sources/*.md`。先读 `./sources/README.md` 的索引，再按需打开对应文件，不要一次读完所有信源。

### 3. 总结

当继续搜索只会重复同样的页面、不再出现新线索时，停止搜索，按【材料定义】的五个方面逐项总结。每个结论都要交代证据等级：

- `【信源】`：某个信源明确写出，给出页面标题和超链接。
- `【推断】`：由多条证据推出，写出推理链和依据。
- `【未知】`：没有证据，直说不知道，不要用听起来合理的猜测填空。

建议的输出结构：

- 组成：…（【信源】[页面标题](https://…)）
- 形态：…（【推断】依据：…）
- 英文：…（俗名/学名/词源联系…）
- 中文：…（地区词/建议译名…）
- 出处：…（现实/虚构，来源作品…）

### 4. 回写知识库

调查结论要落回 JSONL，而不是只留在对话里：

- 新增或修正材料：改 `knowledge/materials.jsonl` 的对应行，一行一条，字段与 `knowledge/schemas/material.schema.json` 一致；原版 MC 材料仅在名称或设定首创于 MC 且现实不存在时标 `origin.kind: "minecraft"`（现实已有的原版材料标 `real-world` 并在 `alsoIn` 记 `"Minecraft"`）。
- 新增或修正术语：改 `knowledge/glossary.jsonl`。
- 确认是规则派生的键族：改 `knowledge/material-derivations.json` 的 `families`（给出可执行正则、模板与理由）；内部占位/彩蛋键写进 `internalPlaceholders`。**不要**为这些键建材料行，也不要恢复「精确排除键」清单。
- 同一中文名必须共用时（包括**材料与术语跨表同名**），在**每个**共用条目上写 `allowSameZhReason` 说明理由，否则 `kb validate` 报 `zh.collision`。
- 规范译名（含 `zh.stateNames` 与 `zh.regionVariants`）不得含顿号 `、`（`zh.forbidden-separator`），也不得填「未译」「建议：」「Unicode」等占位元信息（`zh.placeholder-meta`）。
- 语言键必须逐条列出，不得用 `<br>` 或空白拼接（`key.illegal`）；同一语言键不能同时登记为材料与术语（跨表 `key.duplicate`）。
- 译名历史写进 `zh.legacy[]` 条目：语料曾实际使用的旧译用 `status: "legacy"`，明确不采用的冲突/误译候选（如「圣餐」「聚爆压缩机」）用 `status: "rejected"`，尚未定案的建议用 `status: "proposed"`；每条只写单一干净 `source`（多个来源分别建条目，不要逗号拼接）。旧译不要再塞进 `zh.canonical`。
- 术语之间的撞车消歧与同族关系用 `seeAlso` 指向对方 id，不要新建一次性分组字段。

改完依次跑：

```bash
npx tsx src/cli/main.ts kb validate      # schema、键、跨表键冲突、撞车、顿号、派生正则
npx tsx src/cli/main.ts kb reconcile     # 要求 unaccounted 与 duplicatedKeys 都为 0
npx tsx src/cli/main.ts kb render-md     # 需要表格时按需导出到 packages/node/dist/materials/
```

`kb reconcile` 的基线：`gt.material.*` 2,227 键、`material.gt6ce.*` 1,666 键，两者 `unaccounted` 与 `duplicatedKeys` 都必须为 0；新增语料键后要么补材料/术语条目，要么补派生族正则。

### 注意事项

- 不要把猜测当作事实，也不要把某个 mod 的译名当成现实术语。
- 同一个英文词在不同语境下可能有多个含义；先确认它在这里是材料、地名、作品名还是其他概念。
- 如果用户在做翻译，中文一项要给出建议译名并说明取舍。
- 用户只问某个字段时，只答相关字段，不必强凑五段。
- GT6 对同一来源/Mod 添加的兼容更新往往在同一天，可以搜索附近或同一天/同一批提交的词来寻找来源。
- 如果检索中用到了 wiki 农场里的子 Wiki（某个作品站、某个 mod 站等）或 `./sources/` 尚未收录的新信源，在输出总结后询问用户是否把这些子 Wiki/新信源补充进本技能；用户同意时再更新 `./sources/` 并登记到索引。
