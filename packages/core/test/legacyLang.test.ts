import { describe, expect, it } from 'vitest';
import { parseLegacyLang, writeLegacyLang } from '../src/engine/legacyLang';
import type { LangEntry } from '../src/types/lang';

const lines = ['# Configuration file', 'languagefile {', '    S:a=甲', '    S:b=乙', '}', ''];
const crlfText = lines.join('\r\n');

describe('parseLegacyLang', () => {
  it('parses CRLF, LF and bare CR line endings', () => {
    for (const [eol, expected] of [
      ['\r\n', 'crlf'],
      ['\n', 'lf'],
      ['\r', 'cr'],
    ] as const) {
      const document = parseLegacyLang(lines.join(eol));
      expect(document.lineEnding, eol).toBe(expected);
      expect(document.entries.map((entry) => [entry.key, entry.value])).toEqual([
        ['S:a', '甲'],
        ['S:b', '乙'],
      ]);
      expect(document.issues).toEqual([]);
    }
  });

  it('detects a single bare CR as cr', () => {
    const document = parseLegacyLang('languagefile {\r    S:a=甲\r}');

    expect(document.lineEnding).toBe('cr');
    expect(document.entries).toHaveLength(1);
  });

  it('reports mixed line endings', () => {
    const document = parseLegacyLang(
      ['languagefile {', '    S:a=甲', '    S:b=乙', '}', ''].join('\r\n').replace('甲', '甲\n'),
    );

    expect(document.lineEnding).toBe('mixed');
  });

  it('strips a leading UTF-8 BOM', () => {
    const document = parseLegacyLang(`\uFEFF${crlfText}`);

    expect(document.lineEnding).toBe('crlf');
    expect(document.map.get('S:a')).toBe('甲');
    expect(document.entries[0]?.line).toBe(3);
  });

  it('records duplicates while keeping the last value in the map', () => {
    const document = parseLegacyLang(['languagefile {', '    S:a=甲', '    S:a=乙', '}', ''].join('\n'));

    expect(document.duplicates).toEqual([{ key: 'S:a', value: '乙', line: 3, previousValue: '甲', previousLine: 2 }]);
    expect(document.map.get('S:a')).toBe('乙');
  });

  it('keeps values with equals signs and paragraph marks intact', () => {
    const document = parseLegacyLang(['languagefile {', '    S:a=甲=乙¶', '}', ''].join('\n'));

    expect(document.map.get('S:a')).toBe('甲=乙¶');
  });

  it('flags files without a languagefile block', () => {
    const document = parseLegacyLang('# only comments\n');

    expect(document.entries).toEqual([]);
    expect(document.issues).toEqual([{ code: 'lang.empty', message: '没有找到 languagefile 词条' }]);
  });
});

describe('writeLegacyLang', () => {
  const entries: LangEntry[] = [{ key: 'S:a', value: '甲', line: 1 }];

  it('writes CRLF by default with the language-file header enabled', () => {
    expect(writeLegacyLang(entries)).toBe(
      [
        '# Configuration file',
        'enablelangfile {',
        '    B:UseThisFileAsLanguageFile=true',
        '}',
        '',
        'languagefile {',
        '    S:a=甲',
        '}',
        '',
      ].join('\r\n') + '\r\n',
    );
  });

  it('accepts the legacy string argument for LF', () => {
    const text = writeLegacyLang(entries, 'lf');

    expect(text).not.toContain('\r');
    expect(text.startsWith('# Configuration file\n')).toBe(true);
  });

  it('accepts an options object with lineEnding and useFileAsLang', () => {
    const text = writeLegacyLang(entries, { lineEnding: 'lf', useFileAsLang: false });

    expect(text).toContain('B:UseThisFileAsLanguageFile=false');
    expect(text).not.toContain('\r');
  });

  it('defaults the options object to CRLF and an enabled header', () => {
    const text = writeLegacyLang(entries, {});

    expect(text).toContain('B:UseThisFileAsLanguageFile=true');
    expect(text).toContain('\r\n');
  });

  it('round-trips through parseLegacyLang', () => {
    const document = parseLegacyLang(writeLegacyLang(entries, 'lf'));

    expect(document.lineEnding).toBe('lf');
    expect(document.entries).toEqual([{ key: 'S:a', value: '甲', line: 7 }]);
  });
});
