/**
 * 知识库门禁：schema、键、出处、形态变体与中文撞车检查。
 *
 * `kb validate` 与单测都走这里。error 表示知识库不可用，warning 表示需要人工复核。
 * 证据不足不再逐条警告，只在 `stats.evidence` 里统计分布。
 */
import type { ZodType } from 'zod';
import {
  entityDerivationsSchema,
  entityRecordSchema,
  glossaryRecordSchema,
  materialDerivationsSchema,
  materialRecordSchema,
} from './schema.ts';
import {
  formatFullEn,
  formatFullZh,
  type EntityDerivationsConfig,
  type EntityRecord,
  type GlossaryRecord,
  type LocalizedZh,
  type MaterialDerivationsConfig,
  type MaterialRecord,
  type ValidationIssue,
  type ValidationReport,
  type ValidationStats,
} from './types.ts';

/** 语言键里不允许出现的分隔符：`<br>` 会把多键挤进一格，空白会让键无法回查。 */
const ILLEGAL_KEY_PATTERN = /<br\s*\/?>|\s/;

/** 物品/材料/方块规范译名禁止用顿号并列（#18）。 */
const FORBIDDEN_ZH_PATTERN = /、/;

/** 禁止把待译占位文本写进 zh.canonical / zh.suffix。 */
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

/** 跨表共用键：同一语言键不能同时登记在材料、规则术语或游戏对象多张表中。 */
function checkCrossTableKeys(
  tables: ReadonlyArray<{ label: string; owner: Map<string, string> }>,
  issues: ValidationIssue[],
): void {
  const globalOwner = new Map<string, { label: string; id: string }>();
  for (const table of tables) {
    for (const [key, id] of table.owner) {
      const previous = globalOwner.get(key);
      if (previous !== undefined) {
        issues.push(
          issue(
            'key.duplicate',
            'error',
            `键 ${key} 同时登记为${previous.label} ${previous.id} 与${table.label} ${id}`,
            key,
          ),
        );
      } else {
        globalOwner.set(key, { label: table.label, id });
      }
    }
  }
}

interface CollisionCandidate {
  qualifiedId: string;
  id: string;
  fullZh: string;
  allowSameZhReason?: string;
}

function checkAllZhCollisions(
  materials: readonly MaterialRecord[],
  glossary: readonly GlossaryRecord[],
  entities: readonly EntityRecord[],
  issues: ValidationIssue[],
): void {
  const all: CollisionCandidate[] = [
    ...materials.map((record) => ({
      qualifiedId: `material:${record.id}`,
      id: record.id,
      fullZh: formatFullZh(record.zh),
      allowSameZhReason: record.allowSameZhReason,
    })),
    ...glossary.map((record) => ({
      qualifiedId: `glossary:${record.id}`,
      id: record.id,
      fullZh: formatFullZh(record.zh),
      allowSameZhReason: record.allowSameZhReason,
    })),
    ...entities.map((record) => ({
      qualifiedId: `entity:${record.id}`,
      id: record.id,
      fullZh: formatFullZh(record.zh),
      allowSameZhReason: record.allowSameZhReason,
    })),
  ];

  const groups = new Map<string, CollisionCandidate[]>();
  for (const record of all) {
    const list = groups.get(record.fullZh) ?? [];
    list.push(record);
    groups.set(record.fullZh, list);
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

function checkForbiddenZh(
  records: readonly { id: string; zh: LocalizedZh }[],
  label: string,
  issues: ValidationIssue[],
): void {
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
    if (record.zh.suffix) {
      if (FORBIDDEN_ZH_PATTERN.test(record.zh.suffix)) {
        issues.push(
          issue('zh.forbidden-separator', 'error', `${label} 的 zh.suffix 含顿号：${record.zh.suffix}`, record.id),
        );
      }
      if (PLACEHOLDER_ZH_PATTERN.test(record.zh.suffix)) {
        issues.push(
          issue(
            'zh.placeholder-meta',
            'error',
            `${label} 的 zh.suffix 含占位/元信息文本：${record.zh.suffix}`,
            record.id,
          ),
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

/** `zh.legacy` 里不该再出现与现行规范名（含完整词）相同的文本。 */
function checkLegacyTerms(
  records: readonly { id: string; zh: LocalizedZh }[],
  label: string,
  issues: ValidationIssue[],
): void {
  for (const record of records) {
    const full = formatFullZh(record.zh);
    for (const entry of record.zh.legacy ?? []) {
      if (entry.text !== record.zh.canonical && entry.text !== full) continue;
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
  const materialIds = new Set(materials.map((record) => record.id));

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
    if (record.zh.canonical === record.en.canonical && !record.zh.suffix) {
      issues.push(issue('zh.untranslated', 'warning', `中文名仍是英文：${record.zh.canonical}`, record.id));
    }
    if (record.composition && /^(?:未知|unknown)(?:$|[\s（(])/i.test(record.composition.formula.trim())) {
      issues.push(
        issue(
          'composition.unknown',
          'error',
          `composition.formula 不得写未知/unknown，请省略 composition 字段：${record.composition.formula}`,
          record.id,
        ),
      );
    }
    if (record.notes && /(?:also_in|也见于)\s*[:：]/i.test(record.notes)) {
      issues.push(
        issue('notes.also-in', 'warning', 'notes 中仍含「也见于/also_in」，请归入 origin.alsoIn 字段', record.id),
      );
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

    if (record.variantOf !== undefined) {
      if (record.variantOf === record.id) {
        issues.push(issue('material.self-variant', 'error', `variantOf 不能指向自身：${record.id}`, record.id));
      } else if (!materialIds.has(record.variantOf)) {
        issues.push(
          issue('material.dangling-variant', 'error', `variantOf 指向不存在的材料 id：${record.variantOf}`, record.id),
        );
      }
    }

    const fullEn = formatFullEn(record.en);
    const english = englishNames.get(fullEn) ?? [];
    english.push(record.id);
    englishNames.set(fullEn, english);

    const ceKeys = (record.keys.gt6ce ?? []).length;
    if (record.targets.gt6ce === 'active' && ceKeys === 0 && !record.variantOf) {
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

function checkSeeAlsoReferences(
  materials: readonly MaterialRecord[],
  glossary: readonly GlossaryRecord[],
  entities: readonly EntityRecord[],
  issues: ValidationIssue[],
): void {
  const allIds = new Set<string>([
    ...materials.map((record) => record.id),
    ...glossary.map((record) => record.id),
    ...entities.map((record) => record.id),
  ]);
  for (const [label, list] of [
    ['materials', materials],
    ['glossary', glossary],
    ['entities', entities],
  ] as const) {
    for (const record of list) {
      for (const target of record.seeAlso ?? []) {
        if (allIds.has(target)) continue;
        issues.push(
          issue('kb.dangling-see-also', 'warning', `${label} 的 seeAlso 引用了不存在的 id：${target}`, record.id),
        );
      }
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
 * 校验整套知识库（四文件）。
 *
 * 强制拦截：schema 非法、id/键重复（含三表跨表共用键）、键含 `<br>` 或空白、
 * `origin.urls` 引用 MT.java、未登记的中文撞车、规范译名/后缀含顿号或占位元信息、
 * 悬空 `variantOf`、派生族正则不可编译。
 */
export function validateKnowledgeBase(
  materials: readonly MaterialRecord[],
  glossary: readonly GlossaryRecord[],
  entities: readonly EntityRecord[],
  derivations: MaterialDerivationsConfig,
  entityDerivations?: EntityDerivationsConfig,
): ValidationReport {
  const issues: ValidationIssue[] = [];
  checkSchema(materials, materialRecordSchema, 'materials', issues);
  checkSchema(glossary, glossaryRecordSchema, 'glossary', issues);
  checkSchema(entities, entityRecordSchema, 'entities', issues);
  checkSchema([derivations], materialDerivationsSchema, 'derivations', issues);
  if (entityDerivations !== undefined) {
    checkSchema([entityDerivations], entityDerivationsSchema, 'entity-derivations', issues);
  }
  checkIds(materials, 'materials', issues);
  checkIds(glossary, 'glossary', issues);
  checkIds(entities, 'entities', issues);
  const materialKeys = checkKeys(materials, 'materials', issues);
  const glossaryKeys = checkKeys(glossary, 'glossary', issues);
  const entityKeys = checkKeys(entities, 'entities', issues);
  checkCrossTableKeys(
    [
      { label: '材料', owner: materialKeys.owner },
      { label: '术语', owner: glossaryKeys.owner },
      { label: '对象', owner: entityKeys.owner },
    ],
    issues,
  );
  checkAllZhCollisions(materials, glossary, entities, issues);
  checkForbiddenZh(materials, 'materials', issues);
  checkForbiddenZh(glossary, 'glossary', issues);
  checkForbiddenZh(entities, 'entities', issues);
  checkLegacyTerms(materials, 'materials', issues);
  checkLegacyTerms(glossary, 'glossary', issues);
  checkLegacyTerms(entities, 'entities', issues);
  checkMaterials(materials, issues);
  checkSeeAlsoReferences(materials, glossary, entities, issues);
  checkDerivations(derivations, issues);
  if (entityDerivations !== undefined) {
    checkDerivations(entityDerivations, issues);
  }

  const evidence = { verified: 0, inferred: 0, unknown: 0 };
  for (const record of materials) evidence[record.origin.evidence] += 1;

  const stats: ValidationStats = {
    materials: materials.length,
    glossary: glossary.length,
    entities: entities.length,
    families: derivations.families.length + (entityDerivations?.families.length ?? 0),
    internalPlaceholders:
      derivations.internalPlaceholders.reduce((total, entry) => total + entry.keys.length, 0) +
      (entityDerivations?.internalPlaceholders.reduce((total, entry) => total + entry.keys.length, 0) ?? 0),
    materialKeys: materialKeys.total,
    glossaryKeys: glossaryKeys.total,
    entityKeys: entityKeys.total,
    evidence,
  };
  const sorted = sortIssues(issues);
  const errors = sorted.filter((entry) => entry.severity === 'error');
  const warnings = sorted.filter((entry) => entry.severity === 'warning');
  return { ok: errors.length === 0, errors, warnings, stats };
}
