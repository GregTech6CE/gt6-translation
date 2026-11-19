/**
 * 材料与术语知识库的类型定义。
 *
 * 知识库是纯数据：`knowledge/materials.jsonl`、`knowledge/glossary.jsonl` 与
 * `knowledge/material-derivations.json` 是唯一事实源；`kb render-md` 只是按需导出。
 * 本模块不依赖 `node:*`，可在浏览器与 worker 中直接使用。
 */

/** 材料在 GT6/GT6CE 中注册的形态。 */
export type MaterialState = 'solid' | 'liquid' | 'gas' | 'plasma' | 'unknown';

/** 材料类别，同时决定文档分组；与 traits 正交。 */
export type MaterialCategory =
  | 'element'
  | 'compound'
  | 'alloy'
  | 'mineral'
  | 'gem'
  | 'rock'
  | 'wood'
  | 'fluid'
  | 'food'
  | 'dye'
  | 'isotope'
  | 'particle'
  | 'other';

/**
 * 受控特征词表，见 material.schema.json 的 `$defs.trait`。
 *
 * 只保留与 `category`/状态正交、且由规则驱动的特征；与类别重复的
 * `wood/stone/gem/alloy/fluid/food/dye` 和与状态重复的
 * `removed-in-ce/compat/state-variant/untranslated/placeholder` 已移除。
 */
export type MaterialTrait =
  | 'metal'
  | 'ore'
  | 'dust-based'
  | 'chemical-acid'
  | 'magical'
  | 'radioactive'
  | 'celestial'
  | 'vanilla-derived'
  | 'biome-wood';

/** 名称首创出处大类。 */
export type OriginKind = 'real-world' | 'minecraft' | 'mod' | 'fiction' | 'gt6' | 'unknown';

/** 证据等级：外部信源明确写出、由证据推出、无证据。 */
export type EvidenceLevel = 'verified' | 'inferred' | 'unknown';

/** 材料在 GT6CE 中的收录状态。 */
export type CeParityStatus = 'active' | 'removed' | 'renamed' | 'legacy-only';

/** 术语所属域。 */
export type GlossaryDomain =
  | 'prefix'
  | 'affix'
  | 'machine'
  | 'block'
  | 'item'
  | 'tool'
  | 'fluid'
  | 'mechanic'
  | 'tier'
  | 'ui'
  | 'unit';

/** 历史/候选译名的状态。 */
export type LegacyTermStatus = 'legacy' | 'rejected' | 'proposed';

/** 一条历史或候选译名；`source` 说明它出现在哪份语料或文档里。 */
export interface LegacyTermEntry {
  text: string;
  source: string;
  status: LegacyTermStatus;
  note?: string;
}

/** 材料在各语料中的语言键；键是完整键名。 */
export interface MaterialKeys {
  gt6?: string[];
  gt6ce?: string[];
  gt6w?: string[];
}

export interface MaterialEn {
  canonical: string;
  aliases?: string[];
  latin?: string;
  common?: string;
}

/** 按形态区分的中文名，键与 `MaterialState` 对应。 */
export type MaterialStateNames = Partial<Record<Exclude<MaterialState, 'unknown'>, string>>;

/** 材料与术语共用的中文模型。 */
export interface LocalizedZh {
  canonical: string;
  aliases?: string[];
  legacy?: LegacyTermEntry[];
  regionVariants?: Record<string, string>;
}

export interface MaterialZh extends LocalizedZh {
  stateNames?: MaterialStateNames;
}

export interface MaterialOrigin {
  kind: OriginKind;
  source: string;
  alsoIn?: string[];
  evidence: EvidenceLevel;
  /** 只放外部首创信源；MT.java 等反循环出处放在 `targets.mtRef`。 */
  urls?: string[];
}

/** 材料在 GT6/GT6CE 中的落点。 */
export interface MaterialTargets {
  numericId?: number;
  modTag?: string;
  mtRef?: string;
  gt6ce: CeParityStatus;
}

export interface MaterialRecord {
  id: string;
  keys: MaterialKeys;
  en: MaterialEn;
  zh: MaterialZh;
  category: MaterialCategory;
  states: MaterialState[];
  /** 无证据时省略该字段，不写 `unknown`。 */
  composition?: string;
  traits?: MaterialTrait[];
  origin: MaterialOrigin;
  targets: MaterialTargets;
  /** 允许与其他材料共用中文规范名的理由；未填写时撞车报错。 */
  allowSameZhReason?: string;
  notes?: string;
}

export interface GlossaryKeys {
  gt6?: string[];
  gt6ce?: string[];
  gt6w?: string[];
}

export interface GlossaryRecord {
  id: string;
  domain: GlossaryDomain;
  keys?: GlossaryKeys;
  en: { canonical: string; aliases?: string[] };
  zh: LocalizedZh;
  /** 关联术语的 id，替代一次性的 collisionGroup。 */
  seeAlso?: string[];
  allowSameZhReason?: string;
  notes?: string;
}

/** 规则派生族：由基材按模板批量派生的键族。 */
export interface DerivationFamily {
  id: string;
  kind: 'derived';
  description: string;
  template?: { en: string; zh: string };
  keyPatterns: string[];
  flags?: string;
}

/** GT6 内部占位/彩蛋键。 */
export interface InternalPlaceholder {
  keys: string[];
  reason: string;
}

export interface MaterialDerivationsConfig {
  version: 1;
  description?: string;
  families: DerivationFamily[];
  internalPlaceholders: InternalPlaceholder[];
}

/** 完整知识库。 */
export interface KnowledgeBase {
  materials: MaterialRecord[];
  glossary: GlossaryRecord[];
  derivations: MaterialDerivationsConfig;
}

/** 校验问题；`severity` 为 error 时知识库不可用。 */
export interface ValidationIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  /** 出问题的记录 id 或语言键。 */
  subject?: string;
}

export interface ValidationStats {
  materials: number;
  glossary: number;
  families: number;
  internalPlaceholders: number;
  materialKeys: number;
  glossaryKeys: number;
  /** 证据等级分布，取代逐条 `origin.no-url` 警告。 */
  evidence: Record<EvidenceLevel, number>;
}

export interface ValidationReport {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  stats: ValidationStats;
}

/**
 * 三方联合对账结果。
 *
 * 每个目标键必须落在 coveredByMaterials / coveredByGlossary / derivedByFamily /
 * internalPlaceholders 之一；`unaccounted` 必须为空。
 */
export interface ReconcileReport {
  targetName: string;
  total: number;
  coveredByMaterials: number;
  coveredByGlossary: number;
  /** 每个派生族命中的键数。 */
  derivedByFamily: Record<string, number>;
  internalPlaceholders: number;
  unaccounted: string[];
  /** 同一目标键被多条记录声明（跨表或同表）。 */
  duplicatedKeys: string[];
  counts: {
    total: number;
    coveredByMaterials: number;
    coveredByGlossary: number;
    derived: number;
    internalPlaceholders: number;
    unaccounted: number;
    duplicatedKeys: number;
  };
}

/** 查询命中的条目。 */
export interface QueryHit {
  kind: 'material' | 'glossary';
  id: string;
  en: string;
  zh: string;
  /** 命中字段，例如 `zh.canonical`、`keys.gt6`。 */
  matchedOn: string;
  material?: MaterialRecord;
  glossary?: GlossaryRecord;
}

export interface QueryOptions {
  /** 限定查询范围，默认同时查材料与术语。 */
  domain?: 'material' | 'glossary' | 'all';
  /** 返回条数上限，默认 20。 */
  limit?: number;
}

/** 渲染结果：文件名为导出目录下的相对路径。 */
export type RenderedDocs = Record<string, string>;
