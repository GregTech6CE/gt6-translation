import type { LangEntry } from '../types/lang';
import type { TimingReport } from '../types/timing';
import type { CompiledProject } from './compile';
import type { Candidate } from './matcher';
import { Matcher, dedupeCandidates, selectCandidate } from './matcher';
import { createTimer } from './timing';

export interface GenerationStats {
  sourceKeys: number;
  outputKeys: number;
  unknownKeys: number;
  /** 命中规则/词典或 fallback 且译文与英文原文相同的条目数；unknown 条目不计入。 */
  sameAsEnglish: number;
  conflictKeys: number;
  matchedKeys: number;
}

export interface ApplyResult {
  output: Map<string, string>;
  unknown: Set<string>;
  stats: GenerationStats;
}

export interface GenerationResult extends ApplyResult {
  /** 按原文值聚合的候选；调用方可在测试/调试时查看。 */
  candidatesByValue: Map<string, Candidate[]>;
  /** 匹配、去重、apply 的分阶段耗时。 */
  timings: TimingReport;
}

/** fallback 必须首次获胜，对齐 C++ 的 std::map::insert。 */
export function buildFallbackMap(entries: readonly LangEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    if (!map.has(entry.key)) map.set(entry.key, entry.value);
  }
  return map;
}

/**
 * 把候选与 fallback 应用到词条，产出输出表、unknown 集合与统计。
 *
 * 与 C++ 原型一致：候选先按 namespace 前缀过滤，再由 (gen,ri,combo) 取最后；
 * 未命中候选时用 fallback（首次获胜），仍未命中则原样输出并记入 unknown。
 *
 * `core.generateFromEntries` 与 runtime 的 JobRunner 共用这一段，避免两份实现漂移。
 */
export function applyCandidatesToEntries(
  compiled: CompiledProject,
  entries: readonly LangEntry[],
  candidatesByValue: Map<string, Candidate[]>,
  fallbackMap: Map<string, string>,
): ApplyResult {
  const output = new Map<string, string>();
  const unknown = new Set<string>();
  let sameAsEnglish = 0;
  let conflictKeys = 0;
  let matchedKeys = 0;

  for (const entry of entries) {
    const list = candidatesByValue.get(entry.value) ?? [];
    // 只统计对当前 key 真正可用的候选（namespace 前缀过滤之后），
    // 否则同一原文在不同 namespace 下的正常多译文会被误算成冲突。
    const validTargets = new Set<string>();
    for (const candidate of list) {
      if (candidate.namespace && !entry.key.startsWith(candidate.namespace)) continue;
      validTargets.add(candidate.target);
    }
    if (validTargets.size > 1) conflictKeys++;

    const selected = selectCandidate(compiled, entry.key, list);
    if (selected) {
      output.set(entry.key, selected.target);
      matchedKeys++;
      if (selected.target === entry.value) sameAsEnglish++;
      continue;
    }

    const fallback = fallbackMap.get(entry.key);
    if (fallback !== undefined) {
      output.set(entry.key, fallback);
      if (fallback === entry.value) sameAsEnglish++;
      continue;
    }

    // unknown 条目沿用英文原文，但不算“译文与英文相同”：它没有命中任何译文。
    output.set(entry.key, entry.value);
    unknown.add(entry.key);
  }

  return {
    output,
    unknown,
    stats: {
      sourceKeys: entries.length,
      outputKeys: output.size,
      unknownKeys: unknown.size,
      sameAsEnglish,
      conflictKeys,
      matchedKeys,
    },
  };
}

/**
 * 对完整输入执行 pattern 匹配并生成输出。
 *
 * 与原型一致：候选按“原文值”聚合；同一个值可能被不同 key/namespace 匹配到多条候选，
 * 最终由 key 前缀过滤 + (gen,ri,combo) 取最后。
 */
export function generateFromEntries(
  compiled: CompiledProject,
  sourceEntries: readonly LangEntry[],
  fallbackEntries: readonly LangEntry[],
): GenerationResult {
  const timer = createTimer('generate');
  const matcher = new Matcher(compiled);
  const candidatesByValue = new Map<string, Candidate[]>();

  for (const entry of sourceEntries) {
    const matched = matcher.match(entry.key, entry.value);
    if (matched.candidates.length === 0) continue;
    let list = candidatesByValue.get(entry.value);
    if (!list) candidatesByValue.set(entry.value, (list = []));
    for (const candidate of matched.candidates) list.push(candidate);
  }
  timer.mark('match');

  for (const [value, list] of candidatesByValue) {
    if (list.length > 1) candidatesByValue.set(value, dedupeCandidates(compiled, list));
  }
  timer.mark('dedupe');

  const applied = applyCandidatesToEntries(
    compiled,
    sourceEntries,
    candidatesByValue,
    buildFallbackMap(fallbackEntries),
  );
  timer.mark('apply');

  return { ...applied, candidatesByValue, timings: timer.finish() };
}
