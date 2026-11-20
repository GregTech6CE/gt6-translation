/**
 * 知识库的 zod schema，与 `knowledge/schemas/*.json` 一一对应。
 *
 * JSON Schema 是给外部工具阅读的契约，zod 是运行时门禁：两者字段名、
 * 必填项与枚举必须保持同步，改动时一起改。文件末尾的编译期断言会在两边漂移时
 * 让 `tsc --noEmit` 直接失败。
 */
import { z } from 'zod';
import type {
  CeParityStatus,
  DerivationFamily,
  EntityDomain,
  EntityRecord,
  EvidenceLevel,
  GlossaryDomain,
  GlossaryRecord,
  LegacyTermStatus,
  MaterialCategory,
  MaterialDerivationsConfig,
  MaterialRecord,
  MaterialState,
  MaterialTrait,
  OriginKind,
} from './types.ts';

/** 语言键：完整键名，不含 `<br>`、空白或其他分隔符。 */
const keySchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_.-]+$/, '语言键只能包含字母、数字、下划线、点和连字符，不得含 <br> 或空白');

function uniqueArray<T extends z.ZodTypeAny>(item: T, message = '数组元素不能重复') {
  return z.array(item).refine((items) => new Set(items).size === items.length, { message });
}

const keyListSchema = uniqueArray(keySchema, '语言键重复');

const stringListSchema = uniqueArray(z.string().min(1), '列表元素重复');

const httpUrlSchema = z
  .string()
  .min(1)
  .regex(/^https?:\/\//, '链接必须以 http(s):// 开头');

const kebabSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'id 必须是 kebab-case');

export const materialStateSchema = z.enum(['solid', 'liquid', 'gas', 'plasma', 'unknown']);

export const materialCategorySchema = z.enum([
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
]);

export const materialTraitSchema = z.enum([
  'metal',
  'ore',
  'dust-based',
  'chemical-acid',
  'magical',
  'radioactive',
  'celestial',
  'vanilla-derived',
  'biome-wood',
]);

export const originKindSchema = z.enum(['real-world', 'minecraft', 'mod', 'fiction', 'gt6', 'unknown']);

export const evidenceLevelSchema = z.enum(['verified', 'inferred', 'unknown']);

export const ceParityStatusSchema = z.enum(['active', 'removed', 'renamed', 'legacy-only']);

export const glossaryDomainSchema = z.enum(['prefix', 'affix', 'tier', 'mechanic', 'ui', 'unit']);

export const entityDomainSchema = z.enum([
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
]);

export const legacyTermStatusSchema = z.enum(['legacy', 'rejected', 'proposed']);

export const legacyTermSchema = z
  .object({
    text: z.string().min(1),
    source: z.string().min(1),
    status: legacyTermStatusSchema,
    note: z.string().min(1).optional(),
  })
  .strict();

const localizedEnShape = {
  canonical: z.string().min(1),
  suffix: z.string().min(1).optional(),
  aliases: stringListSchema.optional(),
};

const localizedZhShape = {
  canonical: z.string().min(1),
  suffix: z.string().min(1).optional(),
  aliases: stringListSchema.optional(),
  legacy: z.array(legacyTermSchema).optional(),
  regionVariants: z.record(z.string(), z.string().min(1)).optional(),
};

const materialCompositionSchema = z
  .object({
    formula: z.string().min(1),
    source: z.string().min(1),
    gt6: z.string().min(1).optional(),
    note: z.string().min(1).optional(),
  })
  .strict();

const materialKeysSchema = z
  .object({
    gt6: keyListSchema.optional(),
    gt6ce: keyListSchema.optional(),
    gt6w: keyListSchema.optional(),
  })
  .strict();

export const materialRecordSchema = z
  .object({
    id: kebabSchema,
    keys: materialKeysSchema,
    en: z
      .object({
        ...localizedEnShape,
        latin: z.string().min(1).optional(),
        common: z.string().min(1).optional(),
      })
      .strict(),
    zh: z.object(localizedZhShape).strict(),
    category: materialCategorySchema,
    states: uniqueArray(materialStateSchema, 'states 不能重复').min(1),
    composition: materialCompositionSchema.optional(),
    traits: uniqueArray(materialTraitSchema, 'traits 不能重复').optional(),
    origin: z
      .object({
        kind: originKindSchema,
        source: z.string().min(1),
        alsoIn: stringListSchema.optional(),
        evidence: evidenceLevelSchema,
        urls: uniqueArray(httpUrlSchema, 'urls 不能重复').optional(),
      })
      .strict(),
    targets: z
      .object({
        numericId: z.number().int().min(0).optional(),
        modTag: z.string().min(1).optional(),
        mtRef: httpUrlSchema.optional(),
        gt6ce: ceParityStatusSchema,
      })
      .strict(),
    variantOf: kebabSchema.optional(),
    seeAlso: stringListSchema.optional(),
    allowSameZhReason: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

export const glossaryRecordSchema = z
  .object({
    id: kebabSchema,
    domain: glossaryDomainSchema,
    keys: materialKeysSchema.optional(),
    en: z.object(localizedEnShape).strict(),
    zh: z.object(localizedZhShape).strict(),
    seeAlso: stringListSchema.optional(),
    allowSameZhReason: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

export const entityRecordSchema = z
  .object({
    id: kebabSchema,
    domain: entityDomainSchema,
    keys: materialKeysSchema.optional(),
    en: z.object(localizedEnShape).strict(),
    zh: z.object(localizedZhShape).strict(),
    seeAlso: stringListSchema.optional(),
    allowSameZhReason: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

export const derivationFamilySchema = z
  .object({
    id: kebabSchema,
    kind: z.literal('derived'),
    description: z.string().min(1),
    template: z
      .object({
        en: z.string().min(1),
        zh: z.string().min(1),
      })
      .strict()
      .optional(),
    keyPatterns: uniqueArray(z.string().min(1), 'keyPatterns 不能重复').min(1),
    flags: z
      .string()
      .regex(/^[imsu]*$/)
      .optional(),
  })
  .strict();

export const materialDerivationsSchema = z
  .object({
    version: z.literal(1),
    description: z.string().min(1).optional(),
    families: z.array(derivationFamilySchema),
    internalPlaceholders: z.array(
      z
        .object({
          keys: uniqueArray(keySchema, '占位键重复').min(1),
          reason: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export const entityDerivationsSchema = materialDerivationsSchema;

/** 供调用方复用的枚举清单。 */
export const MATERIAL_STATES: readonly MaterialState[] = materialStateSchema.options;
export const MATERIAL_CATEGORIES: readonly MaterialCategory[] = materialCategorySchema.options;
export const MATERIAL_TRAITS: readonly MaterialTrait[] = materialTraitSchema.options;
export const ORIGIN_KINDS: readonly OriginKind[] = originKindSchema.options;
export const EVIDENCE_LEVELS: readonly EvidenceLevel[] = evidenceLevelSchema.options;
export const CE_PARITY_STATUSES: readonly CeParityStatus[] = ceParityStatusSchema.options;
export const GLOSSARY_DOMAINS: readonly GlossaryDomain[] = glossaryDomainSchema.options;
export const ENTITY_DOMAINS: readonly EntityDomain[] = entityDomainSchema.options;
export const LEGACY_TERM_STATUSES: readonly LegacyTermStatus[] = legacyTermStatusSchema.options;

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** 编译期断言：zod 推断类型必须与手写类型完全一致。 */
function assertSchemaMatchesType<A, B>(_matched: Exact<A, B> extends true ? true : never): void {
  // 只用于类型检查，运行时不做任何事。
}

assertSchemaMatchesType<z.infer<typeof materialRecordSchema>, MaterialRecord>(true);
assertSchemaMatchesType<z.infer<typeof glossaryRecordSchema>, GlossaryRecord>(true);
assertSchemaMatchesType<z.infer<typeof entityRecordSchema>, EntityRecord>(true);
assertSchemaMatchesType<z.infer<typeof derivationFamilySchema>, DerivationFamily>(true);
assertSchemaMatchesType<z.infer<typeof materialDerivationsSchema>, MaterialDerivationsConfig>(true);
