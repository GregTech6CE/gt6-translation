import { describe, expect, it } from 'vitest';
import { parseProjectJsonc, stringifyProjectConfig, updateTargetJsonc } from '../src/config/jsonc';

const lfProject = [
  '{',
  '  // 注释必须保留',
  '  "schemaVersion": 2,',
  '  "defaultTarget": "t",',
  '  "targets": [',
  '    {',
  '      "id": "t",',
  '      "label": "T",',
  '      "format": "legacy-lang",',
  '      "workplace": "packages/legacy/workplace",',
  '      "source": "en/GregTech.lang",',
  '      "fallback": "zh/GregTech.fallback.lang",',
  '      "output": "zh/GregTech.lang",',
  '      "unknown": "zh/GregTech.unknown.lang",',
  '      "encoding": "utf-8",',
  '      "lineEnding": "crlf"',
  '    }',
  '  ],',
  '  "generators": [{ "group": "dust", "dict": { "Iron Dust": "铁粉" } }]',
  '}',
  '',
].join('\n');

describe('parseProjectJsonc', () => {
  it('accepts comments and trailing commas', () => {
    const parsed = parseProjectJsonc(lfProject.replace('"lineEnding": "crlf"', '"lineEnding": "crlf",'));

    expect(parsed.issues).toEqual([]);
    expect(parsed.config?.generators).toHaveLength(1);
  });

  it('reports syntax errors with a 1-based line number', () => {
    const parsed = parseProjectJsonc(['{', '  "schemaVersion": 2,', '  oops', '}'].join('\n'));

    expect(parsed.config).toBeNull();
    expect(parsed.issues[0]?.severity).toBe('error');
    expect(parsed.issues[0]?.code.startsWith('jsonc.')).toBe(true);
    expect(parsed.issues[0]?.line).toBe(3);
  });

  it('reports schema violations as issues', () => {
    const parsed = parseProjectJsonc('{ "schemaVersion": 2 }');

    expect(parsed.config).toBeNull();
    expect(parsed.issues.every((issue) => issue.severity === 'error')).toBe(true);
    expect(parsed.issues.length).toBeGreaterThan(0);
  });
});

describe('updateTargetJsonc', () => {
  it('keeps CRLF line endings and comments when patching a target', () => {
    const updated = updateTargetJsonc(lfProject.replace(/\n/g, '\r\n'), 't', { notes: '本地测试' });

    expect(updated.issues).toEqual([]);
    expect(updated.raw).toContain('// 注释必须保留');
    expect(updated.raw).toContain('本地测试');
    expect(updated.raw).toContain('\r\n');
    expect(updated.raw.replace(/\r\n/g, '')).not.toContain('\n');
    expect(parseProjectJsonc(updated.raw).config?.targets[0]?.notes).toBe('本地测试');
  });

  it('keeps LF line endings when the file has none of CRLF', () => {
    const updated = updateTargetJsonc(lfProject, 't', { notes: '本地测试' });

    expect(updated.issues).toEqual([]);
    expect(updated.raw).not.toContain('\r');
    expect(parseProjectJsonc(updated.raw).config?.targets[0]?.notes).toBe('本地测试');
  });

  it('reports a missing target without touching the file', () => {
    const updated = updateTargetJsonc(lfProject, 'missing', { notes: 'x' });

    expect(updated.raw).toBe(lfProject);
    expect(updated.issues).toEqual([{ severity: 'error', code: 'target.missing', message: '找不到 target：missing' }]);
  });

  it('returns the parse issues when the config is invalid', () => {
    const raw = '{ "schemaVersion": 2 }';
    const updated = updateTargetJsonc(raw, 't', { notes: 'x' });

    expect(updated.raw).toBe(raw);
    expect(updated.issues.length).toBeGreaterThan(0);
  });
});

describe('stringifyProjectConfig', () => {
  it('writes a schema comment followed by the serialized config', () => {
    const parsed = parseProjectJsonc(lfProject);
    const text = stringifyProjectConfig(parsed.config!);

    expect(text.startsWith('// GregTech6 翻译工程配置（schema v2）\n')).toBe(true);
    expect(parseProjectJsonc(text).config).toEqual(parsed.config);
  });
});
