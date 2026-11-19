import {
  applyCandidatesToEntries,
  buildFallbackMap,
  createTimer,
  dedupeCandidates,
  Matcher,
  type Candidate,
  type CompiledProject,
  type LangEntry,
} from '@gt6tg/core';
import type { Clock } from './clock';
import { roundMs } from './clock';
import type { HashProvider } from './hash';
import { hashOutput } from './hash';
import type { RunResult, RunSummary } from './run-summary';

export type JobScope = { kind: 'all' } | { kind: 'keys'; keys: readonly string[] };
export type JobProgressPhase = 'prepare' | 'run' | 'done';

export interface JobProgress {
  jobId: string;
  phase: JobProgressPhase;
  processed: number;
  total: number;
}

export interface JobRunInput {
  jobId: string;
  compileId: string;
  compiled: CompiledProject;
  sourceEntries: readonly LangEntry[];
  fallbackEntries?: readonly LangEntry[];
  scope?: JobScope;
  includeCandidates?: boolean;
  /** 每处理多少条让出一次事件循环；默认 4096。 */
  chunkSize?: number;
  hash: HashProvider;
  clock: Clock;
  onProgress?: (progress: JobProgress) => void;
}

const DEFAULT_CHUNK_SIZE = 4096;

/**
 * 分块执行完整的 match/dedupe/apply 流程。
 *
 * 每块结束让出一次事件循环，使 Worker 能处理 progress/cancel/metrics 消息；
 * 去重与 apply 直接复用 core 的 `dedupeCandidates` / `applyCandidatesToEntries`，
 * 因此输出与统计口径和 `core.generateFromEntries` 完全一致。
 */
export class JobRunner {
  async run(input: JobRunInput): Promise<RunResult> {
    const startedAt = input.clock.now();
    const scope = input.scope ?? { kind: 'all' };
    const entries = selectEntries(input.sourceEntries, scope);
    const total = entries.length;
    const requestedKeys = scope.kind === 'keys' ? scope.keys.length : input.sourceEntries.length;
    const chunkSize = Math.max(1, Math.trunc(input.chunkSize ?? DEFAULT_CHUNK_SIZE));

    emit(input, 'prepare', 0, total);

    const timer = createTimer('generate');
    const matcher = new Matcher(input.compiled);
    const candidatesByValue = new Map<string, Candidate[]>();

    for (let start = 0; start < total; start += chunkSize) {
      const end = Math.min(start + chunkSize, total);
      for (let index = start; index < end; index++) {
        const entry = entries[index]!;
        const matched = matcher.match(entry.key, entry.value);
        if (matched.candidates.length === 0) continue;
        let list = candidatesByValue.get(entry.value);
        if (!list) candidatesByValue.set(entry.value, (list = []));
        for (const candidate of matched.candidates) list.push(candidate);
      }
      emit(input, 'run', end, total);
      if (end < total) await yieldToEventLoop();
    }
    timer.mark('match');

    for (const [value, list] of candidatesByValue) {
      if (list.length > 1) candidatesByValue.set(value, dedupeCandidates(input.compiled, list));
    }
    timer.mark('dedupe');

    const fallbackMap = buildFallbackMap(input.fallbackEntries ?? []);
    const applied = applyCandidatesToEntries(input.compiled, entries, candidatesByValue, fallbackMap);
    timer.mark('apply');

    let candidateBuckets = 0;
    let candidateItems = 0;
    for (const candidates of candidatesByValue.values()) {
      candidateBuckets++;
      candidateItems += candidates.length;
    }

    const hash = await hashOutput(input.hash, applied.output);
    const stats = applied.stats;
    const summary: RunSummary = {
      jobId: input.jobId,
      compileId: input.compileId,
      scope: scope.kind,
      requestedKeys,
      sourceKeys: stats.sourceKeys,
      processed: total,
      stats,
      timings: timer.finish(),
      hash,
      candidateBuckets,
      candidateItems,
      durationMs: roundMs(input.clock.now() - startedAt),
    };

    emit(input, 'done', total, total);

    return {
      summary,
      output: applied.output,
      unknown: applied.unknown,
      candidatesByValue: input.includeCandidates ? candidatesByValue : new Map(),
    };
  }
}

function selectEntries(sourceEntries: readonly LangEntry[], scope: JobScope): LangEntry[] {
  if (scope.kind === 'all') return [...sourceEntries];
  const keys = new Set(scope.keys);
  return sourceEntries.filter((entry) => keys.has(entry.key));
}

function emit(input: JobRunInput, phase: JobProgressPhase, processed: number, total: number): void {
  if (!input.onProgress) return;
  try {
    input.onProgress({ jobId: input.jobId, phase, processed, total });
  } catch {
    // 进度回调只做观测，不能影响生成结果。
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
