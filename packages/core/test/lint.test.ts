import { describe, expect, it } from 'vitest';
import { lintProject } from '../src/config/lint';
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

describe('lintProject', () => {
  it('reports the legacy complete/extensions typos as errors', () => {
    const lint = lintProject(
      config([{ group: 'dust', dict: { 'Iron Dust': '铁粉' }, complete: true, extensions: 'x' }]),
    );

    expect(lint.issues.find((issue) => issue.code === 'legacy.complete-key')).toMatchObject({
      severity: 'error',
      path: 'generators.0.complete',
    });
    expect(lint.issues.find((issue) => issue.code === 'legacy.extensions-key')).toMatchObject({
      severity: 'error',
      path: 'generators.0.extensions',
    });
  });

  it('detects group reference cycles', () => {
    const lint = lintProject(
      config([
        { group: 'a', rules: [{ s: 'A {0}', t: '甲{0}', subs: ['b'] }] },
        { group: 'b', rules: [{ s: 'B {0}', t: '乙{0}', subs: ['a'] }] },
      ]),
    );

    expect(lint.stats.cycles).toEqual([['a', 'b', 'a']]);
    expect(lint.issues.find((issue) => issue.code === 'group.cycle')).toMatchObject({ severity: 'warning' });
  });

  it('handles self-loops, cycles sharing nodes, and diamond DAGs without false positives', () => {
    const selfLoopLint = lintProject(config([{ group: 'a', rules: [{ s: 'A {0}', t: '甲{0}', subs: ['a'] }] }]));
    expect(selfLoopLint.stats.cycles).toEqual([['a', 'a']]);
    expect(selfLoopLint.issues.filter((issue) => issue.code === 'group.cycle')).toHaveLength(1);

    const sharedNodeLint = lintProject(
      config([
        { group: 'a', rules: [{ s: 'A {0}', t: '甲{0}', subs: ['b'] }] },
        { group: 'b', rules: [{ s: 'B {0}', t: '乙{0}', subs: ['c'] }] },
        { group: 'c', rules: [{ s: 'C {0}', t: '丙{0}', subs: ['d', 'b'] }] },
        { group: 'd', rules: [{ s: 'D {0}', t: '丁{0}', subs: ['a'] }] },
      ]),
    );
    expect(sharedNodeLint.stats.cycles).toHaveLength(2);
    expect(sharedNodeLint.issues.filter((issue) => issue.code === 'group.cycle')).toHaveLength(2);

    const diamondLint = lintProject(
      config([
        { group: 'a', rules: [{ s: 'A {0}', t: '甲{0}', subs: ['b', 'c'] }] },
        { group: 'b', rules: [{ s: 'B {0}', t: '乙{0}', subs: ['d'] }] },
        { group: 'c', rules: [{ s: 'C {0}', t: '丙{0}', subs: ['d'] }] },
        { group: 'd', dict: { X: '丁' } },
      ]),
    );
    expect(diamondLint.stats.cycles).toEqual([]);
    expect(diamondLint.issues.filter((issue) => issue.code === 'group.cycle')).toEqual([]);
  });

  it('reports missing groups and out-of-range slots as errors', () => {
    const lint = lintProject(
      config([
        { group: 'a', rules: [{ s: 'A {1}', t: '甲{0}', subs: ['ghost'] }] },
        { group: 'b', dict: { X: 'x' } },
      ]),
    );

    expect(lint.stats.missingGroups).toEqual(['ghost']);
    expect(lint.issues.find((issue) => issue.code === 'group.missing')?.severity).toBe('error');
    expect(lint.issues.find((issue) => issue.code === 'rule.slot-out-of-range')?.severity).toBe('error');
  });

  it('flags affix rules and empty dict entries without failing the config', () => {
    const lint = lintProject(
      config([
        { group: 'material', dict: { Abyssalnite: '深渊' } },
        { group: 'crush', rules: [{ s: '{0}Crush', t: '{0}粉碎', subs: ['material'] }] },
        { group: 'empty', dict: { '': '空', X: '' } },
      ]),
    );

    expect(lint.issues.find((issue) => issue.code === 'rule.affix')?.severity).toBe('info');
    expect(lint.issues.find((issue) => issue.code === 'dict.empty-key')?.severity).toBe('warning');
    expect(lint.issues.find((issue) => issue.code === 'dict.empty-value')?.severity).toBe('info');
  });

  it('sorts issues by severity and collects stats', () => {
    const lint = lintProject(
      config([
        { group: 'dust', namespace: 'S:', dict: { 'Iron Dust': '铁粉', 'Gold Dust': '金粉' }, completed: false },
        { group: 'crate', namespace: 'S:', rules: [{ s: 'Crate of {0}', t: '{0}板条箱', subs: ['dust'] }] },
        { group: 'ghost-ref', rules: [{ s: 'Ghost {0}', t: '幽灵{0}', subs: ['missing'] }] },
      ]),
    );

    expect(lint.issues[0]?.severity).toBe('error');
    expect(lint.stats).toMatchObject({
      generatorBlocks: 3,
      dictGenerators: 1,
      ruleGenerators: 2,
      groups: 3,
      ruleTemplates: 2,
      dictEntries: 2,
      completedGenerators: 2,
      missingGroups: ['missing'],
    });
  });
});
