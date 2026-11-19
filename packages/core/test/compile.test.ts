import { describe, expect, it } from 'vitest';
import { compileConfig } from '../src/compile-config';
import { compileProject, patternLabel } from '../src/engine/compile';
import { buildLexicon } from '../src/engine/lexicon';
import { buildModel } from '../src/engine/model';
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

const project = config([
  { group: 'dust', namespace: 'S:', dict: { 'Iron Dust': '铁粉', 'Gold Dust': '金粉' } },
  { group: 'crate', namespace: 'S:', rules: [{ s: 'Crate of {0}', t: '{0}板条箱', subs: ['dust'] }] },
]);

describe('compileProject', () => {
  it('compiles dict groups into LEX patterns and rules into LIT/LEX/REDUCE', () => {
    const compiled = compileConfig(project);
    const labels = compiled.topPatterns.map((pattern) => patternLabel(compiled, pattern));

    expect(labels).toContain('LEX(dust)');
    expect(labels).toContain('LIT(Crate) | LIT(of) | LEX(dust) | REDUCE(crate:0)');
    expect(compiled.stats).toMatchObject({ lexEntries: 2 });
    expect(compiled.stats.topPatterns).toBe(labels.length);
    expect(compiled.stats.allPatterns).toBeGreaterThanOrEqual(compiled.stats.topPatterns);
  });

  it('registers patterns under their namespace in the trie', () => {
    const compiled = compileConfig(project);
    const namespaceNode = compiled.namespaceRoot.children.get('S')?.children.get(':');

    expect(namespaceNode?.patterns?.length).toBeGreaterThan(0);
    expect(namespaceNode?.candidates?.size).toBe(namespaceNode?.patterns?.length);
  });

  it('records compile phases when built through compileConfig', () => {
    const compiled = compileConfig(project);

    expect(compiled.timings?.label).toBe('compile');
    expect(compiled.timings?.phases.map((phase) => phase.name)).toEqual([
      'model',
      'lexicon',
      'groups',
      'topPatterns',
      'namespaces',
      'candidateSets',
    ]);
  });

  it('leaves timings undefined when compileProject is called directly', () => {
    const model = buildModel(project);
    const compiled = compileProject(model, buildLexicon(model));

    expect(compiled.timings).toBeUndefined();
    expect(compiled.model).toBe(model);
  });

  it('skips generators marked as not completed', () => {
    const compiled = compileConfig(
      config([{ group: 'dust', namespace: 'S:', completed: false, dict: { 'Iron Dust': '铁粉' } }]),
    );

    expect(compiled.topPatterns).toEqual([]);
    expect(compiled.stats.lexEntries).toBe(1);
  });
});
