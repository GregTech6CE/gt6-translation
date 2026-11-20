import {
  detectUnicodeRisks,
  formatAnnotatedZh,
  formatFullEn,
  formatFullZh,
  parseKnowledgeBase,
  validateKnowledgeBase,
  type CeParityStatus,
  type EntityDomain,
  type EntityRecord,
  type EvidenceLevel,
  type GlossaryDomain,
  type GlossaryKeys,
  type GlossaryRecord,
  type KnowledgeBase,
  type LegacyTermStatus,
  type LoadIssue,
  type LocalizedZh,
  type MaterialCategory,
  type MaterialKeys,
  type MaterialRecord,
  type OriginKind,
  type UnicodeRiskChar,
  type ValidationIssue,
  type ValidationReport,
} from '@gt6tg/core';
import corpusSnapshot, { type KbCorpusSnapshot } from 'virtual:gt6tg-kb-corpus';
import entitiesRaw from '../../../../knowledge/entities.jsonl?raw';
import entityDerivationsRaw from '../../../../knowledge/entity-derivations.json?raw';
import glossaryRaw from '../../../../knowledge/glossary.jsonl?raw';
import derivationsRaw from '../../../../knowledge/material-derivations.json?raw';
import materialsRaw from '../../../../knowledge/materials.jsonl?raw';

export type KbEntryKind = 'material' | 'glossary' | 'entity';

export interface CorpusKeyValue {
  key: string;
  value: string;
  sameAsCanonical: boolean;
  pureSuffixDiff: boolean;
  inLegacy: boolean;
}

export interface CorpusComparison {
  gt6: CorpusKeyValue[];
  gt6ce: CorpusKeyValue[];
  gt6Diff: boolean;
  gt6ceDiff: boolean;
  anyDiff: boolean;
  onlySuffixDiff: boolean;
  gt6MultiSplit: boolean;
  gt6ceMultiSplit: boolean;
  multiKeySplit: boolean;
  unrecordedDiff: boolean;
  hasAnyCorpus: boolean;
}

interface BaseKbRow {
  kind: KbEntryKind;
  id: string;
  issues: ValidationIssue[];
  untranslated: boolean;
  hasCollision: boolean;
  hasSuffix: boolean;
  hasVariant: boolean;
  unicodeRisks: UnicodeRiskChar[];
  hasUnicodeRisk: boolean;
  allConsistent: boolean;
  corpus: CorpusComparison;
  searchText: string;
}

export interface MaterialRow extends BaseKbRow {
  kind: 'material';
  record: MaterialRecord;
  childVariantIds: string[];
}

export interface GlossaryRow extends BaseKbRow {
  kind: 'glossary';
  record: GlossaryRecord;
}

export interface EntityRow extends BaseKbRow {
  kind: 'entity';
  record: EntityRecord;
}

export type KbRow = MaterialRow | GlossaryRow | EntityRow;

export interface KbRefTarget {
  kind: KbEntryKind;
  id: string;
  enLabel: string;
  zhLabel: string;
}

export interface LoadedKbBundle {
  knowledgeBase?: KnowledgeBase;
  loadIssues: LoadIssue[];
  report?: ValidationReport;
  issuesBySubject: Map<string, ValidationIssue[]>;
  allGt6ceKeys: Set<string>;
  lookupById: Map<string, KbRefTarget>;
  defaultCorpus: KbCorpusSnapshot;
}

export const CATEGORY_LABELS: Record<MaterialCategory, string> = {
  element: '元素',
  compound: '化合物',
  alloy: '合金',
  mineral: '矿物',
  gem: '宝石',
  rock: '岩石',
  wood: '木材',
  fluid: '流体',
  food: '食品',
  dye: '染料',
  isotope: '同位素',
  particle: '粒子',
  other: '其他',
};

export const DOMAIN_LABELS: Record<GlossaryDomain, string> = {
  prefix: '形态前缀',
  affix: '词缀',
  tier: '电压/等级',
  mechanic: '机制',
  ui: '界面',
  unit: '单位',
};

export const ENTITY_DOMAIN_LABELS: Record<EntityDomain, string> = {
  machine: '机器',
  multiblock: '多方块',
  storage: '存储',
  logistics: '物流',
  cover: '覆盖板',
  tool: '工具',
  item: '物品',
  food: '食物饮品',
  bumblebee: '蜜蜂',
  block: '方块',
  fluid: '流体',
};

export const KIND_LABELS: Record<KbEntryKind, string> = {
  material: '材料',
  glossary: '规则术语',
  entity: '物品与机器',
};

export const ORIGIN_KIND_LABELS: Record<OriginKind, string> = {
  'real-world': '现实',
  minecraft: 'Minecraft',
  mod: 'Mod',
  fiction: '作品/虚构',
  gt6: 'GT6 原创',
  unknown: '待考',
};

export const EVIDENCE_LABELS: Record<EvidenceLevel, string> = {
  verified: '已核实',
  inferred: '推断',
  unknown: '无证据',
};

export const GT6CE_STATUS_LABELS: Record<CeParityStatus, string> = {
  active: '已收录',
  removed: '已移除',
  renamed: '已更名',
  'legacy-only': '仅旧版',
};

export const LEGACY_STATUS_LABELS: Record<LegacyTermStatus, string> = {
  legacy: '旧译',
  rejected: '不采用',
  proposed: '待定',
};

export const LEGACY_SOURCE_LABELS: Record<string, string> = {
  'gt6-lang': 'GT6 原版汉化',
  'gt6ce-lang': 'GT6CE 汉化',
  'docs-materials': '历史材料分表',
  'gt6ce-changelog': 'GT6CE 更新日志',
};

export function formatLegacySource(source: string): string {
  return LEGACY_SOURCE_LABELS[source] ?? source;
}

/** GT6 模板切分常见的尾缀差异（用于降噪筛查）。 */
const TEMPLATE_SUFFIXES = [
  '树木',
  '岩石',
  '染料',
  '液体',
  '气体',
  '流体',
  '矿石',
  '矿',
  '石',
  '木',
  '树',
  '粉',
  '锭',
] as const;
const WOOD_ENDINGS = ['树木', '树', '木'] as const;

function stripWoodEnding(text: string): string | null {
  for (const ending of WOOD_ENDINGS) {
    if (text.endsWith(ending) && text.length - ending.length >= 2) {
      return text.slice(0, -ending.length);
    }
  }
  return null;
}

export function isPureSuffixDiff(value: string, zh: LocalizedZh): boolean {
  const targets = [zh.canonical, formatFullZh(zh)];
  for (const target of targets) {
    if (value === target) return false;
    for (const suffix of TEMPLATE_SUFFIXES) {
      if (value === `${target}${suffix}` || target === `${value}${suffix}`) {
        return true;
      }
    }
    const vStem = stripWoodEnding(value);
    const tStem = stripWoodEnding(target);
    if (vStem && tStem && vStem === tStem) {
      return true;
    }
  }
  return false;
}

function collectKnownZh(zh: LocalizedZh): Set<string> {
  const known = new Set<string>([zh.canonical, formatFullZh(zh)]);
  for (const entry of zh.legacy ?? []) known.add(entry.text);
  for (const alias of zh.aliases ?? []) known.add(alias);
  for (const value of Object.values(zh.regionVariants ?? {})) {
    if (value) known.add(value);
  }
  return known;
}

function matchesCanonicalZh(value: string, zh: LocalizedZh): boolean {
  return value === zh.canonical || value === formatFullZh(zh);
}

export function buildCorpusComparison(
  keys: MaterialKeys | GlossaryKeys | undefined,
  zh: LocalizedZh,
  gt6Map: Record<string, string>,
  gt6ceMap: Record<string, string>,
): CorpusComparison {
  const known = collectKnownZh(zh);
  const gt6: CorpusKeyValue[] = [];
  const gt6ce: CorpusKeyValue[] = [];

  for (const key of keys?.gt6 ?? []) {
    const value = gt6Map[key];
    if (value !== undefined) {
      const sameAsCanonical = matchesCanonicalZh(value, zh);
      gt6.push({
        key,
        value,
        sameAsCanonical,
        pureSuffixDiff: !sameAsCanonical && isPureSuffixDiff(value, zh),
        inLegacy: known.has(value),
      });
    }
  }

  for (const key of keys?.gt6ce ?? []) {
    const value = gt6ceMap[key];
    if (value !== undefined) {
      const sameAsCanonical = matchesCanonicalZh(value, zh);
      gt6ce.push({
        key,
        value,
        sameAsCanonical,
        pureSuffixDiff: !sameAsCanonical && isPureSuffixDiff(value, zh),
        inLegacy: known.has(value),
      });
    }
  }

  const gt6Diff = gt6.some((entry) => !entry.sameAsCanonical);
  const gt6ceDiff = gt6ce.some((entry) => !entry.sameAsCanonical);
  const anyDiff = gt6Diff || gt6ceDiff;
  const allDiffEntries = [...gt6, ...gt6ce].filter((entry) => !entry.sameAsCanonical);
  const onlySuffixDiff = anyDiff && allDiffEntries.every((entry) => entry.pureSuffixDiff);
  const gt6MultiSplit = new Set(gt6.map((entry) => entry.value)).size > 1;
  const gt6ceMultiSplit = new Set(gt6ce.map((entry) => entry.value)).size > 1;
  const multiKeySplit = gt6MultiSplit || gt6ceMultiSplit;
  const unrecordedDiff = allDiffEntries.some((entry) => !entry.inLegacy);
  const hasAnyCorpus = gt6.length > 0 || gt6ce.length > 0;

  return {
    gt6,
    gt6ce,
    gt6Diff,
    gt6ceDiff,
    anyDiff,
    onlySuffixDiff,
    gt6MultiSplit,
    gt6ceMultiSplit,
    multiKeySplit,
    unrecordedDiff,
    hasAnyCorpus,
  };
}

function buildSearchText(parts: Array<string | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part))
    .join('\n')
    .toLowerCase();
}

export function buildMaterialRows(
  materials: readonly MaterialRecord[],
  issuesBySubject: Map<string, ValidationIssue[]>,
  gt6Map: Record<string, string>,
  gt6ceMap: Record<string, string>,
): MaterialRow[] {
  const childrenByParent = new Map<string, string[]>();
  for (const record of materials) {
    if (!record.variantOf) continue;
    const list = childrenByParent.get(record.variantOf) ?? [];
    list.push(record.id);
    childrenByParent.set(record.variantOf, list);
  }

  return materials.map((record) => {
    const issues = issuesBySubject.get(record.id) ?? [];
    const corpus = buildCorpusComparison(record.keys, record.zh, gt6Map, gt6ceMap);
    const untranslated = issues.some((issue) => issue.code === 'zh.untranslated');
    const hasCollision = Boolean(record.allowSameZhReason) || issues.some((issue) => issue.code === 'zh.collision');
    const hasSuffix = Boolean(record.en.suffix || record.zh.suffix);
    const childVariantIds = childrenByParent.get(record.id) ?? [];
    const hasVariant = Boolean(record.variantOf) || childVariantIds.length > 0;
    const unicodeRisks = detectUnicodeRisks(formatFullZh(record.zh));
    const hasUnicodeRisk = unicodeRisks.length > 0;
    const allConsistent =
      corpus.hasAnyCorpus &&
      !corpus.anyDiff &&
      !corpus.multiKeySplit &&
      !untranslated &&
      !hasUnicodeRisk &&
      issues.length === 0;

    const searchText = buildSearchText([
      record.id,
      record.en.canonical,
      record.en.suffix,
      formatFullEn(record.en),
      ...(record.en.aliases ?? []),
      record.en.latin,
      record.en.common,
      record.zh.canonical,
      record.zh.suffix,
      formatFullZh(record.zh),
      formatAnnotatedZh(record.zh),
      ...(record.zh.aliases ?? []),
      ...(record.zh.legacy ?? []).flatMap((entry) => [entry.text, entry.source, entry.note]),
      ...Object.values(record.zh.regionVariants ?? {}),
      ...(record.keys.gt6 ?? []),
      ...(record.keys.gt6ce ?? []),
      ...(record.keys.gt6w ?? []),
      ...corpus.gt6.map((entry) => entry.value),
      ...corpus.gt6ce.map((entry) => entry.value),
      record.composition?.formula,
      record.composition?.source,
      record.composition?.gt6,
      record.composition?.note,
      record.origin.source,
      ...(record.origin.alsoIn ?? []),
      record.targets.modTag,
      record.variantOf,
      ...(record.seeAlso ?? []),
      record.allowSameZhReason,
      record.notes,
    ]);

    return {
      kind: 'material',
      id: record.id,
      record,
      childVariantIds,
      issues,
      untranslated,
      hasCollision,
      hasSuffix,
      hasVariant,
      unicodeRisks,
      hasUnicodeRisk,
      allConsistent,
      corpus,
      searchText,
    };
  });
}

export function buildGlossaryRows(
  glossary: readonly GlossaryRecord[],
  issuesBySubject: Map<string, ValidationIssue[]>,
  gt6Map: Record<string, string>,
  gt6ceMap: Record<string, string>,
): GlossaryRow[] {
  return glossary.map((record) => {
    const issues = issuesBySubject.get(record.id) ?? [];
    const corpus = buildCorpusComparison(record.keys, record.zh, gt6Map, gt6ceMap);
    const untranslated = issues.some((issue) => issue.code === 'zh.untranslated');
    const hasCollision = Boolean(record.allowSameZhReason) || issues.some((issue) => issue.code === 'zh.collision');
    const hasSuffix = Boolean(record.en.suffix || record.zh.suffix);
    const unicodeRisks = detectUnicodeRisks(formatFullZh(record.zh));
    const hasUnicodeRisk = unicodeRisks.length > 0;
    const allConsistent =
      corpus.hasAnyCorpus &&
      !corpus.anyDiff &&
      !corpus.multiKeySplit &&
      !untranslated &&
      !hasUnicodeRisk &&
      issues.length === 0;

    const searchText = buildSearchText([
      record.id,
      record.domain,
      DOMAIN_LABELS[record.domain],
      record.en.canonical,
      record.en.suffix,
      formatFullEn(record.en),
      ...(record.en.aliases ?? []),
      record.zh.canonical,
      record.zh.suffix,
      formatFullZh(record.zh),
      formatAnnotatedZh(record.zh),
      ...(record.zh.aliases ?? []),
      ...(record.zh.legacy ?? []).flatMap((entry) => [entry.text, entry.source, entry.note]),
      ...(record.keys?.gt6 ?? []),
      ...(record.keys?.gt6ce ?? []),
      ...(record.keys?.gt6w ?? []),
      ...corpus.gt6.map((entry) => entry.value),
      ...corpus.gt6ce.map((entry) => entry.value),
      ...(record.seeAlso ?? []),
      record.allowSameZhReason,
      record.notes,
    ]);

    return {
      kind: 'glossary',
      id: record.id,
      record,
      issues,
      untranslated,
      hasCollision,
      hasSuffix,
      hasVariant: false,
      unicodeRisks,
      hasUnicodeRisk,
      allConsistent,
      corpus,
      searchText,
    };
  });
}

export function buildEntityRows(
  entities: readonly EntityRecord[],
  issuesBySubject: Map<string, ValidationIssue[]>,
  gt6Map: Record<string, string>,
  gt6ceMap: Record<string, string>,
): EntityRow[] {
  return entities.map((record) => {
    const issues = issuesBySubject.get(record.id) ?? [];
    const corpus = buildCorpusComparison(record.keys, record.zh, gt6Map, gt6ceMap);
    const untranslated = issues.some((issue) => issue.code === 'zh.untranslated');
    const hasCollision = Boolean(record.allowSameZhReason) || issues.some((issue) => issue.code === 'zh.collision');
    const hasSuffix = Boolean(record.en.suffix || record.zh.suffix);
    const unicodeRisks = detectUnicodeRisks(formatFullZh(record.zh));
    const hasUnicodeRisk = unicodeRisks.length > 0;
    const allConsistent =
      corpus.hasAnyCorpus &&
      !corpus.anyDiff &&
      !corpus.multiKeySplit &&
      !untranslated &&
      !hasUnicodeRisk &&
      issues.length === 0;

    const searchText = buildSearchText([
      record.id,
      record.domain,
      ENTITY_DOMAIN_LABELS[record.domain],
      record.en.canonical,
      record.en.suffix,
      formatFullEn(record.en),
      ...(record.en.aliases ?? []),
      record.zh.canonical,
      record.zh.suffix,
      formatFullZh(record.zh),
      formatAnnotatedZh(record.zh),
      ...(record.zh.aliases ?? []),
      ...(record.zh.legacy ?? []).flatMap((entry) => [entry.text, entry.source, entry.note]),
      ...(record.keys?.gt6 ?? []),
      ...(record.keys?.gt6ce ?? []),
      ...(record.keys?.gt6w ?? []),
      ...corpus.gt6.map((entry) => entry.value),
      ...corpus.gt6ce.map((entry) => entry.value),
      ...(record.seeAlso ?? []),
      record.allowSameZhReason,
      record.notes,
    ]);

    return {
      kind: 'entity',
      id: record.id,
      record,
      issues,
      untranslated,
      hasCollision,
      hasSuffix,
      hasVariant: false,
      unicodeRisks,
      hasUnicodeRisk,
      allConsistent,
      corpus,
      searchText,
    };
  });
}

export function parseGt6ceLangJson(text: string, allowedKeys: Set<string>): Record<string, string> {
  const parsed = JSON.parse(text) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('GT6CE 语言文件必须是 JSON 对象');
  }
  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (allowedKeys.has(key) && typeof value === 'string') {
      map[key] = value;
    }
  }
  return map;
}

export function loadBundledKnowledgeBase(): LoadedKbBundle {
  const parsed = parseKnowledgeBase({
    materials: materialsRaw,
    glossary: glossaryRaw,
    entities: entitiesRaw,
    derivations: derivationsRaw,
    entityDerivations: entityDerivationsRaw,
  });
  const issuesBySubject = new Map<string, ValidationIssue[]>();
  const allGt6ceKeys = new Set<string>();
  const lookupById = new Map<string, KbRefTarget>();

  if (!parsed.knowledgeBase) {
    return {
      loadIssues: parsed.issues,
      issuesBySubject,
      allGt6ceKeys,
      lookupById,
      defaultCorpus: corpusSnapshot,
    };
  }

  const report = validateKnowledgeBase(
    parsed.knowledgeBase.materials,
    parsed.knowledgeBase.glossary,
    parsed.knowledgeBase.entities,
    parsed.knowledgeBase.derivations,
    parsed.knowledgeBase.entityDerivations,
  );
  for (const issue of [...report.errors, ...report.warnings]) {
    if (!issue.subject) continue;
    const list = issuesBySubject.get(issue.subject) ?? [];
    list.push(issue);
    issuesBySubject.set(issue.subject, list);
  }
  for (const material of parsed.knowledgeBase.materials) {
    for (const key of material.keys.gt6ce ?? []) allGt6ceKeys.add(key);
    lookupById.set(material.id, {
      kind: 'material',
      id: material.id,
      enLabel: formatFullEn(material.en),
      zhLabel: formatAnnotatedZh(material.zh),
    });
  }
  for (const term of parsed.knowledgeBase.glossary) {
    for (const key of term.keys?.gt6ce ?? []) allGt6ceKeys.add(key);
    lookupById.set(term.id, {
      kind: 'glossary',
      id: term.id,
      enLabel: formatFullEn(term.en),
      zhLabel: formatAnnotatedZh(term.zh),
    });
  }
  for (const entity of parsed.knowledgeBase.entities) {
    for (const key of entity.keys?.gt6ce ?? []) allGt6ceKeys.add(key);
    lookupById.set(entity.id, {
      kind: 'entity',
      id: entity.id,
      enLabel: formatFullEn(entity.en),
      zhLabel: formatAnnotatedZh(entity.zh),
    });
  }

  return {
    knowledgeBase: parsed.knowledgeBase,
    loadIssues: parsed.issues,
    report,
    issuesBySubject,
    allGt6ceKeys,
    lookupById,
    defaultCorpus: corpusSnapshot,
  };
}
