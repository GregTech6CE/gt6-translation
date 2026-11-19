import { describe, expect, it } from 'vitest';
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

describe('buildLexicon', () => {
  it('indexes dict entries by first and last token', () => {
    const model = buildModel(
      config([{ group: 'dust', namespace: 'S:', dict: { 'Iron Dust': '铁粉', 'Gold Dust': '金粉' } }]),
    );
    const lexicon = buildLexicon(model);
    const groupId = model.gidOf.get('dust')!;

    expect(lexicon.totalEntries).toBe(2);
    expect(lexicon.hasGroupEntries(groupId)).toBe(true);
    expect(lexicon.firstTokens(groupId).sort()).toEqual(['Gold', 'Iron']);
    expect([...lexicon.last.get(groupId)!]).toEqual(['Dust']);
    expect(lexicon.byFirst.get(groupId)?.get('Iron')?.[0]).toMatchObject({
      terms: ['Iron', 'Dust'],
      target: '铁粉',
      namespace: 'S:',
    });
  });

  it('expands affix rules into concrete entries instead of rule metas', () => {
    const model = buildModel(
      config([
        { group: 'material', namespace: 'S:', dict: { Abyssalnite: '深渊' } },
        { group: 'crush', namespace: 'S:', rules: [{ s: '{0}Crush', t: '{0}粉碎', subs: ['material'] }] },
      ]),
    );
    const lexicon = buildLexicon(model);
    const crushId = model.gidOf.get('crush')!;

    expect(lexicon.groupRuleMetas.get(crushId)).toEqual([]);
    expect(lexicon.byFirst.get(crushId)?.get('AbyssalniteCrush')?.[0]).toMatchObject({
      terms: ['AbyssalniteCrush'],
      target: '深渊粉碎',
      namespace: 'S:',
    });
  });

  it('records rule metas for non-affix rules', () => {
    const model = buildModel(
      config([
        { group: 'dust', namespace: 'S:', dict: { 'Iron Dust': '铁粉', 'Gold Dust': '金粉' } },
        { group: 'crate', namespace: 'S:', rules: [{ s: 'Crate of {0}', t: '{0}板条箱', subs: ['dust'] }] },
      ]),
    );
    const lexicon = buildLexicon(model);
    const crateId = model.gidOf.get('crate')!;
    const metas = lexicon.groupRuleMetas.get(crateId)!;
    const dustId = model.gidOf.get('dust')!;

    expect(metas).toHaveLength(1);
    expect(metas[0]).toMatchObject({
      groupId: crateId,
      rule: 0,
      subs: [dustId],
      subSizes: [2],
      slotOrder: [0],
      slotCount: 1,
      count: 2,
      base: 0,
    });
    expect(lexicon.ruleMetaByKey.get(`${metas[0]!.generatorId}:0`)).toBe(metas[0]);
    expect(lexicon.hasGeneratorEntries(crateId, metas[0]!.generatorId)).toBe(false);
    expect(lexicon.hasGeneratorEntries(dustId, model.gens[0]!.id)).toBe(true);
  });

  it('skips rules whose subs cannot be resolved', () => {
    const model = buildModel(
      config([{ group: 'crate', namespace: 'S:', rules: [{ s: 'Crate of {0}', t: '{0}板条箱', subs: ['ghost'] }] }]),
    );
    const lexicon = buildLexicon(model);
    const crateId = model.gidOf.get('crate')!;

    expect(lexicon.groupRuleMetas.get(crateId)).toEqual([]);
    expect(lexicon.totalEntries).toBe(0);
  });
});
