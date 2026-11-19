/**
 * 三方联合对账：把目标语料的键集合 100% 分类为
 * coveredByMaterials / coveredByGlossary / derivedByFamily / internalPlaceholders。
 *
 * `kb reconcile` 用它证明「materials.jsonl 的 keys + glossary.jsonl 的 keys +
 * material-derivations.json 的规则 == 语料全集」，并且没有键被重复登记。
 */
import type { GlossaryRecord, MaterialDerivationsConfig, MaterialRecord, ReconcileReport } from './types.ts';

const KEY_NAMESPACES = ['gt6', 'gt6ce', 'gt6w'] as const;

interface CompiledFamily {
  id: string;
  regexes: RegExp[];
}

function compileFamilies(derivations: MaterialDerivationsConfig): CompiledFamily[] {
  return derivations.families.map((family) => ({
    id: family.id,
    regexes: family.keyPatterns.map((pattern) => new RegExp(pattern, family.flags ?? '')),
  }));
}

function placeholderKeys(derivations: MaterialDerivationsConfig): Set<string> {
  return new Set(derivations.internalPlaceholders.flatMap((entry) => entry.keys));
}

/**
 * 收集记录声明的全部键，并记录每个键被哪些记录声明。
 *
 * 同一条记录把同一个键写进两个命名空间（如 `oredict.prefix.billet` 同时出现在
 * GT6 与 GT6CE 语料）只算一次归属，不算重复。
 */
export function collectKeyOwners(
  records: readonly (MaterialRecord | GlossaryRecord)[],
  prefix: 'material' | 'glossary',
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const record of records) {
    const owner = `${prefix}:${record.id}`;
    for (const namespace of KEY_NAMESPACES) {
      for (const key of record.keys?.[namespace] ?? []) {
        const owners = index.get(key) ?? [];
        if (!owners.includes(owner)) owners.push(owner);
        index.set(key, owners);
      }
    }
  }
  return index;
}

/**
 * 对账。
 *
 * 分类顺序：先看 materials 是否声明该键，再看 glossary，再看 internalPlaceholders，
 * 最后按 families 的声明顺序匹配正则。四者都不命中即 unaccounted。
 */
export function reconcileMaterialKeys(
  materials: readonly MaterialRecord[],
  glossary: readonly GlossaryRecord[],
  derivations: MaterialDerivationsConfig,
  targetKeys: readonly string[],
  targetName: string,
): ReconcileReport {
  const materialOwners = collectKeyOwners(materials, 'material');
  const glossaryOwners = collectKeyOwners(glossary, 'glossary');
  const families = compileFamilies(derivations);
  const placeholders = placeholderKeys(derivations);

  const unaccounted: string[] = [];
  const derivedByFamily: Record<string, number> = {};
  const seen = new Set<string>();
  let coveredByMaterials = 0;
  let coveredByGlossary = 0;
  let internalPlaceholders = 0;

  for (const key of targetKeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    if (materialOwners.has(key)) {
      coveredByMaterials += 1;
      continue;
    }
    if (glossaryOwners.has(key)) {
      coveredByGlossary += 1;
      continue;
    }
    if (placeholders.has(key)) {
      internalPlaceholders += 1;
      continue;
    }
    const family = families.find((entry) => entry.regexes.some((regex) => regex.test(key)));
    if (family !== undefined) {
      derivedByFamily[family.id] = (derivedByFamily[family.id] ?? 0) + 1;
      continue;
    }
    unaccounted.push(key);
  }

  const combinedOwners = new Map<string, string[]>();
  for (const [key, owners] of [...materialOwners, ...glossaryOwners]) {
    const merged = combinedOwners.get(key) ?? [];
    for (const owner of owners) {
      if (!merged.includes(owner)) merged.push(owner);
    }
    combinedOwners.set(key, merged);
  }
  const duplicatedKeys = [...combinedOwners.entries()]
    .filter(([key, owners]) => owners.length > 1 && seen.has(key))
    .map(([key]) => key)
    .sort();
  const derived = Object.values(derivedByFamily).reduce((total, count) => total + count, 0);

  return {
    targetName,
    total: seen.size,
    coveredByMaterials,
    coveredByGlossary,
    derivedByFamily,
    internalPlaceholders,
    unaccounted,
    duplicatedKeys,
    counts: {
      total: seen.size,
      coveredByMaterials,
      coveredByGlossary,
      derived,
      internalPlaceholders,
      unaccounted: unaccounted.length,
      duplicatedKeys: duplicatedKeys.length,
    },
  };
}
