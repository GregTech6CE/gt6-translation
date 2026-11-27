# 各 Mod 与整合包 GitHub 汉化

## 信源信息

- GT5U（GTNH 核心）：https://github.com/GTNewHorizons/GT5-Unofficial
  - 英文：`src/main/resources/assets/gregtech/lang/en_US.lang`
  - 中文：`src/main/resources/assets/gregtech/lang/zh_CN.lang`
- GTNH 中央汉化：https://github.com/GTNewHorizons/GTNH-Translations
  - 格雷相关中文：`zh_CN/GregTech_zh_CN.lang`
  - 外部附属历史英文/多语种留档：`daily-history/resources/<Mod>[<modid>]/lang/`（可回查新版已移除槽位的 1.7.10 附属键，如旧版 `GalaxySpace` 1.1.x 的 `OberonAdamantiteOre`）
- GTNH 整合包汉化（Kiwi233）：https://github.com/Kiwi233/Translation-of-GTNH（`resources/<Mod>[<modid>]/lang/zh_CN.lang` 含 1.7.10 附属模组汉化）
- CFPA 社区中央模组汉化：https://github.com/CFPAOrg/Minecraft-Mod-Language-Package
  - 主分支（多版本聚合）：`projects/assets/<mod>/<mc-ver>/<domain>/lang/`
  - 历史归档分支：`archived-1.10.2`、`archived-1.12.2`、`archived-1.16` 等（路径形如 `projects/<mc-ver>/assets/<mod>/<domain>/lang/`）
- Krasjet 模组汉化风格指南术语表：https://github.com/Krasjet/Mod-Translation-Styleguide（`glossary.md` 收录跨模组常见材料与矿辞译名对照）
- TeamNED GT6 汉化：https://github.com/TeamNED/GregTech6-Translation-Groupware（仓库自身的 docs、issue、译名历史见 `gt6tg-github.md`）
- 其他 GT6 汉化项目（可作旁证）：
  - https://github.com/TehporP/GregTech6-Translation-Project
  - https://github.com/LonelySteve/GregTech6-Translation-Lang
  - https://github.com/Lucelarius/Translation-GregTech-6-1.7.10
- 本工作区的移植版：
  - `../GregTech6CE-New/core/src/main/resources/assets/gt6ce/lang/zh_cn.json`
  - `../gregtech6_w/src/main/resources/assets/gregtech6/lang/zh_cn.json`

## 涵盖内容

- 同名词在不同 mod/整合包里的中文译名。
- 英文键 → 中文值的对照，可判断某个材料是否被某个 mod 使用。
- GTNH 的 `zh_CN.lang` 覆盖大量 GT5U 材料，是“高版本材料中文名”的主要参考。
- 源模组自身 GitHub 仓库内的 `assets/<modid>/lang/zh_CN.lang`（或 `zh_cn.json`）与 `OreDictionary.registerOre(...)` 注册代码，可同时锁定 `MT.UNUSED` 静默材料的真实出处与源模组自带官中（如 `wasliebob/FE2-1.7`、`HbmMods/Hbm-s-Nuclear-Tech-GIT`、`erogenousbeef/BigReactors`、`TeamMetallurgy/Metallurgy4`、`DivineRPG/DivineRPG`、`Chisel-2/Chisel-2`）；单个模组仓库直接作为材料条目的证据 URL 引用，不逐仓重复建表。

## 注意事项

- 汉化文件只证明“有人这么译”，不证明现实出处或官方设定。
- 不同项目对同一材料可能给出不同译名；以本仓库语料和术语表为准，并说明分歧（例如 `Krasjet/Mod-Translation-Styleguide` 与 `GTNH-Translations` 对 `Forcicium`/`Forcillium` 的「力场宝石」指代恰好相反）。
- 汉化可能滞后于英文源，键名可能已改名或删除；对照时用同一个 commit/版本。
- 跨分支/续作仓库对照可还原历史错译与官方避撞改名：例如 `TeamMetallurgy/Metallurgy4`（1.7.10）中 `Infuscolium` 固态物译「魔金」、仅两行熔融流体串译为「熔融精金」，在 1.12.2 续作 `Davoleo/Metallurgy-4-Reforged` 中已统一修正为「魔金」；`DivineRPG/DivineRPG` 在 1.7.10/1.12.2 分支将旧下界矿译作「熔岩」，到 1.16+ 分支因避撞原版下界合金更名为 `Torridite` 并定官方简中为「炽岩」。
- GTNH 是 GT5U 体系，不是 GT6；只能作术语参考。
- 注意仓库许可证；引用链接，不复制大段内容。
- 1.7.10 源模组内置 `zh_CN.lang` 有时沿用元素符号或天体简称（如 HBM 将 `Euphemium`/`Schrabidium`/`Saturnite` 作 `Ep`/`Sa326`/`土星`），而后续拓展版或社区百科另有中文通译（如 `优铼`/`闪铼`/`土星合金`）；对账时可据此还原旧语料来源并说明取舍。
- 用 GitHub 代码搜索时限定仓库和路径，例如 `repo:GTNewHorizons/GT5-Unofficial path:lang Tritanium`。
