import { describe, expect, it } from 'vitest';
import { buildModel, combineNamespaces, compileTemplate, isBetterOrder } from '../src/engine/model';
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

describe('template helpers', () => {
  it('splits placeholders into literal and slot parts', () => {
    expect(compileTemplate('{0} Dust')).toEqual([0, ' Dust']);
    expect(compileTemplate('{0}Crush{1}')).toEqual([0, 'Crush', 1]);
    expect(compileTemplate('{0}{1}')).toEqual([0, 1]);
    expect(compileTemplate('plain text')).toEqual(['plain text']);
  });

  it('combines namespaces only when one is a prefix of the other', () => {
    expect(combineNamespaces('', 'S:')).toBe('S:');
    expect(combineNamespaces('S:', '')).toBe('S:');
    expect(combineNamespaces('S:', 'S:T:')).toBe('S:T:');
    expect(combineNamespaces('S:T:', 'S:')).toBe('S:T:');
    expect(combineNamespaces('S:', 'T:')).toBeNull();
  });

  it('orders candidates by generator, rule, then combo', () => {
    expect(isBetterOrder({ gen: 1, ri: 0, combo: 0 }, { gen: 0, ri: 9, combo: 9 })).toBe(true);
    expect(isBetterOrder({ gen: 0, ri: 1, combo: 0 }, { gen: 0, ri: 0, combo: 9 })).toBe(true);
    expect(isBetterOrder({ gen: 0, ri: 0, combo: 2 }, { gen: 0, ri: 0, combo: 1 })).toBe(true);
    expect(isBetterOrder({ gen: 0, ri: 0, combo: 1 }, { gen: 0, ri: 0, combo: 1 })).toBe(false);
  });
});

describe('buildModel', () => {
  it('creates one generator per dict pair and per nested namespace', () => {
    const model = buildModel(
      config([
        {
          group: 'dust',
          namespace: 'S:',
          dict: { 'Iron Dust': '铁粉', 'Gold Dust': { 'T:': '金粉T', 'S:': '金粉S' } },
        },
      ]),
    );

    expect(model.gens.map((generator) => generator.kind)).toEqual(['dict', 'dict', 'dict']);
    expect(model.gens.map((generator) => generator.namespace)).toEqual(['S:', 'T:', 'S:']);
    expect(model.groupArr).toEqual(['dust']);
    expect(model.groupSize('dust')).toBe(3);
    expect(model.resolveGroup('dust').map((entry) => [entry.s, entry.t])).toEqual([
      ['Iron Dust', '铁粉'],
      ['Gold Dust', '金粉T'],
      ['Gold Dust', '金粉S'],
    ]);
  });

  it('expands rule groups as a cross product of their subs', () => {
    const model = buildModel(
      config([
        { group: 'dust', namespace: 'S:', dict: { 'Iron Dust': '铁粉', 'Gold Dust': '金粉' } },
        { group: 'crate', namespace: 'S:', rules: [{ s: 'Crate of {0}', t: '{0}板条箱', subs: ['dust'] }] },
      ]),
    );

    expect(model.groupSize('dust')).toBe(2);
    expect(model.groupSize('crate')).toBe(2);
    expect(model.resolveGroup('crate').map((entry) => [entry.s, entry.t, entry.ns])).toEqual([
      ['Crate of Iron Dust', '铁粉板条箱', 'S:'],
      ['Crate of Gold Dust', '金粉板条箱', 'S:'],
    ]);
  });

  it('drops combinations whose namespaces cannot be combined', () => {
    const model = buildModel(
      config([
        { group: 'dust', namespace: 'S:', dict: { 'Gold Dust': { 'T:': '金粉T' } } },
        { group: 'crate', namespace: 'S:', rules: [{ s: 'Crate of {0}', t: '{0}板条箱', subs: ['dust'] }] },
      ]),
    );

    expect(model.groupSize('dust')).toBe(1);
    expect(model.resolveGroup('crate')).toEqual([]);
  });

  it('honours completed=false and keeps generator order from the config keys', () => {
    const model = buildModel(
      config([
        { group: 'dust', namespace: 'S:', completed: false, dict: { 'Iron Dust': '铁粉' } },
        { group: 'crate', namespace: 'S:', rules: [{ s: 'Crate of {0}', t: '{0}板条箱', subs: ['dust'] }] },
      ]),
    );

    expect(model.gens[0]).toMatchObject({ group: 'dust', completed: false, kind: 'dict' });
    expect(model.gens[1]).toMatchObject({ group: 'crate', completed: true, kind: 'rule' });
  });
});
