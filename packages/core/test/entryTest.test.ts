import { describe, expect, it } from 'vitest';
import { compileConfig } from '../src/compile-config';
import { buildFallbackMap } from '../src/engine/apply';
import { testEntry } from '../src/engine/entryTest';
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
    { group: 'dust', namespace: 'S:', dict: { 'Iron Dust': '铁粉' } },
    { group: 'crate', namespace: 'S:', rules: [{ s: 'Crate of {0}', t: '{0}板条箱', subs: ['dust'] }] },
  ]),
);

const fallbackMap = buildFallbackMap([{ key: 'S:Fallback', value: '回退', line: 1 }]);

describe('testEntry', () => {
  it('selects a matched candidate and records a select step', () => {
    const result = testEntry(compiled, 'S:Iron Dust', 'Iron Dust', fallbackMap);

    expect(result.selected?.target).toBe('铁粉');
    expect(result.matchedNamespace).toBe('S:');
    expect(result.unknown).toBe(false);
    expect(result.candidates).toHaveLength(1);
    expect(result.steps.at(-1)).toMatchObject({ stage: 'select', message: '铁粉' });
  });

  it('reports the rule target for a composed entry', () => {
    const result = testEntry(compiled, 'S:Crate of Iron Dust', 'Crate of Iron Dust', fallbackMap);

    expect(result.selected?.target).toBe('铁粉板条箱');
    expect(result.selected?.generator).toBe('crate');
    expect(result.tokens).toEqual(['Crate', 'of', 'Iron', 'Dust']);
  });

  it('falls back when no candidate matches', () => {
    const result = testEntry(compiled, 'S:Fallback', 'Fallback', fallbackMap);

    expect(result.selected).toBeUndefined();
    expect(result.fallback).toBe('回退');
    expect(result.unknown).toBe(false);
    expect(result.steps.at(-1)).toMatchObject({ stage: 'fallback', message: '回退' });
  });

  it('marks unknown entries and passes issues through', () => {
    const issues = [{ severity: 'warning' as const, code: 'custom', message: '自定义问题' }];
    const result = testEntry(compiled, 'S:Missing', 'Missing', fallbackMap, issues);

    expect(result.unknown).toBe(true);
    expect(result.selected).toBeUndefined();
    expect(result.fallback).toBeUndefined();
    expect(result.targetId).toBe('');
    expect(result.issues).toBe(issues);
    expect(result.steps.at(-1)?.stage).toBe('reject');
  });
});
