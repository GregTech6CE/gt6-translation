/**
 * 材料、术语与游戏对象知识库的类型定义。
 *
 * 知识库是纯数据：`knowledge/materials.jsonl`、`knowledge/glossary.jsonl`、
 * `knowledge/entities.jsonl` 与 `knowledge/material-derivations.json` 是唯一事实源；
 * `kb render-md` 只是按需导出。本模块不依赖 `node:*`，可在浏览器与 worker 中直接使用。
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
 * 只保留与 `category`/状态正交、且由规则驱动的特征。
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

/** 规则与概念术语所属域（纯词法/概念，具体游戏实体见 EntityDomain）。 */
export type GlossaryDomain = 'prefix' | 'affix' | 'tier' | 'mechanic' | 'ui' | 'unit';

/** 具体游戏对象类别（机器、多方块、存储、物流、覆盖板、工具、物品、食物、蜜蜂、方块、非材料流体）。 */
export type EntityDomain =
  | 'machine'
  | 'multiblock'
  | 'storage'
  | 'logistics'
  | 'cover'
  | 'tool'
  | 'item'
  | 'food'
  | 'bumblebee'
  | 'block'
  | 'fluid';

/** 历史/候选译名的状态。 */
export type LegacyTermStatus = 'legacy' | 'rejected' | 'proposed';

/** 一条历史或候选译名；`source` 说明它出现在哪份语料或文档里。 */
export interface LegacyTermEntry {
  text: string;
  source: string;
  status: LegacyTermStatus;
  note?: string;
}

/** 记录在各语料中的语言键；键是完整键名。 */
export interface MaterialKeys {
  gt6?: string[];
  gt6ce?: string[];
  gt6w?: string[];
}

export interface LocalizedEn {
  canonical: string;
  /** 可选的英文形态/类别限定后缀，如 Liquid、Gas、Rock、Dye、Wood、Block。 */
  suffix?: string;
  aliases?: string[];
}

export interface MaterialEn extends LocalizedEn {
  latin?: string;
  common?: string;
}

/** 材料、术语与对象共用的中文模型。 */
export interface LocalizedZh {
  canonical: string;
  /** 可选的可分离中文后缀（如 矿、石、木、染料、岩）；完整词为 canonical + suffix。 */
  suffix?: string;
  aliases?: string[];
  legacy?: LegacyTermEntry[];
  regionVariants?: Record<string, string>;
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

/** 材料的组成信息：同时记录主分子式、来源、可选 GT6 记法与补充说明。 */
export interface MaterialComposition {
  /** 主化学式或组分式（无固定组成或未知时省略 composition 整体，不写 未知/unknown）。 */
  formula: string;
  /** 主化学式来源，如 现实、GT6、维基百科、Metallurgy 等。 */
  source: string;
  /** 若 GT6 内部简化/配平记法与主式不同，单独记录于此。 */
  gt6?: string;
  /** 补充说明（如近似式、水合物、混合物或配比说明）。 */
  note?: string;
}

export interface MaterialRecord {
  id: string;
  keys: MaterialKeys;
  en: MaterialEn;
  zh: LocalizedZh;
  category: MaterialCategory;
  states: MaterialState[];
  /** 无固定组成或未知时省略该字段，不写 `unknown` / `未知`。 */
  composition?: MaterialComposition;
  traits?: MaterialTrait[];
  origin: MaterialOrigin;
  targets: MaterialTargets;
  /** 同语言键按形态拆为多条记录时，变体指向主材料 id（此时变体 keys 可为空）。 */
  variantOf?: string;
  /** 关联材料/术语/对象的 id，用于多义词消歧与同族形态互指。 */
  seeAlso?: string[];
  /** 允许与其他记录共用中文规范名的理由；未填写时撞车报错。 */
  allowSameZhReason?: string;
  notes?: string;
}

export type GlossaryKeys = MaterialKeys;

export interface GlossaryRecord {
  id: string;
  domain: GlossaryDomain;
  keys?: GlossaryKeys;
  en: LocalizedEn;
  zh: LocalizedZh;
  seeAlso?: string[];
  allowSameZhReason?: string;
  notes?: string;
}

export interface EntityRecord {
  id: string;
  domain: EntityDomain;
  keys?: MaterialKeys;
  en: LocalizedEn;
  zh: LocalizedZh;
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

export type EntityDerivationsConfig = MaterialDerivationsConfig;

/** 完整知识库（四/五文件单一事实源）。 */
export interface KnowledgeBase {
  materials: MaterialRecord[];
  glossary: GlossaryRecord[];
  entities: EntityRecord[];
  derivations: MaterialDerivationsConfig;
  entityDerivations?: EntityDerivationsConfig;
}

/** 英文完整展示名：有 suffix 时统一带括号，如 `Hydrochloric Acid (Gas)`。 */
export function formatFullEn(en: Pick<LocalizedEn, 'canonical' | 'suffix'>): string {
  return en.suffix ? `${en.canonical} (${en.suffix})` : en.canonical;
}

/** 中文完整词：有 suffix 时拼接为完整名词，如 `黑色` + `染料` → `黑色染料`。 */
export function formatFullZh(zh: Pick<LocalizedZh, 'canonical' | 'suffix'>): string {
  return zh.suffix ? `${zh.canonical}${zh.suffix}` : zh.canonical;
}

/** 中文带括号展示名：有 suffix 时以全角括号区分词干与后缀，如 `黑色（染料）`。 */
export function formatAnnotatedZh(zh: Pick<LocalizedZh, 'canonical' | 'suffix'>): string {
  return zh.suffix ? `${zh.canonical}（${zh.suffix}）` : zh.canonical;
}

/** 将结构化组成格式化为单行文本（供 CLI 与 Markdown 导出使用）。 */
export function formatComposition(composition?: MaterialComposition): string {
  if (!composition) return '—';
  const extras: string[] = [`来源：${composition.source}`];
  if (composition.gt6) extras.push(`GT6：${composition.gt6}`);
  if (composition.note) extras.push(composition.note);
  return `${composition.formula}（${extras.join('；')}）`;
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
  entities: number;
  families: number;
  internalPlaceholders: number;
  materialKeys: number;
  glossaryKeys: number;
  entityKeys: number;
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
 * 四方联合对账结果。
 *
 * 每个目标键必须落在 coveredByMaterials / coveredByGlossary / coveredByEntities /
 * derivedByFamily / internalPlaceholders 之一；`unaccounted` 必须为空。
 */
export interface ReconcileReport {
  targetName: string;
  total: number;
  coveredByMaterials: number;
  coveredByGlossary: number;
  coveredByEntities: number;
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
    coveredByEntities: number;
    derived: number;
    internalPlaceholders: number;
    unaccounted: number;
    duplicatedKeys: number;
  };
}

/** 查询命中的条目。 */
export interface QueryHit {
  kind: 'material' | 'glossary' | 'entity';
  id: string;
  en: string;
  zh: string;
  /** 命中字段，例如 `zh.canonical`、`keys.gt6`。 */
  matchedOn: string;
  material?: MaterialRecord;
  glossary?: GlossaryRecord;
  entity?: EntityRecord;
}

export interface QueryOptions {
  /** 限定查询范围，默认同时查材料、术语与对象。 */
  domain?: 'material' | 'glossary' | 'entity' | 'all';
  /** 返回条数上限，默认 20。 */
  limit?: number;
}

/** 渲染结果：文件名为导出目录下的相对路径。 */
export type RenderedDocs = Record<string, string>;
