import {
  parseKnowledgeBase,
  validateKnowledgeBase,
  type CeParityStatus,
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
  type MaterialZh,
  type OriginKind,
  type ValidationIssue,
  type ValidationReport,
} from '@gt6tg/core';
import corpusSnapshot, { type KbCorpusSnapshot } from 'virtual:gt6tg-kb-corpus';
import glossaryRaw from '../../../../knowledge/glossary.jsonl?raw';
import derivationsRaw from '../../../../knowledge/material-derivations.json?raw';
import materialsRaw from '../../../../knowledge/materials.jsonl?raw';

export interface CorpusKeyValue {
  key: string;
  value: string;
  sameAsCanonical: boolean;
  inLegacyOrState: boolean;
}

export interface CorpusComparison {
  gt6: CorpusKeyValue[];
  gt6ce: CorpusKeyValue[];
  gt6Diff: boolean;
  gt6ceDiff: boolean;
  anyDiff: boolean;
  unrecordedDiff: boolean;
}

export interface MaterialRow {
  kind: 'material';
  id: string;
  record: MaterialRecord;
  issues: ValidationIssue[];
  untranslated: boolean;
  hasCollision: boolean;
  hasStateNames: boolean;
  corpus: CorpusComparison;
  searchText: string;
}

export interface GlossaryRow {
  kind: 'glossary';
  id: string;
  record: GlossaryRecord;
  issues: ValidationIssue[];
  untranslated: boolean;
  hasCollision: boolean;
  corpus: CorpusComparison;
  searchText: string;
}

export type KbRow = MaterialRow | GlossaryRow;

export interface LoadedKbBundle {
  knowledgeBase?: KnowledgeBase;
  loadIssues: LoadIssue[];
  report?: ValidationReport;
  issuesBySubject: Map<string, ValidationIssue[]>;
  allGt6ceKeys: Set<string>;
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
  machine: '机器',
  block: '方块',
  item: '物品',
  tool: '工具',
  fluid: '流体',
  mechanic: '机制',
  ui: '界面',
  unit: '单位',
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

function collectKnownZh(zh: LocalizedZh | MaterialZh): Set<string> {
  const known = new Set<string>([zh.canonical]);
  for (const entry of zh.legacy ?? []) known.add(entry.text);
  for (const alias of zh.aliases ?? []) known.add(alias);
  if ('stateNames' in zh && zh.stateNames) {
    for (const value of Object.values(zh.stateNames)) {
      if (value) known.add(value);
    }
  }
  for (const value of Object.values(zh.regionVariants ?? {})) {
    if (value) known.add(value);
  }
  return known;
}

export function buildCorpusComparison(
  keys: MaterialKeys | GlossaryKeys | undefined,
  zh: LocalizedZh | MaterialZh,
  gt6Map: Record<string, string>,
  gt6ceMap: Record<string, string>,
): CorpusComparison {
  const known = collectKnownZh(zh);
  const gt6: CorpusKeyValue[] = [];
  const gt6ce: CorpusKeyValue[] = [];

  for (const key of keys?.gt6 ?? []) {
    const value = gt6Map[key];
    if (value !== undefined) {
      gt6.push({
        key,
        value,
        sameAsCanonical: value === zh.canonical,
        inLegacyOrState: known.has(value),
      });
    }
  }

  for (const key of keys?.gt6ce ?? []) {
    const value = gt6ceMap[key];
    if (value !== undefined) {
      gt6ce.push({
        key,
        value,
        sameAsCanonical: value === zh.canonical,
        inLegacyOrState: known.has(value),
      });
    }
  }

  const gt6Diff = gt6.some((entry) => !entry.sameAsCanonical);
  const gt6ceDiff = gt6ce.some((entry) => !entry.sameAsCanonical);
  const unrecordedDiff = gt6.some((entry) => !entry.inLegacyOrState) || gt6ce.some((entry) => !entry.inLegacyOrState);

  return {
    gt6,
    gt6ce,
    gt6Diff,
    gt6ceDiff,
    anyDiff: gt6Diff || gt6ceDiff,
    unrecordedDiff,
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
  return materials.map((record) => {
    const issues = issuesBySubject.get(record.id) ?? [];
    const corpus = buildCorpusComparison(record.keys, record.zh, gt6Map, gt6ceMap);
    const searchText = buildSearchText([
      record.id,
      record.en.canonical,
      ...(record.en.aliases ?? []),
      record.en.latin,
      record.en.common,
      record.zh.canonical,
      ...(record.zh.aliases ?? []),
      ...(record.zh.legacy ?? []).flatMap((entry) => [entry.text, entry.source, entry.note]),
      ...Object.values(record.zh.stateNames ?? {}),
      ...Object.values(record.zh.regionVariants ?? {}),
      ...(record.keys.gt6 ?? []),
      ...(record.keys.gt6ce ?? []),
      ...(record.keys.gt6w ?? []),
      ...corpus.gt6.map((entry) => entry.value),
      ...corpus.gt6ce.map((entry) => entry.value),
      record.composition,
      record.origin.source,
      ...(record.origin.alsoIn ?? []),
      record.targets.modTag,
      record.allowSameZhReason,
      record.notes,
    ]);
    return {
      kind: 'material',
      id: record.id,
      record,
      issues,
      untranslated: issues.some((issue) => issue.code === 'zh.untranslated'),
      hasCollision: Boolean(record.allowSameZhReason) || issues.some((issue) => issue.code === 'zh.collision'),
      hasStateNames: Object.keys(record.zh.stateNames ?? {}).length > 0,
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
    const searchText = buildSearchText([
      record.id,
      record.domain,
      record.en.canonical,
      ...(record.en.aliases ?? []),
      record.zh.canonical,
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
      untranslated: issues.some((issue) => issue.code === 'zh.untranslated'),
      hasCollision: Boolean(record.allowSameZhReason) || issues.some((issue) => issue.code === 'zh.collision'),
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
    derivations: derivationsRaw,
  });
  const issuesBySubject = new Map<string, ValidationIssue[]>();
  const allGt6ceKeys = new Set<string>();

  if (!parsed.knowledgeBase) {
    return {
      loadIssues: parsed.issues,
      issuesBySubject,
      allGt6ceKeys,
      defaultCorpus: corpusSnapshot,
    };
  }

  const report = validateKnowledgeBase(
    parsed.knowledgeBase.materials,
    parsed.knowledgeBase.glossary,
    parsed.knowledgeBase.derivations,
  );
  for (const issue of [...report.errors, ...report.warnings]) {
    if (!issue.subject) continue;
    const list = issuesBySubject.get(issue.subject) ?? [];
    list.push(issue);
    issuesBySubject.set(issue.subject, list);
  }
  for (const material of parsed.knowledgeBase.materials) {
    for (const key of material.keys.gt6ce ?? []) allGt6ceKeys.add(key);
  }
  for (const term of parsed.knowledgeBase.glossary) {
    for (const key of term.keys?.gt6ce ?? []) allGt6ceKeys.add(key);
  }

  return {
    knowledgeBase: parsed.knowledgeBase,
    loadIssues: parsed.issues,
    report,
    issuesBySubject,
    allGt6ceKeys,
    defaultCorpus: corpusSnapshot,
  };
}
