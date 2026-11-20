/**
 * 把知识库渲染成可选的 Markdown 阅读视图。
 *
 * 视图是只读产物：单一事实源是 `knowledge/{materials,glossary,entities}.jsonl` 与
 * `material-derivations.json`，目录内不再入库任何派生大表，`kb render-md` 按需导出到
 * `packages/node/dist/materials/`。渲染必须确定性：同样的输入永远得到同样的字节。
 */
import {
  formatAnnotatedZh,
  formatComposition,
  formatFullEn,
  type EntityDomain,
  type EntityRecord,
  type GlossaryDomain,
  type GlossaryRecord,
  type KnowledgeBase,
  type MaterialCategory,
  type MaterialRecord,
  type MaterialState,
  type RenderedDocs,
} from './types.ts';

const CATEGORY_TITLES: Record<MaterialCategory, string> = {
  element: '元素',
  compound: '化合物',
  alloy: '合金',
  mineral: '矿物',
  gem: '宝石',
  rock: '岩层',
  wood: '木头',
  fluid: '流体',
  food: '食物',
  dye: '染料',
  isotope: '同位素',
  particle: '粒子',
  other: '其他',
};

const CATEGORY_ORDER: MaterialCategory[] = [
  'element',
  'compound',
  'alloy',
  'mineral',
  'gem',
  'rock',
  'wood',
  'fluid',
  'food',
  'dye',
  'isotope',
  'particle',
  'other',
];

const GLOSSARY_DOMAIN_TITLES: Record<GlossaryDomain, string> = {
  prefix: '形态前缀',
  affix: '词缀',
  tier: '等级',
  mechanic: '机制',
  ui: '界面',
  unit: '单位',
};

const GLOSSARY_DOMAIN_ORDER: GlossaryDomain[] = ['prefix', 'affix', 'tier', 'mechanic', 'ui', 'unit'];

const ENTITY_DOMAIN_TITLES: Record<EntityDomain, string> = {
  machine: '单方块机器',
  multiblock: '多方块与结构件',
  storage: '存储容器',
  logistics: '管道线缆与物流',
  cover: '覆盖板与面板',
  tool: '工具',
  item: '通用物品',
  food: '食物与饮品',
  bumblebee: '蜜蜂',
  block: '独立方块',
  fluid: '非材料流体',
};

const ENTITY_DOMAIN_ORDER: EntityDomain[] = [
  'machine',
  'multiblock',
  'storage',
  'logistics',
  'cover',
  'tool',
  'item',
  'food',
  'bumblebee',
  'block',
  'fluid',
];

const STATE_TITLES: Record<MaterialState, string> = {
  solid: '固态',
  liquid: '液态',
  gas: '气态',
  plasma: '等离子体',
  unknown: '未知',
};

const EVIDENCE_TITLES = {
  verified: '信源',
  inferred: '推断',
  unknown: '未知',
} as const;

const PARITY_TITLES = {
  active: 'GT6CE 在用',
  removed: 'GT6CE 停注',
  renamed: 'GT6CE 改名保留',
  'legacy-only': '仅 GT6 语料',
} as const;

const LEGACY_STATUS_TITLES = {
  legacy: '旧译',
  rejected: '不采用',
  proposed: '建议',
} as const;

const MATERIAL_TABLE_HEADER =
  '| 英文名 | 中文名 | 类别 | 形态 | 组成 | 出处 | 证据 | 语言键 | 备注 |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |';

const TERM_TABLE_HEADER = '| 英文名 | 中文名 | 域 | 语言键 | 关联 | 备注 |\n| --- | --- | --- | --- | --- | --- |';

const GENERATED_NOTE = [
  '> 本文件由 `kb render-md` 从 `knowledge/{materials,glossary,entities}.jsonl` 与',
  '> `knowledge/material-derivations.json` 自动生成，请勿手改；需要修改请改 JSONL 后重新导出。',
];

/** Markdown 表格单元格转义：竖线与换行会破坏表格。 */
function cell(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

function joinCell(parts: readonly string[]): string {
  return cell(parts.filter((part) => part !== '').join(' '));
}

function englishCell(record: MaterialRecord): string {
  const fullEn = formatFullEn(record.en);
  const aliases = record.en.aliases ?? [];
  return aliases.length === 0 ? cell(fullEn) : cell(`${fullEn}（别名：${aliases.join(', ')}）`);
}

function legacyParts(entries: readonly { text: string; status: keyof typeof LEGACY_STATUS_TITLES }[]): string[] {
  return entries.map((entry) => `${LEGACY_STATUS_TITLES[entry.status]}：${entry.text}`);
}

function chineseCell(record: MaterialRecord): string {
  const base = formatAnnotatedZh(record.zh);
  const parts = legacyParts(record.zh.legacy ?? []);
  return parts.length === 0 ? cell(base) : cell(`${base}（${parts.join('；')}）`);
}

function statesCell(record: MaterialRecord): string {
  return record.states.map((state) => STATE_TITLES[state] ?? state).join('/');
}

function originCell(record: MaterialRecord): string {
  const also = record.origin.alsoIn ?? [];
  const suffix = also.length > 0 ? `（也见于：${also.join(', ')}）` : '';
  return cell(`${record.origin.kind} · ${record.origin.source}${suffix}`);
}

function evidenceCell(record: MaterialRecord): string {
  const label = EVIDENCE_TITLES[record.origin.evidence];
  const url = (record.origin.urls ?? [])[0];
  return url === undefined ? label : `[${label}](${url})`;
}

function keysCell(keys: { gt6?: string[]; gt6ce?: string[]; gt6w?: string[] } | undefined): string {
  const all = [...(keys?.gt6 ?? []), ...(keys?.gt6ce ?? []), ...(keys?.gt6w ?? [])];
  return all.length === 0 ? '—' : all.map((key) => `\`${key}\``).join(' ');
}

function materialNotesCell(record: MaterialRecord): string {
  const parts: string[] = [];
  if (record.notes) parts.push(record.notes);
  if (record.variantOf) parts.push(`形态变体：${record.variantOf}`);
  if (record.seeAlso && record.seeAlso.length > 0) parts.push(`关联：${record.seeAlso.join(', ')}`);
  if (record.allowSameZhReason) parts.push(`同中文名登记：${record.allowSameZhReason}`);
  if (record.targets.numericId !== undefined) parts.push(`数值 ID：${record.targets.numericId}`);
  parts.push(PARITY_TITLES[record.targets.gt6ce]);
  if (record.targets.mtRef) parts.push(`GT6 收录：[MT.java](${record.targets.mtRef})`);
  if (record.targets.modTag) parts.push(`mod 标签：${record.targets.modTag}`);
  return joinCell(parts);
}

function materialRow(record: MaterialRecord): string {
  const columns = [
    englishCell(record),
    chineseCell(record),
    CATEGORY_TITLES[record.category],
    statesCell(record),
    record.composition === undefined ? '—' : cell(formatComposition(record.composition)),
    originCell(record),
    evidenceCell(record),
    keysCell(record.keys),
    materialNotesCell(record),
  ];
  return `| ${columns.join(' | ')} |`;
}

function termRow(record: GlossaryRecord | EntityRecord, domainTitle: string): string {
  const baseZh = formatAnnotatedZh(record.zh);
  const legacy = legacyParts(record.zh.legacy ?? []);
  const chinese = legacy.length === 0 ? baseZh : `${baseZh}（${legacy.join('；')}）`;
  const columns = [
    cell(formatFullEn(record.en)),
    cell(chinese),
    domainTitle,
    keysCell(record.keys),
    cell((record.seeAlso ?? []).join(', ') || '—'),
    joinCell([record.notes ?? '', record.allowSameZhReason ? `同中文名登记：${record.allowSameZhReason}` : '']),
  ];
  return `| ${columns.join(' | ')} |`;
}

function compareByEnglish<T extends { id: string; en: { canonical: string; suffix?: string } }>(
  left: T,
  right: T,
): number {
  const byEnglish = formatFullEn(left.en).localeCompare(formatFullEn(right.en), 'en');
  if (byEnglish !== 0) return byEnglish;
  return left.id.localeCompare(right.id, 'en');
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return groups;
}

function renderMaterials(materials: readonly MaterialRecord[]): string {
  const groups = groupBy(materials, (record) => record.category);
  const blocks: string[] = [];
  for (const category of CATEGORY_ORDER) {
    const group = groups.get(category);
    if (group === undefined || group.length === 0) continue;
    const rows = [...group].sort(compareByEnglish).map(materialRow);
    blocks.push(`## ${CATEGORY_TITLES[category]}（${group.length}）\n\n${MATERIAL_TABLE_HEADER}\n${rows.join('\n')}`);
  }
  return [
    '# 材料总表',
    '',
    ...GENERATED_NOTE,
    `> 条目数：${materials.length}。`,
    '',
    ...blocks.flatMap((block) => [block, '']),
  ].join('\n');
}

function renderGlossary(glossary: readonly GlossaryRecord[]): string {
  const groups = groupBy(glossary, (record) => record.domain);
  const blocks: string[] = [];
  for (const domain of GLOSSARY_DOMAIN_ORDER) {
    const group = groups.get(domain);
    if (group === undefined || group.length === 0) continue;
    const rows = [...group].sort(compareByEnglish).map((record) => termRow(record, GLOSSARY_DOMAIN_TITLES[domain]));
    blocks.push(`## ${GLOSSARY_DOMAIN_TITLES[domain]}（${group.length}）\n\n${TERM_TABLE_HEADER}\n${rows.join('\n')}`);
  }
  return [
    '# 规则术语总表',
    '',
    ...GENERATED_NOTE,
    `> 条目数：${glossary.length}。`,
    '',
    ...blocks.flatMap((block) => [block, '']),
  ].join('\n');
}

function renderEntities(entities: readonly EntityRecord[]): string {
  const groups = groupBy(entities, (record) => record.domain);
  const blocks: string[] = [];
  for (const domain of ENTITY_DOMAIN_ORDER) {
    const group = groups.get(domain);
    if (group === undefined || group.length === 0) continue;
    const rows = [...group].sort(compareByEnglish).map((record) => termRow(record, ENTITY_DOMAIN_TITLES[domain]));
    blocks.push(`## ${ENTITY_DOMAIN_TITLES[domain]}（${group.length}）\n\n${TERM_TABLE_HEADER}\n${rows.join('\n')}`);
  }
  return [
    '# 物品与机器总表',
    '',
    ...GENERATED_NOTE,
    `> 条目数：${entities.length}。`,
    '',
    ...blocks.flatMap((block) => [block, '']),
  ].join('\n');
}

function renderDerivations(knowledgeBase: KnowledgeBase): string {
  const { derivations, entityDerivations } = knowledgeBase;
  const formatSection = (title: string, config: typeof derivations): string[] => {
    const familyBlocks = config.families.map((family) => {
      const template = family.template === undefined ? '—' : `\`${family.template.en}\` → \`${family.template.zh}\``;
      const patterns = family.keyPatterns.map((pattern) => `\`${pattern}\``).join(' ');
      return [`### ${family.id}`, '', family.description, '', `- 模板：${template}`, `- 键模式：${patterns}`].join(
        '\n',
      );
    });
    const placeholderRows = config.internalPlaceholders.map(
      (entry) => `| ${entry.keys.map((key) => `\`${key}\``).join(' ')} | ${cell(entry.reason)} |`,
    );
    return [
      `## ${title}`,
      '',
      ...familyBlocks.flatMap((block) => [block, '']),
      `### ${title}：内部占位与非实体键`,
      '',
      '| 语言键 | 说明 |',
      '| --- | --- |',
      ...placeholderRows,
      '',
    ];
  };

  return [
    '# 规则派生材料与实体',
    '',
    ...GENERATED_NOTE,
    '',
    ...formatSection('规则派生材料（material-derivations）', derivations),
    ...(entityDerivations ? formatSection('规则派生实体（entity-derivations）', entityDerivations) : []),
  ].join('\n');
}

function renderIndex(knowledgeBase: KnowledgeBase): string {
  const { materials, glossary, entities, derivations } = knowledgeBase;
  const categoryCounts = groupBy(materials, (record) => record.category);
  const kindCounts = groupBy(materials, (record) => record.origin.kind);
  const evidenceCounts = groupBy(materials, (record) => record.origin.evidence);

  const categoryTable = [
    '| 类别 | 条目数 |',
    '| --- | ---: |',
    ...CATEGORY_ORDER.filter((category) => categoryCounts.has(category)).map(
      (category) => `| ${CATEGORY_TITLES[category]} | ${categoryCounts.get(category)!.length} |`,
    ),
  ].join('\n');

  const kindTable = [
    '| 出处大类 | 条目数 |',
    '| --- | ---: |',
    ...[...kindCounts.keys()]
      .sort((left, right) => left.localeCompare(right, 'en'))
      .map((kind) => `| ${kind} | ${kindCounts.get(kind)!.length} |`),
  ].join('\n');

  const evidenceTable = [
    '| 证据等级 | 条目数 |',
    '| --- | ---: |',
    ...(['verified', 'inferred', 'unknown'] as const).map(
      (level) => `| ${EVIDENCE_TITLES[level]} | ${evidenceCounts.get(level)?.length ?? 0} |`,
    ),
  ].join('\n');

  return [
    '# 材料、术语与游戏对象知识库导出',
    '',
    ...GENERATED_NOTE,
    '',
    '## 文件',
    '',
    '| 文件 | 内容 |',
    '| --- | --- |',
    `| [materials.md](materials.md) | 材料总表，${materials.length} 条，按类别分节 |`,
    `| [glossary.md](glossary.md) | 规则术语总表，${glossary.length} 条，按域分节 |`,
    `| [entities.md](entities.md) | 物品与机器总表，${entities.length} 条，按域分节 |`,
    `| [derivations.md](derivations.md) | 规则派生族（${derivations.families.length + (knowledgeBase.entityDerivations?.families.length ?? 0)}）与内部占位键 |`,
    '',
    '## 材料类别分布',
    '',
    categoryTable,
    '',
    '## 出处大类分布',
    '',
    kindTable,
    '',
    '## 证据等级分布',
    '',
    evidenceTable,
    '',
  ].join('\n');
}

/** 渲染全部阅读视图；键是导出目录下的文件名（总览用 index.md，避免与仓库 docs/materials/README.md 混淆）。 */
export function renderMaterialsMarkdown(knowledgeBase: KnowledgeBase): RenderedDocs {
  return {
    'index.md': renderIndex(knowledgeBase),
    'materials.md': renderMaterials(knowledgeBase.materials),
    'glossary.md': renderGlossary(knowledgeBase.glossary),
    'entities.md': renderEntities(knowledgeBase.entities),
    'derivations.md': renderDerivations(knowledgeBase),
  };
}
