import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { compareToGolden, lintProject, parseLegacyLang, parseProjectJsonc, type LangDocument } from '@gt6tg/core';
import { loadCorpus, loadProjectConfig, loadProjectData } from '../src/cli/lib';
import { NodeEngineClient } from '../src/engine-client';
import { legacyGoldenRoot, readLangTextSync } from '../src/paths';

const GOLDEN_KEYS = 125676;

function loadFixture(name: string): LangDocument {
  const path = join(legacyGoldenRoot, name);
  assert.ok(existsSync(path), `缺少 golden 基线：${path}`);
  return parseLegacyLang(readLangTextSync(path));
}

describe('parity smoke', () => {
  it('真实语料对 fixtures/legacy-golden 零差异', async () => {
    const corpus = loadCorpus();
    const golden = loadFixture('zh/GregTech.lang');
    const goldenUnknown = loadFixture('zh/GregTech.unknown.lang');

    const client = new NodeEngineClient();
    try {
      const compiled = await client.compile(corpus.configText);
      const run = await client.run({
        compileId: compiled.compileId,
        sourceText: corpus.sourceText,
        fallbackText: corpus.fallbackText,
        lineEnding: corpus.target.lineEnding,
        scope: 'all',
      });

      const output = parseLegacyLang(run.outputText).map;
      const unknown = new Set(parseLegacyLang(run.unknownText).entries.map((entry) => entry.key));
      const parity = compareToGolden(golden, { output, unknown }, goldenUnknown);

      assert.equal(golden.map.size, GOLDEN_KEYS);
      assert.equal(output.size, GOLDEN_KEYS);
      assert.equal(parity.mismatch, 0);
      assert.equal(parity.extraKeys, 0);
      assert.equal(parity.unknownMismatch, 0);
      assert.equal(parity.ok, true);
    } finally {
      client.close();
    }
  });

  it('project.jsonc 严格 lint 零 error', () => {
    const { configText } = loadProjectConfig();
    const parsed = parseProjectJsonc(configText);
    assert.ok(parsed.config, `project.jsonc 未通过 schema：${JSON.stringify(parsed.issues)}`);

    const lint = lintProject(parsed.config);
    const errors = [...parsed.issues, ...lint.issues].filter((issue) => issue.severity === 'error');
    assert.deepEqual(errors, []);
  });

  it('loadProjectData 的 golden 路径可读（本地产物或 fixtures 回退）', () => {
    const data = loadProjectData();
    assert.ok(existsSync(data.goldenPath), `golden 不可读：${data.goldenPath}`);
    assert.ok(existsSync(data.goldenUnknownPath), `golden unknown 不可读：${data.goldenUnknownPath}`);
    assert.equal(data.golden.map.size, GOLDEN_KEYS);
    assert.equal(data.goldenUnknown.map.size, 774);
  });
});
