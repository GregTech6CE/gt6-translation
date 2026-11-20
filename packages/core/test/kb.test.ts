import { describe, expect, it } from 'vitest';
import {
  collectKeyOwners,
  detectUnicodeRisks,
  entityRecordSchema,
  formatAnnotatedZh,
  formatFullEn,
  formatFullZh,
  glossaryRecordSchema,
  materialDerivationsSchema,
  materialRecordSchema,
  parseJsonl,
  parseKnowledgeBase,
  queryKnowledgeBase,
  reconcileMaterialKeys,
  renderMaterialsMarkdown,
  validateKnowledgeBase,
  type EntityRecord,
  type GlossaryRecord,
  type KnowledgeBase,
  type MaterialDerivationsConfig,
  type MaterialRecord,
} from '../src/kb/index.ts';

function material(overrides: Partial<MaterialRecord> & Pick<MaterialRecord, 'id'>): MaterialRecord {
  const base: MaterialRecord = {
    id: overrides.id,
    keys: {},
    en: { canonical: overrides.id },
    zh: { canonical: '测试' },
    category: 'other',
    states: ['solid'],
    origin: { kind: 'real-world', source: '现实', evidence: 'inferred' },
    targets: { gt6ce: 'legacy-only' },
  };
  return { ...base, ...overrides };
}

function glossary(overrides: Partial<GlossaryRecord> & Pick<GlossaryRecord, 'id'>): GlossaryRecord {
  const base: GlossaryRecord = {
    id: overrides.id,
    domain: 'prefix',
    en: { canonical: overrides.id },
    zh: { canonical: '术语' },
  };
  return { ...base, ...overrides };
}

function entity(overrides: Partial<EntityRecord> & Pick<EntityRecord, 'id'>): EntityRecord {
  const base: EntityRecord = {
    id: overrides.id,
    domain: 'block',
    en: { canonical: overrides.id },
    zh: { canonical: '对象' },
  };
  return { ...base, ...overrides };
}

const emptyDerivations: MaterialDerivationsConfig = { version: 1, families: [], internalPlaceholders: [] };

function knowledgeBase(
  materials: MaterialRecord[],
  glossaryRecords: GlossaryRecord[] = [],
  entityRecords: EntityRecord[] = [],
): KnowledgeBase {
  return { materials, glossary: glossaryRecords, entities: entityRecords, derivations: emptyDerivations };
}

describe('kb schema', () => {
  it('接受最小合法记录', () => {
    expect(materialRecordSchema.safeParse(material({ id: 'iron' })).success).toBe(true);
    expect(glossaryRecordSchema.safeParse(glossary({ id: 'prefix-ingot' })).success).toBe(true);
    expect(entityRecordSchema.safeParse(entity({ id: 'hopper' })).success).toBe(true);
  });

  it('拒绝含 <br> 或空白的语言键', () => {
    const withBr = material({ id: 'iron', keys: { gt6: ['gt.material.Iron<br>gt.material.Fe'] } });
    expect(materialRecordSchema.safeParse(withBr).success).toBe(false);
    const withSpace = material({ id: 'iron', keys: { gt6: ['gt.material. Iron'] } });
    expect(materialRecordSchema.safeParse(withSpace).success).toBe(false);
  });

  it('拒绝未知字段与非 kebab-case 的 id', () => {
    expect(materialRecordSchema.safeParse({ ...material({ id: 'iron' }), extra: 1 }).success).toBe(false);
    expect(materialRecordSchema.safeParse(material({ id: 'Iron' })).success).toBe(false);
    expect(entityRecordSchema.safeParse({ ...entity({ id: 'hopper' }), extra: 1 }).success).toBe(false);
  });

  it('composition 可省略，但写了就必须含非空 formula 与 source', () => {
    const { composition: _omitted, ...withoutComposition } = {
      ...material({ id: 'iron' }),
      composition: { formula: 'Fe', source: '现实' },
    };
    expect(materialRecordSchema.safeParse(withoutComposition).success).toBe(true);
    expect(
      materialRecordSchema.safeParse({ ...material({ id: 'iron' }), composition: { formula: 'Fe', source: '现实' } })
        .success,
    ).toBe(true);
    expect(
      materialRecordSchema.safeParse({ ...material({ id: 'iron' }), composition: { formula: '', source: '现实' } })
        .success,
    ).toBe(false);
    expect(materialRecordSchema.safeParse({ ...material({ id: 'iron' }), composition: 'Fe' }).success).toBe(false);
  });

  it('traits 只接受与类别正交的受控词', () => {
    expect(materialRecordSchema.safeParse(material({ id: 'iron', traits: ['metal', 'ore'] })).success).toBe(true);
    expect(materialRecordSchema.safeParse({ ...material({ id: 'iron' }), traits: ['wood'] }).success).toBe(false);
    expect(materialRecordSchema.safeParse({ ...material({ id: 'iron' }), traits: ['removed-in-ce'] }).success).toBe(
      false,
    );
  });

  it('支持 en.suffix / zh.suffix 与 variantOf / seeAlso，且拒绝已移除的 zh.stateNames', () => {
    const dye = material({
      id: 'black',
      en: { canonical: 'Black', suffix: 'Dye' },
      zh: { canonical: '黑色', suffix: '染料' },
      seeAlso: ['void'],
    });
    expect(materialRecordSchema.safeParse(dye).success).toBe(true);
    expect(formatFullEn(dye.en)).toBe('Black (Dye)');
    expect(formatFullZh(dye.zh)).toBe('黑色染料');
    expect(formatAnnotatedZh(dye.zh)).toBe('黑色（染料）');

    const variant = material({ id: 'hydrochloric-acid-gas', variantOf: 'hydrochloric-acid-liquid' });
    expect(materialRecordSchema.safeParse(variant).success).toBe(true);

    expect(
      materialRecordSchema.safeParse({
        ...material({ id: 'hydrochloric-acid' }),
        zh: { canonical: '盐酸', stateNames: { gas: '氯化氢' } },
      }).success,
    ).toBe(false);
  });

  it('zh.legacy 是带 source 与 status 的条目数组', () => {
    const record = material({
      id: 'trinium',
      zh: { canonical: '三元金属', legacy: [{ text: '特林金属', source: 'gt6-lang', status: 'legacy' }] },
    });
    expect(materialRecordSchema.safeParse(record).success).toBe(true);
    expect(
      materialRecordSchema.safeParse({ ...record, zh: { canonical: '三元金属', legacy: '特林金属' } }).success,
    ).toBe(false);
    expect(
      materialRecordSchema.safeParse({
        ...record,
        zh: { canonical: '三元金属', legacy: [{ text: '特林金属', source: 'gt6-lang', status: 'obsolete' }] },
      }).success,
    ).toBe(false);
  });

  it('glossary 与 entities 域严格分离', () => {
    expect(glossaryRecordSchema.safeParse(glossary({ id: 'prefix-ingot', domain: 'prefix' })).success).toBe(true);
    expect(glossaryRecordSchema.safeParse({ ...glossary({ id: 'hopper' }), domain: 'block' }).success).toBe(false);
    expect(
      glossaryRecordSchema.safeParse({ ...glossary({ id: 'prefix-ingot' }), authorityNote: '旧字段' }).success,
    ).toBe(false);
    expect(
      glossaryRecordSchema.safeParse({ ...glossary({ id: 'prefix-ingot' }), collisionGroup: '旧字段' }).success,
    ).toBe(false);
    expect(glossaryRecordSchema.safeParse({ ...glossary({ id: 'prefix-ingot' }), seeAlso: ['hopper'] }).success).toBe(
      true,
    );

    expect(entityRecordSchema.safeParse(entity({ id: 'hopper', domain: 'block' })).success).toBe(true);
    expect(entityRecordSchema.safeParse({ ...entity({ id: 'prefix-ingot' }), domain: 'prefix' }).success).toBe(false);
  });

  it('派生配置 schema 可用且拒绝未知族类型与重复元素', () => {
    const config: MaterialDerivationsConfig = {
      version: 1,
      families: [
        {
          id: 'antimatter',
          kind: 'derived',
          description: '反物质镜像',
          template: { en: 'Anti{base}', zh: '反{base}' },
          keyPatterns: ['^gt\\.material\\.Anti[A-Z]'],
        },
      ],
      internalPlaceholders: [{ keys: ['gt.material.NULL'], reason: '占位' }],
    };
    expect(materialDerivationsSchema.safeParse(config).success).toBe(true);
    expect(materialDerivationsSchema.safeParse({ ...config, version: 2 }).success).toBe(false);
    expect(
      materialDerivationsSchema.safeParse({ ...config, families: [{ ...config.families[0], kind: 'exact' }] }).success,
    ).toBe(false);
    expect(materialRecordSchema.safeParse({ ...material({ id: 'iron' }), states: ['solid', 'solid'] }).success).toBe(
      false,
    );
    expect(materialRecordSchema.safeParse({ ...material({ id: 'iron' }), traits: ['metal', 'metal'] }).success).toBe(
      false,
    );
    expect(
      materialRecordSchema.safeParse({ ...material({ id: 'iron' }), en: { canonical: 'Iron', aliases: ['Fe', 'Fe'] } })
        .success,
    ).toBe(false);
  });
});

describe('kb loader', () => {
  it('逐行解析并报告坏行行号', () => {
    const text = `${JSON.stringify(material({ id: 'a' }))}\n\nnot-json\n${JSON.stringify(material({ id: 'b' }))}\n`;
    const parsed = parseJsonl(text, materialRecordSchema, 'materials.jsonl');
    expect(parsed.records.map((record) => record.id)).toEqual(['a', 'b']);
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0]?.line).toBe(3);
  });

  it('四个文件都能解析时返回完整知识库', () => {
    const parsed = parseKnowledgeBase({
      materials: `${JSON.stringify(material({ id: 'iron' }))}\n`,
      glossary: `${JSON.stringify(glossary({ id: 'prefix-ingot' }))}\n`,
      entities: `${JSON.stringify(entity({ id: 'hopper' }))}\n`,
      derivations: JSON.stringify(emptyDerivations),
    });
    expect(parsed.issues).toHaveLength(0);
    expect(parsed.knowledgeBase?.materials).toHaveLength(1);
    expect(parsed.knowledgeBase?.glossary).toHaveLength(1);
    expect(parsed.knowledgeBase?.entities).toHaveLength(1);
    expect(parsed.knowledgeBase?.derivations.families).toHaveLength(0);
  });

  it('支持可选的 entity-derivations.json 并参与校验', () => {
    const parsed = parseKnowledgeBase({
      materials: `${JSON.stringify(material({ id: 'iron' }))}\n`,
      glossary: `${JSON.stringify(glossary({ id: 'prefix-ingot' }))}\n`,
      entities: `${JSON.stringify(entity({ id: 'hopper', domain: 'storage' }))}\n`,
      derivations: JSON.stringify(emptyDerivations),
      entityDerivations: JSON.stringify({
        version: 1,
        families: [
          {
            id: 'mte-chest',
            kind: 'derived',
            description: 'chest variants',
            keyPatterns: ['^gt\\.multitileentity\\.\\d+$'],
          },
        ],
        internalPlaceholders: [],
      }),
    });
    expect(parsed.issues).toHaveLength(0);
    expect(parsed.knowledgeBase?.entityDerivations?.families).toHaveLength(1);
    const report = validateKnowledgeBase(
      parsed.knowledgeBase!.materials,
      parsed.knowledgeBase!.glossary,
      parsed.knowledgeBase!.entities,
      parsed.knowledgeBase!.derivations,
      parsed.knowledgeBase!.entityDerivations,
    );
    expect(report.ok).toBe(true);
    expect(report.stats.families).toBe(1);
  });

  it('任一文件结构错误时不返回半成品', () => {
    const parsed = parseKnowledgeBase({
      materials: `${JSON.stringify(material({ id: 'iron' }))}\n`,
      glossary: '',
      entities: '',
      derivations: '{}',
    });
    expect(parsed.knowledgeBase).toBeUndefined();
    expect(parsed.issues.length).toBeGreaterThan(0);
  });
});

describe('kb validate', () => {
  it('干净知识库通过', () => {
    const report = validateKnowledgeBase(
      [material({ id: 'iron', keys: { gt6: ['gt.material.Iron'] } })],
      [glossary({ id: 'prefix-ingot' })],
      [entity({ id: 'hopper', keys: { gt6: ['gt.block.hopper'] } })],
      emptyDerivations,
    );
    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.stats.materials).toBe(1);
    expect(report.stats.glossary).toBe(1);
    expect(report.stats.entities).toBe(1);
    expect(report.stats.materialKeys).toBe(1);
    expect(report.stats.entityKeys).toBe(1);
  });

  it('id 重复与键重复报错', () => {
    const report = validateKnowledgeBase(
      [
        material({ id: 'iron', keys: { gt6: ['gt.material.Iron'] } }),
        material({ id: 'iron', keys: { gt6: ['gt.material.Iron'] } }),
      ],
      [],
      [],
      emptyDerivations,
    );
    expect(report.ok).toBe(false);
    expect(report.errors.map((error) => error.code)).toContain('id.duplicate');
  });

  it('材料、术语、对象三表跨表共用键报 key.duplicate', () => {
    const report = validateKnowledgeBase(
      [material({ id: 'iron', keys: { gt6: ['gt.material.Iron'] } })],
      [glossary({ id: 'iron-term', keys: { gt6: ['gt.material.Iron'] } })],
      [entity({ id: 'iron-entity', keys: { gt6: ['gt.material.Iron'] } })],
      emptyDerivations,
    );
    expect(report.ok).toBe(false);
    expect(report.errors.filter((error) => error.code === 'key.duplicate')).toHaveLength(2);
  });

  it('反循环出处门禁：origin.urls 不得含 MT.java', () => {
    const report = validateKnowledgeBase(
      [
        material({
          id: 'iron',
          origin: {
            kind: 'real-world',
            source: '现实',
            evidence: 'verified',
            urls: ['https://github.com/GregTech6/gregtech6/blob/master/src/main/java/gregapi/data/MT.java'],
          },
        }),
      ],
      [],
      [],
      emptyDerivations,
    );
    expect(report.ok).toBe(false);
    expect(report.errors[0]?.code).toBe('origin.mt-ref');
  });

  it('中文撞车未登记时报错，登记 allowSameZhReason 后通过', () => {
    const first = material({ id: 'nikoline-alloy', zh: { canonical: '蓝石合金' } });
    const second = material({ id: 'electrotine-alloy', zh: { canonical: '蓝石合金' } });
    const failing = validateKnowledgeBase([first, second], [], [], emptyDerivations);
    expect(failing.ok).toBe(false);
    expect(failing.errors.map((error) => error.code)).toEqual(['zh.collision', 'zh.collision']);

    const allowed = validateKnowledgeBase(
      [
        { ...first, allowSameZhReason: '同一 Nikolite 系合金，历史合用' },
        { ...second, allowSameZhReason: '同一 Nikolite 系合金，历史合用' },
      ],
      [],
      [],
      emptyDerivations,
    );
    expect(allowed.ok).toBe(true);
  });

  it('材料、术语与对象跨表中文撞车未登记报错，双向登记后通过', () => {
    const clusterMat = material({ id: 'cluster', zh: { canonical: '矿簇' } });
    const clusterTerm = glossary({ id: 'prefix-cluster', zh: { canonical: '矿簇' } });
    const clusterEntity = entity({ id: 'entity-cluster', zh: { canonical: '矿簇' } });
    const failing = validateKnowledgeBase([clusterMat], [clusterTerm], [clusterEntity], emptyDerivations);
    expect(failing.ok).toBe(false);
    expect(failing.errors.map((error) => error.code)).toEqual(['zh.collision', 'zh.collision', 'zh.collision']);

    const allowed = validateKnowledgeBase(
      [{ ...clusterMat, allowSameZhReason: '三表同名允许' }],
      [{ ...clusterTerm, allowSameZhReason: '三表同名允许' }],
      [{ ...clusterEntity, allowSameZhReason: '三表同名允许' }],
      emptyDerivations,
    );
    expect(allowed.ok).toBe(true);
  });

  it('不同 en.suffix 消歧后不再报 en.duplicate', () => {
    const report = validateKnowledgeBase(
      [
        material({ id: 'mercury', en: { canonical: 'Mercury' }, zh: { canonical: '汞' } }),
        material({
          id: 'mercury-rock',
          en: { canonical: 'Mercury', suffix: 'Rock' },
          zh: { canonical: '水星岩' },
        }),
      ],
      [],
      [],
      emptyDerivations,
    );
    expect(report.ok).toBe(true);
    expect(report.warnings.map((warning) => warning.code)).not.toContain('en.duplicate');
  });

  it('规范译名与 zh.suffix 含顿号或占位元信息报错', () => {
    const report = validateKnowledgeBase(
      [material({ id: 'foo', zh: { canonical: '甲、乙' } })],
      [],
      [],
      emptyDerivations,
    );
    expect(report.ok).toBe(false);
    expect(report.errors[0]?.code).toBe('zh.forbidden-separator');

    const suffixReport = validateKnowledgeBase(
      [material({ id: 'bar', zh: { canonical: '丙', suffix: '丁、戊' } })],
      [],
      [],
      emptyDerivations,
    );
    expect(suffixReport.ok).toBe(false);
    expect(suffixReport.errors[0]?.code).toBe('zh.forbidden-separator');

    const placeholderReport = validateKnowledgeBase(
      [material({ id: 'hsla', zh: { canonical: '未译（建议：HSLA钢）' } })],
      [],
      [],
      emptyDerivations,
    );
    expect(placeholderReport.ok).toBe(false);
    expect(placeholderReport.errors[0]?.code).toBe('zh.placeholder-meta');

    const suffixPlaceholder = validateKnowledgeBase(
      [material({ id: 'baz', zh: { canonical: '丙', suffix: '未译' } })],
      [],
      [],
      emptyDerivations,
    );
    expect(suffixPlaceholder.ok).toBe(false);
    expect(suffixPlaceholder.errors[0]?.code).toBe('zh.placeholder-meta');
  });

  it('variantOf 校验自引用、悬空引用，且有效变体可跳过 parity.missing-ce-key', () => {
    const base = material({
      id: 'hydrochloric-acid-liquid',
      keys: { gt6: ['gt.material.HydrochloricAcid'], gt6ce: ['material.gt6ce.hydrochloric_acid'] },
      en: { canonical: 'Hydrochloric Acid', suffix: 'Liquid' },
      zh: { canonical: '盐酸' },
      targets: { gt6ce: 'active' },
    });
    const gas = material({
      id: 'hydrochloric-acid-gas',
      variantOf: 'hydrochloric-acid-liquid',
      en: { canonical: 'Hydrochloric Acid', suffix: 'Gas' },
      zh: { canonical: '氯化氢' },
      targets: { gt6ce: 'active' },
    });
    const okReport = validateKnowledgeBase([base, gas], [], [], emptyDerivations);
    expect(okReport.ok).toBe(true);
    expect(okReport.warnings.map((warning) => warning.code)).not.toContain('parity.missing-ce-key');

    const selfReport = validateKnowledgeBase([material({ id: 'loop', variantOf: 'loop' })], [], [], emptyDerivations);
    expect(selfReport.ok).toBe(false);
    expect(selfReport.errors.map((error) => error.code)).toContain('material.self-variant');

    const danglingReport = validateKnowledgeBase(
      [material({ id: 'orphan', variantOf: 'missing-id' })],
      [],
      [],
      emptyDerivations,
    );
    expect(danglingReport.ok).toBe(false);
    expect(danglingReport.errors.map((error) => error.code)).toContain('material.dangling-variant');
  });

  it('targets.gt6ce 与 gt6ce 键必须自洽', () => {
    const report = validateKnowledgeBase(
      [material({ id: 'iron', targets: { gt6ce: 'removed' }, keys: { gt6ce: ['material.gt6ce.iron'] } })],
      [],
      [],
      emptyDerivations,
    );
    expect(report.ok).toBe(false);
    expect(report.errors.map((error) => error.code)).toContain('parity.removed-with-key');
  });

  it('无法编译的派生族正则报错', () => {
    const report = validateKnowledgeBase([], [], [], {
      version: 1,
      families: [{ id: 'bad', kind: 'derived', description: '坏正则', keyPatterns: ['('] }],
      internalPlaceholders: [],
    });
    expect(report.ok).toBe(false);
    expect(report.errors[0]?.code).toBe('derivation.bad-regex');
  });

  it('不再为推断出处缺少链接报警，只统计证据分布', () => {
    const report = validateKnowledgeBase(
      [
        material({
          id: 'a',
          zh: { canonical: '甲' },
          origin: { kind: 'mod', source: 'SomeMod', evidence: 'inferred' },
        }),
        material({ id: 'b', zh: { canonical: '乙' }, origin: { kind: 'gt6', source: 'GT6', evidence: 'verified' } }),
        material({
          id: 'c',
          zh: { canonical: '丙' },
          origin: { kind: 'unknown', source: '未知', evidence: 'unknown' },
        }),
      ],
      [],
      [],
      emptyDerivations,
    );
    expect(report.ok).toBe(true);
    expect(report.warnings.map((warning) => warning.code)).not.toContain('origin.no-url');
    expect(report.warnings.map((warning) => warning.code)).not.toContain('origin.verified-no-url');
    expect(report.stats.evidence).toEqual({ verified: 1, inferred: 1, unknown: 1 });
  });

  it('verified 但无链接且非 GT6 自创时仍给 origin.verified-no-url warning', () => {
    const report = validateKnowledgeBase(
      [material({ id: 'a', origin: { kind: 'fiction', source: 'Star Trek', evidence: 'verified' } })],
      [],
      [],
      emptyDerivations,
    );
    expect(report.ok).toBe(true);
    expect(report.warnings.map((warning) => warning.code)).toContain('origin.verified-no-url');
  });

  it('zh.legacy 与规范译名或完整中文名相同时给出 zh.legacy-matches-canonical warning', () => {
    const report = validateKnowledgeBase(
      [
        material({
          id: 'magnetite',
          zh: {
            canonical: '磁铁',
            suffix: '矿',
            legacy: [{ text: '磁铁矿', source: 'docs-materials', status: 'proposed' }],
          },
        }),
      ],
      [],
      [],
      emptyDerivations,
    );
    expect(report.ok).toBe(true);
    expect(
      report.warnings.some((entry) => entry.code === 'zh.legacy-matches-canonical' && entry.subject === 'magnetite'),
    ).toBe(true);
  });

  it('seeAlso 可跨三张表互引，指向不存在 id 时给 kb.dangling-see-also warning', () => {
    const okReport = validateKnowledgeBase(
      [material({ id: 'mercury', zh: { canonical: '汞' }, seeAlso: ['hopper'] })],
      [glossary({ id: 'prefix-ingot', zh: { canonical: '锭' }, seeAlso: ['mercury'] })],
      [entity({ id: 'hopper', zh: { canonical: '料斗' }, seeAlso: ['prefix-ingot'] })],
      emptyDerivations,
    );
    expect(okReport.ok).toBe(true);
    expect(okReport.warnings.map((warning) => warning.code)).not.toContain('kb.dangling-see-also');

    const dangling = validateKnowledgeBase(
      [],
      [glossary({ id: 'prefix-ingot', seeAlso: ['missing-target-id'] })],
      [],
      emptyDerivations,
    );
    expect(dangling.ok).toBe(true);
    expect(
      dangling.warnings.some((entry) => entry.code === 'kb.dangling-see-also' && entry.subject === 'prefix-ingot'),
    ).toBe(true);
  });

  it('composition 含未知占位或 notes 含也见于时报告对应问题', () => {
    const report = validateKnowledgeBase(
      [
        material({
          id: 'ardite',
          composition: { formula: '未知（GT6 元素符号 Ar）', source: 'GT6' },
          notes: '也见于：GT6',
        }),
      ],
      [],
      [],
      emptyDerivations,
    );
    expect(report.ok).toBe(false);
    expect(report.errors.map((entry) => entry.code)).toContain('composition.unknown');
    expect(report.warnings.map((entry) => entry.code)).toContain('notes.also-in');
  });
});

describe('kb reconcile', () => {
  const derivations: MaterialDerivationsConfig = {
    version: 1,
    families: [
      { id: 'antimatter', kind: 'derived', description: '反物质镜像', keyPatterns: ['^gt\\.material\\.Anti[A-Z]'] },
    ],
    internalPlaceholders: [{ keys: ['gt.material.NULL'], reason: '占位' }],
  };

  it('把目标键 100% 分类为材料/术语/对象/派生/占位/未解释', () => {
    const materials = [material({ id: 'iron', keys: { gt6: ['gt.material.Iron'] } })];
    const terms = [glossary({ id: 'prefix-ingot', keys: { gt6: ['gt.material.IngotTerm'] } })];
    const entities = [entity({ id: 'hopper', keys: { gt6: ['gt.material.HopperEntity'] } })];
    const report = reconcileMaterialKeys(
      materials,
      terms,
      entities,
      derivations,
      [
        'gt.material.Iron',
        'gt.material.IngotTerm',
        'gt.material.HopperEntity',
        'gt.material.AntiIron',
        'gt.material.NULL',
        'gt.material.Mystery',
      ],
      'gt6',
    );
    expect(report.counts).toEqual({
      total: 6,
      coveredByMaterials: 1,
      coveredByGlossary: 1,
      coveredByEntities: 1,
      derived: 1,
      internalPlaceholders: 1,
      unaccounted: 1,
      duplicatedKeys: 0,
    });
    expect(report.derivedByFamily).toEqual({ antimatter: 1 });
    expect(report.unaccounted).toEqual(['gt.material.Mystery']);
  });

  it('重复键只统计一次并报告归属冲突', () => {
    const materials = [
      material({ id: 'iron', keys: { gt6: ['gt.material.Iron'] } }),
      material({ id: 'iron-dupe', keys: { gt6: ['gt.material.Iron'] } }),
    ];
    const report = reconcileMaterialKeys(
      materials,
      [],
      [],
      emptyDerivations,
      ['gt.material.Iron', 'gt.material.Iron'],
      'gt6',
    );
    expect(report.counts.total).toBe(1);
    expect(report.duplicatedKeys).toEqual(['gt.material.Iron']);
  });

  it('跨表重复键也报告 duplicatedKeys 归属冲突', () => {
    const materials = [material({ id: 'iron', keys: { gt6: ['gt.material.Iron'] } })];
    const entities = [entity({ id: 'iron-entity', keys: { gt6: ['gt.material.Iron'] } })];
    const report = reconcileMaterialKeys(materials, [], entities, emptyDerivations, ['gt.material.Iron'], 'gt6');
    expect(report.duplicatedKeys).toEqual(['gt.material.Iron']);
    expect(report.counts.duplicatedKeys).toBe(1);
  });

  it('同一条记录在两个命名空间写同一个键不算重复归属', () => {
    const terms = [
      glossary({ id: 'prefix-billet', keys: { gt6: ['oredict.prefix.billet'], gt6ce: ['oredict.prefix.billet'] } }),
    ];
    const report = reconcileMaterialKeys([], terms, [], emptyDerivations, ['oredict.prefix.billet'], 'prefix');
    expect(report.counts.coveredByGlossary).toBe(1);
    expect(report.duplicatedKeys).toEqual([]);
    expect(collectKeyOwners(terms, 'glossary').get('oredict.prefix.billet')).toEqual(['glossary:prefix-billet']);
  });
});

describe('kb query', () => {
  const kb = knowledgeBase(
    [
      material({
        id: 'trinium',
        keys: { gt6: ['gt.material.Trinium'], gt6ce: ['material.gt6ce.trinium'] },
        en: { canonical: 'Trinium', aliases: ['Ke'] },
        zh: { canonical: '三元金属', legacy: [{ text: '特林金属', source: 'gt6-lang', status: 'legacy' }] },
      }),
      material({
        id: 'black',
        en: { canonical: 'Black', suffix: 'Dye' },
        zh: { canonical: '黑色', suffix: '染料' },
      }),
    ],
    [glossary({ id: 'prefix-ingot', en: { canonical: 'Ingot' }, zh: { canonical: '锭' } })],
    [entity({ id: 'hopper', en: { canonical: 'Hopper' }, zh: { canonical: '料斗' } })],
  );

  it('按 id、中文、英文别名、后缀组合与语言键命中', () => {
    expect(queryKnowledgeBase(kb, 'trinium')[0]?.id).toBe('trinium');
    expect(queryKnowledgeBase(kb, '三元金属')[0]?.matchedOn).toBe('zh.canonical');
    expect(queryKnowledgeBase(kb, 'Ke')[0]?.id).toBe('trinium');
    expect(queryKnowledgeBase(kb, 'gt.material.Trinium')[0]?.matchedOn).toBe('keys.gt6');
    expect(queryKnowledgeBase(kb, '特林金属')[0]?.matchedOn).toBe('zh.legacy');
    expect(queryKnowledgeBase(kb, '黑色染料')[0]?.id).toBe('black');
    expect(queryKnowledgeBase(kb, 'hopper')[0]?.kind).toBe('entity');
  });

  it('可限定域与条数', () => {
    expect(queryKnowledgeBase(kb, 'hopper', { domain: 'material' })).toHaveLength(0);
    expect(queryKnowledgeBase(kb, 'hopper', { domain: 'glossary' })).toHaveLength(0);
    expect(queryKnowledgeBase(kb, 'hopper', { domain: 'entity' })[0]?.kind).toBe('entity');
    expect(queryKnowledgeBase(kb, 'ingot', { domain: 'glossary' })[0]?.kind).toBe('glossary');
    expect(queryKnowledgeBase(kb, 'i', { limit: 1 })).toHaveLength(1);
  });

  it('空查询不返回结果', () => {
    expect(queryKnowledgeBase(kb, '   ')).toEqual([]);
  });
});

describe('kb render-md', () => {
  const derivations: MaterialDerivationsConfig = {
    version: 1,
    families: [
      {
        id: 'antimatter',
        kind: 'derived',
        description: '反物质镜像',
        template: { en: 'Anti{base}', zh: '反{base}' },
        keyPatterns: ['^gt\\.material\\.Anti[A-Z]'],
      },
    ],
    internalPlaceholders: [{ keys: ['gt.material.NULL'], reason: '内部占位' }],
  };

  const kb: KnowledgeBase = {
    materials: [
      material({
        id: 'iron',
        keys: { gt6: ['gt.material.Iron', 'gt.material.Fe'] },
        en: { canonical: 'Iron' },
        zh: { canonical: '铁' },
        category: 'element',
        origin: {
          kind: 'real-world',
          source: '现实',
          evidence: 'verified',
          urls: ['https://example.org/iron'],
        },
        targets: { gt6ce: 'active', mtRef: 'https://example.org/MT.java' },
        notes: '现实元素；含 | 竖线',
      }),
      material({
        id: 'teslatite',
        en: { canonical: 'Teslatite' },
        zh: { canonical: '特斯拉石' },
        category: 'gem',
        origin: { kind: 'mod', source: 'BluePower', evidence: 'inferred' },
      }),
      material({
        id: 'black',
        en: { canonical: 'Black', suffix: 'Dye' },
        zh: { canonical: '黑色', suffix: '染料' },
        origin: { kind: 'unknown', source: '未知', evidence: 'unknown' },
      }),
    ],
    glossary: [glossary({ id: 'prefix-ingot', domain: 'prefix', en: { canonical: 'Ingot' }, zh: { canonical: '锭' } })],
    entities: [entity({ id: 'hopper', domain: 'block', en: { canonical: 'Hopper' }, zh: { canonical: '料斗' } })],
    derivations,
  };

  it('渲染确定性：两次结果完全一致', () => {
    expect(renderMaterialsMarkdown(kb)).toEqual(renderMaterialsMarkdown(kb));
  });

  it('生成五个视图且不使用 <br> 合并多键', () => {
    const docs = renderMaterialsMarkdown(kb);
    expect(Object.keys(docs).sort()).toEqual([
      'derivations.md',
      'entities.md',
      'glossary.md',
      'index.md',
      'materials.md',
    ]);
    for (const content of Object.values(docs)) {
      expect(content).not.toContain('<br>');
    }
    expect(docs['materials.md']).toContain('`gt.material.Iron` `gt.material.Fe`');
    expect(docs['materials.md']).toContain('Black (Dye)');
    expect(docs['materials.md']).toContain('黑色（染料）');
    expect(docs['materials.md']).toContain('\\|');
  });

  it('头部标明自动生成与单一事实源', () => {
    const docs = renderMaterialsMarkdown(kb);
    expect(docs['index.md']).toContain('knowledge/{materials,glossary,entities}.jsonl');
    expect(docs['index.md']).toContain('kb render-md');
    expect(docs['materials.md']).toContain('自动生成');
  });

  it('按类别分节并统计条目数', () => {
    const docs = renderMaterialsMarkdown(kb);
    expect(docs['materials.md']).toContain('## 元素（1）');
    expect(docs['materials.md']).toContain('## 宝石（1）');
    expect(docs['materials.md']).toContain('## 其他（1）');
    expect(docs['index.md']).toContain('| 元素 | 1 |');
  });

  it('术语与对象各自按域分节，派生族与占位键单独成表', () => {
    const docs = renderMaterialsMarkdown(kb);
    expect(docs['glossary.md']).toContain('## 形态前缀（1）');
    expect(docs['entities.md']).toContain('## 独立方块（1）');
    expect(docs['derivations.md']).toContain('### antimatter');
    expect(docs['derivations.md']).toContain('`Anti{base}` → `反{base}`');
    expect(docs['derivations.md']).toContain('`gt.material.NULL`');
  });

  it('每条材料只出现在一个类别分节里', () => {
    const docs = renderMaterialsMarkdown(kb);
    const count = (needle: string): number => docs['materials.md'].split(needle).length - 1;
    expect(count('| Iron |')).toBe(1);
    expect(count('| Black (Dye) |')).toBe(1);
  });
});

describe('kb unicode risk', () => {
  it('识别非 BMP、BMP 新增汉字区与 CJK 扩展 A 风险字符', () => {
    expect(detectUnicodeRisks('铁与汞')).toEqual([]);

    const bmpNew = detectUnicodeRisks('鿬');
    expect(bmpNew).toHaveLength(1);
    expect(bmpNew[0]?.codePoint).toBe('U+9FEC');
    expect(bmpNew[0]?.level).toBe('high');

    const smp = detectUnicodeRisks('𬭛');
    expect(smp).toHaveLength(1);
    expect(smp[0]?.codePoint).toBe('U+2CB5B');
    expect(smp[0]?.level).toBe('high');

    const extA = detectUnicodeRisks('䥑');
    expect(extA).toHaveLength(1);
    expect(extA[0]?.codePoint).toBe('U+4951');
    expect(extA[0]?.level).toBe('medium');
  });
});
