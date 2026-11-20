import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { convertLegacyYamlToProject } from '../src/config/legacyYaml';
import {
  assertArtifactWritable,
  artifactRoot,
  legacyGoldenRoot,
  legacyRoot,
  repoRelative,
  repoRoot,
  resolveCorpusPath,
  resolveGoldenFile,
  resolveInsideRepo,
  resolveRepoRoot,
} from '../src/paths';

describe('仓库根与路径守卫', () => {
  it('默认从 rush.json 向上定位仓库根', () => {
    assert.equal(resolveRepoRoot(), repoRoot);
    assert.ok(existsSync(join(repoRoot, 'rush.json')));
  });

  it('GT6TG_REPO_ROOT 优先于向上查找', () => {
    const previous = process.env.GT6TG_REPO_ROOT;
    process.env.GT6TG_REPO_ROOT = legacyRoot;
    try {
      assert.equal(resolveRepoRoot(), legacyRoot);
    } finally {
      if (previous === undefined) delete process.env.GT6TG_REPO_ROOT;
      else process.env.GT6TG_REPO_ROOT = previous;
    }
  });

  it('找不到 rush.json 时抛出明确错误', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gt6tg-root-'));
    try {
      assert.throws(() => resolveRepoRoot(dir), /rush\.json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('拒绝越出仓库根的路径', () => {
    assert.throws(() => resolveInsideRepo('../../etc/passwd'), /路径越出仓库根目录/);
  });

  it('repoRelative 统一使用正斜杠', () => {
    assert.equal(repoRelative(join(repoRoot, 'packages/node/project.jsonc')), 'packages/node/project.jsonc');
  });

  it('assertArtifactWritable 仅放行 packages/node/dist 内路径', () => {
    assert.doesNotThrow(() => assertArtifactWritable(join(artifactRoot, 'materials/index.md')));
    assert.throws(() => assertArtifactWritable(join(repoRoot, 'docs/materials')), /只能写入 packages\/node\/dist/);
    assert.throws(() => assertArtifactWritable(join(legacyRoot, 'workplace')), /禁止写入 legacy/);
  });
});

describe('语料路径解析', () => {
  const workplace = join(repoRoot, 'packages/legacy/workplace');

  it('fixtures/ 开头的路径按仓库根解析', () => {
    assert.equal(
      resolveCorpusPath(workplace, 'fixtures/legacy-golden/manifest.json'),
      join(legacyGoldenRoot, 'manifest.json'),
    );
  });

  it('其余路径按 workplace 解析', () => {
    assert.equal(resolveCorpusPath(workplace, 'en/GregTech.lang'), join(workplace, 'en/GregTech.lang'));
    assert.equal(
      resolveCorpusPath(workplace, 'zh/GregTech.fallback.lang'),
      join(workplace, 'zh/GregTech.fallback.lang'),
    );
  });

  it('workplace 产物存在时优先于明文基线', () => {
    assert.equal(resolveGoldenFile(workplace, 'en/GregTech.lang'), join(workplace, 'en/GregTech.lang'));
  });

  it('golden 缺失时回退到 fixtures 明文基线', () => {
    const missingWorkplace = join(repoRoot, 'packages/legacy/__missing__');
    assert.equal(resolveGoldenFile(missingWorkplace, 'en/GregTech.lang'), join(legacyGoldenRoot, 'en/GregTech.lang'));
    assert.equal(resolveGoldenFile(missingWorkplace, 'zh/GregTech.lang'), join(legacyGoldenRoot, 'zh/GregTech.lang'));
    assert.equal(
      resolveGoldenFile(missingWorkplace, 'zh/GregTech.unknown.lang'),
      join(legacyGoldenRoot, 'zh/GregTech.unknown.lang'),
    );
  });
});

describe('legacy config.yml 导入', () => {
  it('按 YAML 1.2 core schema 解析，yes/no/on/off 保持字符串', () => {
    const yaml = [
      'version: 1',
      'lang: zh',
      'generators:',
      '  - group: demo',
      '    namespace: S:demo.',
      '    dict:',
      '      A: yes',
      '      B: no',
      '      C: on',
      '      D: off',
    ].join('\n');
    const config = convertLegacyYamlToProject(yaml);
    const dict = config.generators[0]!.dict!;
    assert.equal(dict.A, 'yes');
    assert.equal(dict.B, 'no');
    assert.equal(dict.C, 'on');
    assert.equal(dict.D, 'off');
  });

  it('缺少 generators 时抛错', () => {
    assert.throws(() => convertLegacyYamlToProject('version: 1\n'), /缺少 generators/);
  });
});
