import { describe, expect, it } from 'vitest';
import { compileConfig } from '../src/compile-config';
import { applyCandidatesToEntries, buildFallbackMap, generateFromEntries } from '../src/engine/apply';
import type { GeneratorConfig, ProjectConfigV2 } from '../src/types/config';
import type { LangEntry } from '../src/types/lang';

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

function entry(key: string, value: string): LangEntry {
  return { key, value, line: 1 };
}

const compiled = compileConfig(
  config([
    { group: 'dust', namespace: 'S:', dict: { 'Iron Dust': '铁粉', Echo: 'Echo' } },
    { group: 'crate', namespace: 'S:', rules: [{ s: 'Crate of {0}', t: '{0}板条箱', subs: ['dust'] }] },
  ]),
);

describe('buildFallbackMap', () => {
  it('keeps the first value for a duplicated key', () => {
    const map = buildFallbackMap([entry('S:a', '先'), entry('S:a', '后'), entry('S:b', '乙')]);

    expect(map.get('S:a')).toBe('先');
    expect(map.get('S:b')).toBe('乙');
  });
});

describe('generateFromEntries', () => {
  it('applies dict, rule, fallback and unknown entries', () => {
    const result = generateFromEntries(
      compiled,
      [
        entry('S:Iron Dust', 'Iron Dust'),
        entry('S:Crate of Iron Dust', 'Crate of Iron Dust'),
        entry('S:Fallback', 'Fallback'),
        entry('S:Missing', 'Missing'),
      ],
      [entry('S:Fallback', '回退')],
    );

    expect([...result.output]).toEqual([
      ['S:Iron Dust', '铁粉'],
      ['S:Crate of Iron Dust', '铁粉板条箱'],
      ['S:Fallback', '回退'],
      ['S:Missing', 'Missing'],
    ]);
    expect([...result.unknown]).toEqual(['S:Missing']);
    expect(result.stats).toEqual({
      sourceKeys: 4,
      outputKeys: 4,
      unknownKeys: 1,
      sameAsEnglish: 0,
      conflictKeys: 0,
      matchedKeys: 2,
    });
    expect(result.timings.phases.map((phase) => phase.name)).toEqual(['match', 'dedupe', 'apply']);
  });

  it('counts sameAsEnglish only for matched entries, never for unknown ones', () => {
    const result = generateFromEntries(compiled, [entry('S:Echo', 'Echo'), entry('S:Missing', 'Missing')], []);

    expect(result.output.get('S:Echo')).toBe('Echo');
    expect(result.stats.sameAsEnglish).toBe(1);
    expect(result.stats.unknownKeys).toBe(1);
    expect(result.stats.matchedKeys).toBe(1);
  });

  it('counts a fallback that equals the English value as sameAsEnglish', () => {
    const result = generateFromEntries(compiled, [entry('S:Raw', 'Raw')], [entry('S:Raw', 'Raw')]);

    expect(result.stats).toMatchObject({ sameAsEnglish: 1, matchedKeys: 0, unknownKeys: 0 });
  });

  it('uses the first fallback value when the file repeats a key', () => {
    const result = generateFromEntries(
      compiled,
      [entry('S:Fallback', 'Fallback')],
      [entry('S:Fallback', '先'), entry('S:Fallback', '后')],
    );

    expect(result.output.get('S:Fallback')).toBe('先');
  });

  it('counts conflicting targets for the same source value', () => {
    const conflicting = compileConfig(
      config([
        { group: 'dust', namespace: 'S:', dict: { 'Gold Dust': '金粉A' } },
        { group: 'dust2', namespace: 'S:', dict: { 'Gold Dust': '金粉B' } },
      ]),
    );
    const result = generateFromEntries(conflicting, [entry('S:Gold Dust', 'Gold Dust')], []);

    expect(result.stats.conflictKeys).toBe(1);
    // 冲突时仍按 (gen,ri,combo) 取最后，即后声明的 dust2。
    expect(result.output.get('S:Gold Dust')).toBe('金粉B');
  });
});

describe('applyCandidatesToEntries', () => {
  it('reproduces generateFromEntries from its candidate buckets', () => {
    const sourceEntries = [entry('S:Iron Dust', 'Iron Dust'), entry('S:Missing', 'Missing')];
    const fallbackEntries = [entry('S:Missing', '缺失')];
    const generated = generateFromEntries(compiled, sourceEntries, fallbackEntries);

    const applied = applyCandidatesToEntries(
      compiled,
      sourceEntries,
      generated.candidatesByValue,
      buildFallbackMap(fallbackEntries),
    );

    expect(applied.output).toEqual(generated.output);
    expect(applied.stats).toEqual(generated.stats);
  });

  it('falls back to the English value and marks unknown without candidates', () => {
    const applied = applyCandidatesToEntries(compiled, [entry('S:Missing', 'Missing')], new Map(), new Map());

    expect(applied.output.get('S:Missing')).toBe('Missing');
    expect([...applied.unknown]).toEqual(['S:Missing']);
    expect(applied.stats).toEqual({
      sourceKeys: 1,
      outputKeys: 1,
      unknownKeys: 1,
      sameAsEnglish: 0,
      conflictKeys: 0,
      matchedKeys: 0,
    });
  });
});
