/**
 * `kb` 命令组：知识库门禁、三方对账、检索与按需导出。
 *
 * 数据源是仓库内的 `knowledge/`：`materials.jsonl`、`glossary.jsonl` 与
 * `material-derivations.json`。语料键集合从 legacy `GregTech.lang` 与（可选的）
 * GT6CE `en_us.json` 现读，因此对账结果反映的是当前检出，而不是写死的数字。
 * 导出的 Markdown 只写到 `packages/node/dist/materials/`，不入库。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  formatComposition,
  parseKnowledgeBase,
  parseLegacyLang,
  queryKnowledgeBase,
  reconcileEntityKeys,
  reconcileMaterialKeys,
  renderMaterialsMarkdown,
  validateKnowledgeBase,
  type KnowledgeBase,
  type QueryHit,
  type ReconcileReport,
} from '@gt6tg/core';
import { assertArtifactWritable, artifactRoot, pathExists, repoRelative, repoRoot, resolveInsideRepo } from '../paths';

const KNOWLEDGE_DIR = 'knowledge';
const DEFAULT_EXPORT_DIR = 'materials';
const LEGACY_LANG = 'packages/legacy/workplace/en/GregTech.lang';
const DEFAULT_GT6CE_LANG = '../GregTech6CE/core/src/main/resources/assets/gt6ce/lang/en_us.json';

interface LoadedKnowledgeBase {
  knowledgeBase: KnowledgeBase;
  materialsPath: string;
  glossaryPath: string;
  entitiesPath: string;
  derivationsPath: string;
  entityDerivationsPath: string;
}

async function loadKnowledgeBase(): Promise<LoadedKnowledgeBase> {
  const materialsPath = resolveInsideRepo(join(KNOWLEDGE_DIR, 'materials.jsonl'));
  const glossaryPath = resolveInsideRepo(join(KNOWLEDGE_DIR, 'glossary.jsonl'));
  const entitiesPath = resolveInsideRepo(join(KNOWLEDGE_DIR, 'entities.jsonl'));
  const derivationsPath = resolveInsideRepo(join(KNOWLEDGE_DIR, 'material-derivations.json'));
  const entityDerivationsPath = resolveInsideRepo(join(KNOWLEDGE_DIR, 'entity-derivations.json'));
  const hasEntityDerivations = await pathExists(entityDerivationsPath);
  const [materials, glossary, entities, derivations, entityDerivations] = await Promise.all([
    readFile(materialsPath, 'utf8'),
    readFile(glossaryPath, 'utf8'),
    readFile(entitiesPath, 'utf8'),
    readFile(derivationsPath, 'utf8'),
    hasEntityDerivations ? readFile(entityDerivationsPath, 'utf8') : Promise.resolve(undefined),
  ]);
  const parsed = parseKnowledgeBase({ materials, glossary, entities, derivations, entityDerivations });
  if (parsed.knowledgeBase === undefined) {
    for (const issue of parsed.issues) {
      console.error(`[kb] ${issue.source}:${issue.line} ${issue.message}`);
    }
    throw new Error('知识库文件无法解析，先修 JSON/JSONL');
  }
  for (const issue of parsed.issues) {
    console.error(`[kb] ${issue.source}:${issue.line} ${issue.message}`);
  }
  return {
    knowledgeBase: parsed.knowledgeBase,
    materialsPath,
    glossaryPath,
    entitiesPath,
    derivationsPath,
    entityDerivationsPath,
  };
}

function printReport(report: ReturnType<typeof validateKnowledgeBase>): void {
  const { stats } = report;
  console.log(
    `[kb] 材料 ${stats.materials} 条、术语 ${stats.glossary} 条、对象 ${stats.entities} 条、派生族 ${stats.families} 个、内部占位键 ${stats.internalPlaceholders} 个；` +
      `键 ${stats.materialKeys + stats.glossaryKeys + stats.entityKeys} 个`,
  );
  console.log(
    `[kb] 证据：verified ${stats.evidence.verified}、inferred ${stats.evidence.inferred}、unknown ${stats.evidence.unknown}`,
  );
  for (const warning of report.warnings) {
    console.warn(`[kb] warn ${warning.code}${warning.subject ? ` (${warning.subject})` : ''}: ${warning.message}`);
  }
  for (const error of report.errors) {
    console.error(`[kb] error ${error.code}${error.subject ? ` (${error.subject})` : ''}: ${error.message}`);
  }
  console.log(
    `[kb] validate ${report.ok ? '通过' : '失败'}：error ${report.errors.length}、warning ${report.warnings.length}`,
  );
}

async function runValidate(): Promise<number> {
  const { knowledgeBase } = await loadKnowledgeBase();
  const report = validateKnowledgeBase(
    knowledgeBase.materials,
    knowledgeBase.glossary,
    knowledgeBase.entities,
    knowledgeBase.derivations,
    knowledgeBase.entityDerivations,
  );
  printReport(report);
  return report.ok ? 0 : 1;
}

function readOption(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}

function printReconcile(report: ReconcileReport): void {
  const { counts } = report;
  console.log(
    `[kb] ${report.targetName}：总 ${counts.total}、材料 ${counts.coveredByMaterials}、术语 ${counts.coveredByGlossary}、` +
      `对象 ${counts.coveredByEntities}、派生 ${counts.derived}、内部占位 ${counts.internalPlaceholders}、未解释 ${counts.unaccounted}`,
  );
  const families = Object.entries(report.derivedByFamily).sort(([left], [right]) => left.localeCompare(right));
  for (const [family, count] of families) {
    console.log(`[kb]   派生 ${family}: ${count}`);
  }
  for (const key of report.unaccounted.slice(0, 20)) {
    console.error(`[kb]   未解释 ${key}`);
  }
  for (const key of report.duplicatedKeys.slice(0, 20)) {
    console.error(`[kb]   重复登记 ${key}`);
  }
}

async function runReconcile(args: readonly string[]): Promise<number> {
  const { knowledgeBase } = await loadKnowledgeBase();
  const legacyPath = resolveInsideRepo(LEGACY_LANG);
  const legacy = parseLegacyLang(await readFile(legacyPath, 'utf8'));
  // parseLegacyLang 保留 `S:` 前缀，对账前剥掉。
  const legacyKeys = [...legacy.map.keys()]
    .map((key) => key.replace(/^S:/, ''))
    .filter((key) => key.startsWith('gt.material.'));

  let failed = false;
  const legacyReport = reconcileMaterialKeys(
    knowledgeBase.materials,
    knowledgeBase.glossary,
    knowledgeBase.entities,
    knowledgeBase.derivations,
    legacyKeys,
    `gt6-legacy (${repoRelative(legacyPath)})`,
  );
  printReconcile(legacyReport);
  if (legacyReport.counts.unaccounted > 0 || legacyReport.duplicatedKeys.length > 0) failed = true;

  if (knowledgeBase.entityDerivations !== undefined) {
    const ENTITY_KEY_PREFIXES = [
      'gt.multitileentity.',
      'gt.multiitem.',
      'gt.metatool.',
      'gt.armor.',
      'gt.stone.',
      'gt.block.',
      'gt.recipe.',
      'fluid.',
    ];
    const entityLegacyKeys = [...legacy.map.keys()]
      .map((key) => key.replace(/^S:/, ''))
      .filter((key) => ENTITY_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)));
    const entityReport = reconcileEntityKeys(
      knowledgeBase.materials,
      knowledgeBase.glossary,
      knowledgeBase.entities,
      knowledgeBase.entityDerivations,
      entityLegacyKeys,
      `gt6-entities (${repoRelative(legacyPath)})`,
    );
    printReconcile(entityReport);
    if (entityReport.counts.unaccounted > 0 || entityReport.duplicatedKeys.length > 0) failed = true;
  }

  const option = readOption(args, '--gt6ce');
  const gt6cePath = option === undefined ? resolve(repoRoot, DEFAULT_GT6CE_LANG) : resolve(repoRoot, option);
  if (!(await pathExists(gt6cePath))) {
    if (option !== undefined) {
      console.error(`[kb] 找不到 GT6CE 语料：${gt6cePath}`);
      return 1;
    }
    console.log(`[kb] 跳过 GT6CE 对账（未找到 ${gt6cePath}；用 --gt6ce <path> 指定）`);
    return failed ? 1 : 0;
  }
  const raw = JSON.parse(await readFile(gt6cePath, 'utf8')) as Record<string, string>;
  const gt6ceKeys = Object.keys(raw).filter((key) => key.startsWith('material.gt6ce.'));
  const gt6ceReport = reconcileMaterialKeys(
    knowledgeBase.materials,
    knowledgeBase.glossary,
    knowledgeBase.entities,
    knowledgeBase.derivations,
    gt6ceKeys,
    `gt6ce (${gt6cePath})`,
  );
  printReconcile(gt6ceReport);
  if (gt6ceReport.counts.unaccounted > 0 || gt6ceReport.duplicatedKeys.length > 0) failed = true;

  return failed ? 1 : 0;
}

function describeHit(hit: QueryHit): string {
  const kindLabel = hit.kind === 'material' ? '材料' : hit.kind === 'glossary' ? '术语' : '对象';
  const lines = [`${kindLabel} ${hit.id}：${hit.en} / ${hit.zh}（命中 ${hit.matchedOn}）`];
  if (hit.material) {
    const record = hit.material;
    lines.push(
      `  类别 ${record.category}；形态 ${record.states.join('/')}；组成 ${formatComposition(record.composition)}`,
    );
    lines.push(
      `  出处 ${record.origin.kind} · ${record.origin.source}（${record.origin.evidence}）` +
        (record.origin.alsoIn ? `；也见于 ${record.origin.alsoIn.join(', ')}` : ''),
    );
    const urls = (record.origin.urls ?? []).join(' ');
    if (urls) lines.push(`  信源 ${urls}`);
    for (const entry of record.zh.legacy ?? []) lines.push(`  ${entry.status} ${entry.text}（${entry.source}）`);
    if (record.variantOf) lines.push(`  变体来源 ${record.variantOf}`);
    if (record.seeAlso) lines.push(`  关联 ${record.seeAlso.join(', ')}`);
    const keys = [...(record.keys.gt6 ?? []), ...(record.keys.gt6ce ?? []), ...(record.keys.gt6w ?? [])];
    if (keys.length > 0) lines.push(`  键 ${keys.join(' ')}`);
    lines.push(`  GT6CE ${record.targets.gt6ce}；traits ${(record.traits ?? []).join(',') || '—'}`);
    if (record.notes) lines.push(`  备注 ${record.notes}`);
  }
  const termOrEntity = hit.glossary ?? hit.entity;
  if (termOrEntity) {
    lines.push(`  域 ${termOrEntity.domain}`);
    for (const entry of termOrEntity.zh.legacy ?? []) lines.push(`  ${entry.status} ${entry.text}（${entry.source}）`);
    if (termOrEntity.seeAlso) lines.push(`  关联 ${termOrEntity.seeAlso.join(', ')}`);
    const keys = [
      ...(termOrEntity.keys?.gt6 ?? []),
      ...(termOrEntity.keys?.gt6ce ?? []),
      ...(termOrEntity.keys?.gt6w ?? []),
    ];
    if (keys.length > 0) lines.push(`  键 ${keys.join(' ')}`);
    if (termOrEntity.notes) lines.push(`  备注 ${termOrEntity.notes}`);
  }
  return lines.join('\n');
}

function extractQueryTerm(args: readonly string[]): string | undefined {
  let stopFlags = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (!stopFlags) {
      if (arg === '--') {
        stopFlags = true;
        continue;
      }
      if (arg === '--limit' || arg === '--out') {
        index++;
        continue;
      }
      if (arg.startsWith('--')) continue;
    }
    return arg;
  }
  return undefined;
}

async function runQuery(args: readonly string[]): Promise<number> {
  const term = extractQueryTerm(args);
  if (term === undefined) {
    console.error('[kb] 用法：kb query <term> [--json] [--limit <n>]');
    return 2;
  }
  const { knowledgeBase } = await loadKnowledgeBase();
  const limitOption = readOption(args, '--limit');
  const limit = limitOption === undefined ? undefined : Number.parseInt(limitOption, 10);
  const hits = queryKnowledgeBase(knowledgeBase, term, limit === undefined ? {} : { limit });
  if (args.includes('--json')) {
    console.log(JSON.stringify(hits, null, 2));
    return hits.length === 0 ? 1 : 0;
  }
  if (hits.length === 0) {
    console.log(`[kb] 没有命中「${term}」`);
    return 1;
  }
  for (const hit of hits) console.log(describeHit(hit));
  return 0;
}

/** 导出目录：默认 `packages/node/dist/materials`，`--out` 必须落在 `packages/node/dist` 内。 */
function resolveExportDir(args: readonly string[]): string {
  const option = readOption(args, '--out');
  const target = option === undefined ? join(artifactRoot, DEFAULT_EXPORT_DIR) : resolveInsideRepo(option);
  assertArtifactWritable(target);
  return target;
}

async function runRenderMd(args: readonly string[]): Promise<number> {
  const { knowledgeBase } = await loadKnowledgeBase();
  const rendered = renderMaterialsMarkdown(knowledgeBase);
  const outDir = resolveExportDir(args);
  await mkdir(outDir, { recursive: true });
  for (const [file, content] of Object.entries(rendered)) {
    const path = join(outDir, file);
    await writeFile(path, content, 'utf8');
    console.log(`[kb] 写入 ${repoRelative(path)}`);
  }
  return 0;
}

function printUsage(): void {
  console.log(`用法：gt6tg kb <command> [options]

命令：
  validate                 schema、键、出处与中文撞车门禁
  reconcile [--gt6ce <p>]  三方对账 gt.material.*（2,227）与 material.gt6ce.*（1,666）
  query <term> [--json]    按 id/英文/中文/语言键检索材料与术语
  render-md [--out <path>] 按需导出阅读视图（默认 packages/node/dist/materials/）`);
}

/** CLI 入口：返回退出码，由 `main.ts` 统一接线。 */
export async function runKb(args: string[]): Promise<number> {
  const command = args[0] ?? 'help';
  const rest = args.slice(1);
  switch (command) {
    case 'validate':
      return runValidate();
    case 'reconcile':
      return runReconcile(rest);
    case 'query':
      return runQuery(rest);
    case 'render-md':
      return runRenderMd(rest);
    case 'help':
    case '--help':
    case '-h':
      printUsage();
      return 0;
    default:
      console.error(`[kb] 未知命令：${command}`);
      printUsage();
      return 2;
  }
}
