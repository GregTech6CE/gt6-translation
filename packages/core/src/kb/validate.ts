/**
 * 知识库门禁：schema、键、出处与中文撞车检查。
 *
 * `kb validate` 与单测都走这里。error 表示知识库不可用，warning 表示需要人工复核。
 * 证据不足不再逐条警告（`origin.no-url` 已移除），只在 `stats.evidence` 里统计分布。
 */
import type { ZodType } from 'zod';
import { glossaryRecordSchema, materialDerivationsSchema, materialRecordSchema } from './schema.ts';
import type {
  GlossaryRecord,
  MaterialDerivationsConfig,
  MaterialRecord,
  ValidationIssue,
  ValidationReport,
  ValidationStats,
} from './types.ts';

/** 语言键里不允许出现的分隔符：`<br>` 会把多键挤进一格，空白会让键无法回查。 */
const ILLEGAL_KEY_PATTERN = /<br\s*\/?>|\s/;

/** 物品/材料/方块规范译名禁止用顿号并列（#18）。 */
const FORBIDDEN_ZH_PATTERN = /、/;

/** 禁止把待译占位文本写进 zh.canonical。 */
const PLACEHOLDER_ZH_PATTERN = /未译|建议[:：]|Unicode/i;

const KEY_NAMESPACES = ['gt6', 'gt6ce', 'gt6w'] as const;

function issue(
  code: string,
  severity: ValidationIssue['severity'],
  message: string,
  subject?: string,
): ValidationIssue {
  return subject === undefined ? { code, severity, message } : { code, severity, message, subject };
}

function checkSchema<T>(
  records: readonly T[],
  schema: ZodType<unknown>,
  label: string,
  issues: ValidationIssue[],
): void {
  records.forEach((record, index) => {
    const result = schema.safeParse(record);
    if (result.success) return;
    const detail = result.error.issues
      .map((entry) => {
        const path = entry.path.map((segment) => String(segment)).join('.');
        return path ? `${path}: ${entry.message}` : entry.message;
      })
      .join('; ');
    issues.push(issue('schema.invalid', 'error', `${label} 第 ${index + 1} 条不符合 schema：${detail}`));
  });
}

function checkIds(records: readonly { id: string }[], label: string, issues: ValidationIssue[]): void {
  const seen = new Map<string, number>();
  for (const record of records) {
    seen.set(record.id, (seen.get(record.id) ?? 0) + 1);
  }
  for (const [id, count] of seen) {
    if (count > 1) {
      issues.push(issue('id.duplicate', 'error', `${label} 的 id 重复 ${count} 次`, id));
    }
  }
}

interface KeyedRecord {
  id: string;
  keys?: { gt6?: string[]; gt6ce?: string[]; gt6w?: string[] };
}

function checkKeys(
  records: readonly KeyedRecord[],
  label: string,
  issues: ValidationIssue[],
): { total: number; owner: Map<string, string> } {
  const owner = new Map<string, string>();
  let total = 0;
  for (const record of records) {
    for (const namespace of KEY_NAMESPACES) {
      for (const key of record.keys?.[namespace] ?? []) {
        total++;
        if (ILLEGAL_KEY_PATTERN.test(key)) {
          issues.push(
            issue(
              'key.illegal',
              'error',
              `${label} 的 ${namespace} 键含 <br> 或空白：${JSON.stringify(key)}`,
              record.id,
            ),
          );
        }
        const previous = owner.get(key);
        if (previous !== undefined && previous !== record.id) {
          issues.push(
            issue('key.duplicate', 'error', `${label} 的键 ${key} 同时属于 ${previous} 与 ${record.id}`, key),
          );
        } else {
          owner.set(key, record.id);
        }
      }
    }
  }
  return { total, owner };
}

/** 跨表共用键：同一语言键不能既是材料又是术语。 */
function checkCrossTableKeys(
  materials: Map<string, string>,
  glossary: Map<string, string>,
  issues: ValidationIssue[],
): void {
  for (const [key, materialId] of materials) {
    const glossaryId = glossary.get(key);
    if (glossaryId === undefined) continue;
    issues.push(issue('key.duplicate', 'error', `键 ${key} 同时登记为材料 ${materialId} 与术语 ${glossaryId}`, key));
  }
}

interface CollisionCandidate {
  qualifiedId: string;
  id: string;
  zh: { canonical: string };
  allowSameZhReason?: string;
}

function checkAllZhCollisions(
  materials: readonly MaterialRecord[],
  glossary: readonly GlossaryRecord[],
  issues: ValidationIssue[],
): void {
  const all: CollisionCandidate[] = [
    ...materials.map((record) => ({
      qualifiedId: `material:${record.id}`,
      id: record.id,
      zh: record.zh,
      allowSameZhReason: record.allowSameZhReason,
    })),
    ...glossary.map((record) => ({
      qualifiedId: `glossary:${record.id}`,
      id: record.id,
      zh: record.zh,
      allowSameZhReason: record.allowSameZhReason,
    })),
  ];

  const groups = new Map<string, CollisionCandidate[]>();
  for (const record of all) {
    const list = groups.get(record.zh.canonical) ?? [];
    list.push(record);
    groups.set(record.zh.canonical, list);
  }
  for (const [name, members] of groups) {
    if (members.length < 2) continue;
    for (const record of members) {
      if (record.allowSameZhReason) continue;
      const others = members
        .filter((other) => other.qualifiedId !== record.qualifiedId)
        .map((other) => other.qualifiedId)
        .join('、');
      issues.push(
        issue(
          'zh.collision',
          'error',
          `${record.qualifiedId} 的中文名「${name}」与 ${others} 撞车，且未声明 allowSameZhReason`,
          record.id,
        ),
      );
    }
  }
}

interface ForbiddenZhRecord {
  id: string;
  zh: {
    canonical: string;
    aliases?: string[];
    stateNames?: Partial<Record<string, string>>;
    regionVariants?: Record<string, string>;
  };
}

function checkForbiddenZh(records: readonly ForbiddenZhRecord[], label: string, issues: ValidationIssue[]): void {
  for (const record of records) {
    if (FORBIDDEN_ZH_PATTERN.test(record.zh.canonical)) {
      issues.push(
        issue('zh.forbidden-separator', 'error', `${label} 的规范译名含顿号：${record.zh.canonical}`, record.id),
      );
    }
    if (PLACEHOLDER_ZH_PATTERN.test(record.zh.canonical)) {
      issues.push(
        issue(
          'zh.placeholder-meta',
          'error',
          `${label} 的规范译名含占位/元信息文本：${record.zh.canonical}`,
          record.id,
        ),
      );
    }
    for (const [state, name] of Object.entries(record.zh.stateNames ?? {})) {
      if (name && FORBIDDEN_ZH_PATTERN.test(name)) {
        issues.push(
          issue('zh.forbidden-separator', 'error', `${label} 的 stateNames.${state} 含顿号：${name}`, record.id),
        );
      }
    }
    for (const [region, name] of Object.entries(record.zh.regionVariants ?? {})) {
      if (FORBIDDEN_ZH_PATTERN.test(name)) {
        issues.push(
          issue('zh.forbidden-separator', 'error', `${label} 的 regionVariants.${region} 含顿号：${name}`, record.id),
        );
      }
    }
    for (const alias of record.zh.aliases ?? []) {
      if (FORBIDDEN_ZH_PATTERN.test(alias)) {
        issues.push(issue('zh.forbidden-separator', 'warning', `${label} 的别名含顿号：${alias}`, record.id));
      }
    }
  }
}

/** `zh.legacy` 里不该再出现与现行规范名相同的文本。 */
function checkLegacyTerms(
  records: readonly { id: string; zh: { canonical: string; legacy?: Array<{ text: string }> } }[],
  label: string,
  issues: ValidationIssue[],
): void {
  for (const record of records) {
    for (const entry of record.zh.legacy ?? []) {
      if (entry.text !== record.zh.canonical) continue;
      issues.push(
        issue(
          'zh.legacy-matches-canonical',
          'warning',
          `${label} 的 zh.legacy 仍保留与规范译名相同的「${entry.text}」`,
          record.id,
        ),
      );
    }
  }
}

function checkMaterials(materials: readonly MaterialRecord[], issues: ValidationIssue[]): void {
  const numericIds = new Map<number, string>();
  const englishNames = new Map<string, string[]>();
  for (const record of materials) {
    for (const url of record.origin.urls ?? []) {
      if (/MT\.java/i.test(url)) {
        issues.push(
          issue(
            'origin.mt-ref',
            'error',
            `origin.urls 不得引用 MT.java（反循环出处），请移到 targets.mtRef：${url}`,
            record.id,
          ),
        );
      }
    }
    if (
      record.origin.evidence === 'verified' &&
      (record.origin.urls ?? []).length === 0 &&
      record.origin.kind !== 'gt6'
    ) {
      issues.push(
        issue(
          'origin.verified-no-url',
          'warning',
          `${record.origin.kind} 条目标为 verified 但没有外部信源链接`,
          record.id,
        ),
      );
    }
    if (record.zh.canonical === record.en.canonical) {
      issues.push(issue('zh.untranslated', 'warning', `中文名仍是英文：${record.zh.canonical}`, record.id));
    }
    if (record.targets.numericId !== undefined) {
      const previous = numericIds.get(record.targets.numericId);
      if (previous !== undefined) {
        issues.push(
          issue(
            'numeric-id.duplicate',
            'error',
            `数值 ID ${record.targets.numericId} 同时属于 ${previous} 与 ${record.id}`,
            record.id,
          ),
        );
      } else {
        numericIds.set(record.targets.numericId, record.id);
      }
    }
    const english = englishNames.get(record.en.canonical) ?? [];
    english.push(record.id);
    englishNames.set(record.en.canonical, english);
    for (const [state, name] of Object.entries(record.zh.stateNames ?? {})) {
      if (name === undefined) continue;
      if (!record.states.includes(state as MaterialRecord['states'][number])) {
        issues.push(
          issue('zh.state-name-unused', 'warning', `stateNames.${state} 对应的形态不在 states 中`, record.id),
        );
      }
    }
    const ceKeys = (record.keys.gt6ce ?? []).length;
    if (record.targets.gt6ce === 'active' && ceKeys === 0) {
      issues.push(issue('parity.missing-ce-key', 'warning', 'targets.gt6ce 为 active 但没有 gt6ce 键', record.id));
    }
    if (record.targets.gt6ce === 'removed' && ceKeys > 0) {
      issues.push(issue('parity.removed-with-key', 'error', 'targets.gt6ce 为 removed 但仍登记 gt6ce 键', record.id));
    }
    if (record.targets.gt6ce === 'legacy-only' && ceKeys > 0) {
      issues.push(
        issue('parity.legacy-with-key', 'error', 'targets.gt6ce 为 legacy-only 但仍登记 gt6ce 键', record.id),
      );
    }
  }
  for (const [name, ids] of englishNames) {
    if (ids.length > 1) {
      issues.push(issue('en.duplicate', 'warning', `英文名 ${name} 出现在多条记录：${ids.join('、')}`));
    }
  }
}

function checkGlossaryReferences(glossary: readonly GlossaryRecord[], issues: ValidationIssue[]): void {
  const ids = new Set(glossary.map((record) => record.id));
  for (const record of glossary) {
    for (const target of record.seeAlso ?? []) {
      if (ids.has(target)) continue;
      issues.push(
        issue('glossary.dangling-see-also', 'warning', `seeAlso 引用了不存在的术语 id：${target}`, record.id),
      );
    }
  }
}

function checkDerivations(derivations: MaterialDerivationsConfig, issues: ValidationIssue[]): void {
  const familyIds = new Set<string>();
  for (const family of derivations.families) {
    if (familyIds.has(family.id)) {
      issues.push(issue('derivation.duplicate-family', 'error', `派生族 id 重复：${family.id}`, family.id));
    }
    familyIds.add(family.id);
    for (const pattern of family.keyPatterns) {
      try {
        new RegExp(pattern, family.flags ?? '');
      } catch (error) {
        issues.push(
          issue(
            'derivation.bad-regex',
            'error',
            `派生族正则无法编译（${family.id}）：${(error as Error).message}`,
            family.id,
          ),
        );
      }
    }
  }
  const seen = new Set<string>();
  for (const placeholder of derivations.internalPlaceholders) {
    for (const key of placeholder.keys) {
      if (seen.has(key)) {
        issues.push(issue('derivation.duplicate-placeholder', 'error', `内部占位键重复：${key}`, key));
      }
      seen.add(key);
    }
  }
}

function sortIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const order = { error: 0, warning: 1 } as const;
  return [...issues].sort((left, right) => {
    if (order[left.severity] !== order[right.severity]) return order[left.severity] - order[right.severity];
    if (left.code !== right.code) return left.code.localeCompare(right.code);
    return (left.subject ?? '').localeCompare(right.subject ?? '');
  });
}

/**
 * 校验整套知识库。
 *
 * 强制拦截：schema 非法、id/键重复（含材料与术语跨表共用键）、键含 `<br>` 或空白、
 * `origin.urls` 引用 MT.java、未登记的中文撞车、规范译名含顿号、派生族正则不可编译。
 */
export function validateKnowledgeBase(
  materials: readonly MaterialRecord[],
  glossary: readonly GlossaryRecord[],
  derivations: MaterialDerivationsConfig,
): ValidationReport {
  const issues: ValidationIssue[] = [];
  checkSchema(materials, materialRecordSchema, 'materials', issues);
  checkSchema(glossary, glossaryRecordSchema, 'glossary', issues);
  checkSchema([derivations], materialDerivationsSchema, 'derivations', issues);
  checkIds(materials, 'materials', issues);
  checkIds(glossary, 'glossary', issues);
  const materialKeys = checkKeys(materials, 'materials', issues);
  const glossaryKeys = checkKeys(glossary, 'glossary', issues);
  checkCrossTableKeys(materialKeys.owner, glossaryKeys.owner, issues);
  checkAllZhCollisions(materials, glossary, issues);
  checkForbiddenZh(materials, 'materials', issues);
  checkForbiddenZh(glossary, 'glossary', issues);
  checkLegacyTerms(materials, 'materials', issues);
  checkLegacyTerms(glossary, 'glossary', issues);
  checkMaterials(materials, issues);
  checkGlossaryReferences(glossary, issues);
  checkDerivations(derivations, issues);

  const evidence = { verified: 0, inferred: 0, unknown: 0 };
  for (const record of materials) evidence[record.origin.evidence] += 1;

  const stats: ValidationStats = {
    materials: materials.length,
    glossary: glossary.length,
    families: derivations.families.length,
    internalPlaceholders: derivations.internalPlaceholders.reduce((total, entry) => total + entry.keys.length, 0),
    materialKeys: materialKeys.total,
    glossaryKeys: glossaryKeys.total,
    evidence,
  };
  const sorted = sortIssues(issues);
  const errors = sorted.filter((entry) => entry.severity === 'error');
  const warnings = sorted.filter((entry) => entry.severity === 'warning');
  return { ok: errors.length === 0, errors, warnings, stats };
}
