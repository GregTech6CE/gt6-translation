import { describe, expect, it } from 'vitest';
import { compileConfig } from '../src/compile-config';
import { Matcher, candidateViews, dedupeCandidates, selectCandidate, type Candidate } from '../src/engine/matcher';
import type { TraceStep } from '../src/types/api';
import type { GeneratorConfig, ProjectConfigV2 } from '../src/types/config';

function config(generators: GeneratorConfig[]): ProjectConfigV2 {
  return {
    schemaVersion: 2,
    defaultTarget: 't',
    targets: [
      {
        id: 't',
        label: 'T',
        format: 'legacy-lang',
        workplace: 'packages/legacy/workplace',
        source: 'en/GregTech.lang',
        fallback: 'zh/GregTech.fallback.lang',
        output: 'zh/GregTech.lang',
        unknown: 'zh/GregTech.unknown.lang',
        encoding: 'utf-8',
        lineEnding: 'crlf',
      },
    ],
    generators,
  };
}

const compiled = compileConfig(
  config([
    { group: 'dust', namespace: 'S:', dict: { 'Iron Dust': '铁粉', 'Gold Dust': { 'T:': '金粉T', 'S:': '金粉S' } } },
    { group: 'crate', namespace: 'S:', rules: [{ s: 'Crate of {0}', t: '{0}板条箱', subs: ['dust'] }] },
  ]),
);

describe('Matcher', () => {
  it('matches a dict entry through the lex trie', () => {
    const result = new Matcher(compiled).match('S:Iron Dust', 'Iron Dust');

    expect(result.tokens).toEqual(['Iron', 'Dust']);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ target: '铁粉', namespace: 'S:' });
  });

  it('matches a rule and renders the target template', () => {
    const result = new Matcher(compiled).match('S:Crate of Iron Dust', 'Crate of Iron Dust');

    expect(result.candidates.map((candidate) => candidate.target)).toEqual(['铁粉板条箱']);
  });

  it('filters lex entries by the key namespace', () => {
    const matcher = new Matcher(compiled);
    const sResult = matcher.match('S:Gold Dust', 'Gold Dust');
    const tResult = matcher.match('T:Gold Dust', 'Gold Dust');

    expect(sResult.candidates.map((candidate) => candidate.target)).toEqual(['金粉S']);
    expect(tResult.candidates.map((candidate) => candidate.target)).toEqual(['金粉T']);
  });

  it('returns no candidate for an unknown value', () => {
    const result = new Matcher(compiled).match('S:Unknown', 'Unknown');

    expect(result.candidates).toEqual([]);
    expect(result.patternsTried).toBe(0);
  });

  it('records trace steps for a successful match', () => {
    const trace: TraceStep[] = [];
    new Matcher(compiled).match('S:Iron Dust', 'Iron Dust', { trace });

    expect(trace.map((step) => step.stage)).toContain('tokenize');
    expect(trace.map((step) => step.stage)).toContain('emit');
  });
});

describe('candidate helpers', () => {
  const candidates: Candidate[] = [
    { target: '金粉S', namespace: 'S:', idx: 0, generatorId: 0, rule: 0, combo: 0 },
    { target: '金粉T', namespace: 'T:', idx: 0, generatorId: 1, rule: 0, combo: 1 },
  ];

  it('selects the best candidate after namespace filtering', () => {
    expect(selectCandidate(compiled, 'S:Gold Dust', candidates)?.target).toBe('金粉S');
    expect(selectCandidate(compiled, 'T:Gold Dust', candidates)?.target).toBe('金粉T');
    expect(selectCandidate(compiled, 'X:Gold Dust', candidates)).toBeUndefined();
  });

  it('dedupes by namespace and target, keeping the better order', () => {
    const duplicated: Candidate[] = [
      { target: '金粉', namespace: 'S:', idx: 0, generatorId: 0, rule: 0, combo: 0 },
      { target: '金粉', namespace: 'S:', idx: 0, generatorId: 1, rule: 0, combo: 0 },
      { target: '铁粉', namespace: 'S:', idx: 1, generatorId: 0, rule: 0, combo: 1 },
    ];
    const deduped = dedupeCandidates(compiled, duplicated);

    expect(deduped).toHaveLength(2);
    expect(deduped.find((candidate) => candidate.target === '金粉')?.generatorId).toBe(1);
  });

  it('exposes candidate views with the generator group name', () => {
    const views = candidateViews(compiled, candidates);

    expect(views[0]).toMatchObject({ target: '金粉S', generator: 'dust', generatorId: 0 });
  });
});
