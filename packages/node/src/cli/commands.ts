import {
  compareToGolden,
  lintProject,
  parseLegacyLang,
  parseProjectJsonc,
  writeLegacyLang,
  type LangEntry,
} from '@gt6tg/core';
import { NodeEngineClient } from '../engine-client';
import { hashOutput } from '../hash';
import { projectFilePath } from '../paths';
import { loadCorpus, loadProjectConfig, loadProjectData, repoRelative, writeArtifactTexts } from './lib';

export async function runGenerate(_args: string[]): Promise<number> {
  const data = loadProjectData();
  const client = new NodeEngineClient();
  try {
    const compiled = await client.compile(data.configText);
    const started = performance.now();
    const run = await client.run({
      compileId: compiled.compileId,
      sourceText: data.sourceText,
      fallbackText: data.fallbackText,
      lineEnding: data.target.lineEnding,
      scope: 'all',
    });
    const dist = writeArtifactTexts(data, {
      output: run.outputText,
      unknown: run.unknownText,
    });

    console.log(
      JSON.stringify(
        {
          target: data.target.id,
          compileMs: Math.round(compiled.timings.totalMs),
          generateMs: Math.round(run.summary.timings.totalMs),
          totalMs: Math.round(performance.now() - started),
          patterns: compiled.stats,
          sourceKeys: run.summary.stats.sourceKeys,
          outputKeys: run.summary.stats.outputKeys,
          unknown: run.summary.stats.unknownKeys,
          stats: run.summary.stats,
          hash: run.summary.hash,
          dist: {
            root: repoRelative(dist.root),
            output: repoRelative(dist.output),
            unknown: repoRelative(dist.unknown),
          },
          note: '只写入 packages/node/dist，不修改 legacy，也不生成 .bak。',
        },
        null,
        2,
      ),
    );
    return 0;
  } finally {
    client.close();
  }
}

/**
 * 生成 -> 回读 -> 与 legacy golden 对比。
 *
 * 默认只读：输出只在内存里生成，再用 legacy 格式写一遍并回读，确认格式无损；
 * 只有显式传 `--write` 才把产物写进 `packages/node/dist`。
 */
export async function runParity(args: string[]): Promise<number> {
  const write = args.includes('--write');
  const data = loadProjectData();
  const client = new NodeEngineClient();
  try {
    const compiled = await client.compile(data.configText);
    const run = await client.run({
      compileId: compiled.compileId,
      sourceText: data.sourceText,
      fallbackText: data.fallbackText,
      lineEnding: data.target.lineEnding,
      scope: 'all',
    });

    const output = parseLegacyLang(run.outputText).map;
    const unknownMap = parseLegacyLang(run.unknownText).map;
    const artifact = { output, unknown: new Set(unknownMap.keys()) };

    const parity = compareToGolden(data.golden, artifact, data.goldenUnknown);
    const outputRoundTrip = roundTrip(output, data.target.lineEnding);
    const unknownRoundTrip = roundTrip(unknownMap, data.target.lineEnding);
    const roundTripOk = outputRoundTrip.hash === run.summary.hash && outputRoundTrip.lossless;
    const unknownRoundTripOk =
      unknownRoundTrip.lossless && sameSet(new Set(unknownMap.keys()), new Set(run.unknownKeys));
    const ok = parity.ok && roundTripOk && unknownRoundTripOk;

    const deadFallbackKeys = data.fallback.entries.filter((entry) => !data.source.map.has(entry.key)).length;
    const fallbackDiagnostics = {
      path: repoRelative(data.fallbackPath),
      totalEntries: data.fallback.entries.length,
      uniqueKeys: data.fallback.map.size,
      duplicateKeys: data.fallback.duplicates.length,
      deadKeys: deadFallbackKeys,
    };

    const dist = write ? writeArtifactTexts(data, { output: run.outputText, unknown: run.unknownText }) : undefined;

    console.log(
      JSON.stringify(
        {
          target: data.target.id,
          write,
          compileMs: Math.round(compiled.timings.totalMs),
          generateMs: Math.round(run.summary.timings.totalMs),
          totalMs: Math.round(run.summary.durationMs),
          patterns: compiled.stats,
          sourceKeys: run.summary.stats.sourceKeys,
          outputKeys: output.size,
          unknown: artifact.unknown.size,
          stats: run.summary.stats,
          fallbackDiagnostics,
          golden: repoRelative(data.goldenPath),
          goldenUnknown: repoRelative(data.goldenUnknownPath),
          dist: dist
            ? {
                root: repoRelative(dist.root),
                output: repoRelative(dist.output),
                unknown: repoRelative(dist.unknown),
              }
            : null,
          mismatch: parity.mismatch,
          extraKeys: parity.extraKeys,
          unknownMismatch: parity.unknownMismatch,
          samples: parity.samples,
          extraSamples: parity.extraSamples,
          unknownSamples: parity.unknownSamples,
          hash: outputRoundTrip.hash,
          roundTrip: {
            hash: outputRoundTrip.hash,
            expected: run.summary.hash,
            ok: roundTripOk,
            unknownHash: unknownRoundTrip.hash,
            unknownOk: unknownRoundTripOk,
          },
          ok,
        },
        null,
        2,
      ),
    );

    if (!ok) {
      console.error('[parity] 失败：内存产物与 legacy golden 不一致，或回读结果与生成结果不同');
      return 1;
    }
    return 0;
  } finally {
    client.close();
  }
}

export async function runHash(_args: string[]): Promise<number> {
  const corpus = loadCorpus();
  const client = new NodeEngineClient();
  try {
    const compiled = await client.compile(corpus.configText);
    const run = await client.run({
      compileId: compiled.compileId,
      sourceText: corpus.sourceText,
      fallbackText: corpus.fallbackText,
      lineEnding: corpus.target.lineEnding,
      scope: 'all',
    });

    console.log(
      JSON.stringify(
        {
          target: corpus.target.id,
          sourceKeys: run.summary.stats.sourceKeys,
          outputKeys: run.summary.stats.outputKeys,
          unknown: run.summary.stats.unknownKeys,
          stats: run.summary.stats,
          patterns: compiled.stats,
          hash: run.summary.hash,
        },
        null,
        2,
      ),
    );
    return 0;
  } finally {
    client.close();
  }
}

/** 严格 lint：任何 error 都算失败，不再对历史缺失组做豁免。 */
export async function runLint(_args: string[]): Promise<number> {
  const { configText } = loadProjectConfig();
  const parsed = parseProjectJsonc(configText);
  const lint = parsed.config ? lintProject(parsed.config) : undefined;
  const issues = [...parsed.issues, ...(lint?.issues ?? [])];
  const errors = issues.filter((issue) => issue.severity === 'error');

  console.log(
    JSON.stringify(
      {
        path: projectFilePath,
        parsed: parsed.config !== null,
        stats: lint?.stats,
        issues,
        errors: errors.length,
        ok: errors.length === 0,
      },
      null,
      2,
    ),
  );

  return errors.length ? 1 : 0;
}

/** gate 的顺序检查：lint 严格零 error，然后 parity、hash、perf。 */
export async function runGate(args: string[]): Promise<number> {
  const lintCode = await runLint(args);
  if (lintCode !== 0) return lintCode;

  const parityCode = await runParity(args);
  if (parityCode !== 0) return parityCode;

  const hashCode = await runHash(args);
  if (hashCode !== 0) return hashCode;

  const { runPerf } = await import('./perf');
  return runPerf(args);
}

/**
 * 把输出表按 legacy 格式写一遍再解析回来，验证写盘格式无损。
 * `lossless` 同时要求 key 数与内容指纹都不变。
 */
function roundTrip(map: Map<string, string>, lineEnding: 'crlf' | 'lf'): { hash: string; lossless: boolean } {
  const entries: LangEntry[] = [...map].map(([key, value], index) => ({ key, value, line: index + 1 }));
  const reparsed = parseLegacyLang(writeLegacyLang(entries, lineEnding)).map;
  const hash = hashOutput(reparsed);
  return { hash, lossless: reparsed.size === map.size && hash === hashOutput(map) };
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}
