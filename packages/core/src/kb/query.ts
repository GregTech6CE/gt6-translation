/**
 * 知识库检索：按 id、英文、中文、语言键与特征查材料/术语全貌。
 *
 * 排序固定（精确 id > 精确中文 > 精确英文 > 前缀 > 包含），保证脚本输出稳定。
 */
import type { GlossaryRecord, KnowledgeBase, MaterialRecord, QueryHit, QueryOptions } from './types.ts';

const DEFAULT_LIMIT = 20;

interface Candidate {
  hit: QueryHit;
  score: number;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function scoreOf(field: string, value: string, term: string): number {
  const target = normalize(value);
  if (target === term) {
    if (field === 'id') return 0;
    if (field.startsWith('zh.')) return 1;
    if (field.startsWith('en.')) return 2;
    return 3;
  }
  if (target.startsWith(term)) return 4;
  if (target.includes(term)) return 5;
  return Number.POSITIVE_INFINITY;
}

function candidatesOf(
  kind: QueryHit['kind'],
  id: string,
  en: string,
  zh: string,
  fields: ReadonlyArray<readonly [string, string]>,
  term: string,
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const [field, value] of fields) {
    const score = scoreOf(field, value, term);
    if (score === Number.POSITIVE_INFINITY) continue;
    candidates.push({ score, hit: { kind, id, en, zh, matchedOn: field } });
  }
  return candidates;
}

function materialCandidates(record: MaterialRecord, term: string): Candidate[] {
  const fields: Array<[string, string]> = [
    ['id', record.id],
    ['en.canonical', record.en.canonical],
    ['zh.canonical', record.zh.canonical],
  ];
  for (const alias of record.en.aliases ?? []) fields.push(['en.aliases', alias]);
  for (const alias of record.zh.aliases ?? []) fields.push(['zh.aliases', alias]);
  for (const entry of record.zh.legacy ?? []) fields.push(['zh.legacy', entry.text]);
  if (record.en.latin) fields.push(['en.latin', record.en.latin]);
  if (record.en.common) fields.push(['en.common', record.en.common]);
  for (const name of Object.values(record.zh.stateNames ?? {})) {
    if (name) fields.push(['zh.stateNames', name]);
  }
  for (const [namespace, keys] of Object.entries(record.keys)) {
    for (const key of keys ?? []) fields.push([`keys.${namespace}`, key]);
  }
  for (const trait of record.traits ?? []) fields.push(['traits', trait]);
  fields.push(['category', record.category]);
  fields.push(['origin.source', record.origin.source]);

  return candidatesOf('material', record.id, record.en.canonical, record.zh.canonical, fields, term).map(
    (candidate) => ({ ...candidate, hit: { ...candidate.hit, material: record } }),
  );
}

function glossaryCandidates(record: GlossaryRecord, term: string): Candidate[] {
  const fields: Array<[string, string]> = [
    ['id', record.id],
    ['en.canonical', record.en.canonical],
    ['zh.canonical', record.zh.canonical],
  ];
  for (const alias of record.en.aliases ?? []) fields.push(['en.aliases', alias]);
  for (const alias of record.zh.aliases ?? []) fields.push(['zh.aliases', alias]);
  for (const entry of record.zh.legacy ?? []) fields.push(['zh.legacy', entry.text]);
  for (const [namespace, keys] of Object.entries(record.keys ?? {})) {
    for (const key of keys ?? []) fields.push([`keys.${namespace}`, key]);
  }
  fields.push(['domain', record.domain]);

  return candidatesOf('glossary', record.id, record.en.canonical, record.zh.canonical, fields, term).map(
    (candidate) => ({ ...candidate, hit: { ...candidate.hit, glossary: record } }),
  );
}

/** 检索知识库；同一实体只返回一次，取最高分字段。 */
export function queryKnowledgeBase(knowledgeBase: KnowledgeBase, term: string, options: QueryOptions = {}): QueryHit[] {
  const normalized = normalize(term);
  if (normalized === '') return [];
  const domain = options.domain ?? 'all';
  const limit = options.limit ?? DEFAULT_LIMIT;
  const candidates: Candidate[] = [];
  if (domain === 'all' || domain === 'material') {
    for (const record of knowledgeBase.materials) candidates.push(...materialCandidates(record, normalized));
  }
  if (domain === 'all' || domain === 'glossary') {
    for (const record of knowledgeBase.glossary) candidates.push(...glossaryCandidates(record, normalized));
  }

  const best = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = `${candidate.hit.kind}:${candidate.hit.id}`;
    const current = best.get(key);
    if (current === undefined || candidate.score < current.score) {
      best.set(key, candidate);
    }
  }

  return [...best.values()]
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score;
      if (left.hit.kind !== right.hit.kind) return left.hit.kind === 'material' ? -1 : 1;
      return left.hit.id.localeCompare(right.hit.id);
    })
    .slice(0, limit)
    .map((candidate) => candidate.hit);
}
