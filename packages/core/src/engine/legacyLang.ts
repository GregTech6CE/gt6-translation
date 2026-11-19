import type { DetectedLineEnding, LangDocument, LangDuplicate, LangEntry } from '../types/lang';

const BOM = '\uFEFF';

/** 旧文件可能带 UTF-8 BOM；解析前统一剥离，避免首行识别失败。 */
function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

/** 统计真实换行符：CRLF、LF 与独立的 CR 都算一种换行。 */
function detectLineEnding(text: string): DetectedLineEnding {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '\r') {
      if (text[index + 1] === '\n') {
        crlf++;
        index++;
      } else {
        cr++;
      }
    } else if (char === '\n') {
      lf++;
    }
  }
  const kinds = Number(crlf > 0) + Number(lf > 0) + Number(cr > 0);
  if (kinds > 1) return 'mixed';
  if (crlf > 0) return 'crlf';
  if (cr > 0) return 'cr';
  if (lf > 0) return 'lf';
  return 'none';
}

/**
 * 解析旧版 .lang。
 *
 * 语义对齐 C++ LangFile：
 * - 从包含 languagefile 的行开始；
 * - 每个含 = 的行按第一个 = 切分，key 去掉前导空格；
 * - 遇到含 } 的行结束；
 * - 保留 S: 前缀和值里的所有字符（包括 ¶、=）。
 *
 * 换行接受 CRLF、LF 与独立的 CR；开头的 UTF-8 BOM 会被剥离。
 */
export function parseLegacyLang(text: string): LangDocument {
  const entries: LangEntry[] = [];
  const map = new Map<string, string>();
  const duplicates: LangDuplicate[] = [];
  const seen = new Map<string, LangEntry>();
  const issues: LangDocument['issues'] = [];
  const content = stripBom(text);
  const lineEnding = detectLineEnding(content);

  let started = false;
  const lines = content.split(/\r\n|\n|\r/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const lineNumber = index + 1;
    if (!started) {
      if (line.includes('languagefile')) started = true;
      continue;
    }
    if (line.includes('=')) {
      const equals = line.indexOf('=');
      const start = line.search(/[^ ]/);
      if (start < 0 || start >= equals) continue;
      const key = line.slice(start, equals);
      const value = line.slice(equals + 1);
      const entry: LangEntry = { key, value, line: lineNumber };
      entries.push(entry);
      const previous = seen.get(key);
      if (previous) {
        duplicates.push({
          key,
          value,
          line: lineNumber,
          previousValue: previous.value,
          previousLine: previous.line,
        });
      } else {
        seen.set(key, entry);
      }
      map.set(key, value);
      continue;
    }
    if (line.includes('}')) {
      started = false;
    }
  }

  if (entries.length === 0) {
    issues.push({ code: 'lang.empty', message: '没有找到 languagefile 词条' });
  }

  return { entries, map, duplicates, lineEnding, issues };
}

export type LegacyLangWriteOptions =
  | 'crlf'
  | 'lf'
  | {
      lineEnding?: 'crlf' | 'lf';
      /** 是否在头部写 `B:UseThisFileAsLanguageFile=true`；默认 true。 */
      useFileAsLang?: boolean;
    };

/**
 * 按旧版格式写入；顺序由调用方决定（应与源文件 key 顺序一致）。
 *
 * 第二个参数兼容旧的 `'crlf' | 'lf'` 写法，也可以传对象同时控制换行与
 * `B:UseThisFileAsLanguageFile`。
 */
export function writeLegacyLang(entries: readonly LangEntry[], options: LegacyLangWriteOptions = 'crlf'): string {
  const lineEnding = typeof options === 'string' ? options : (options.lineEnding ?? 'crlf');
  const useFileAsLang = typeof options === 'string' ? true : (options.useFileAsLang ?? true);
  const eol = lineEnding === 'lf' ? '\n' : '\r\n';
  const lines = [
    '# Configuration file',
    'enablelangfile {',
    `    B:UseThisFileAsLanguageFile=${useFileAsLang ? 'true' : 'false'}`,
    '}',
    '',
    'languagefile {',
    ...entries.map((entry) => `    ${entry.key}=${entry.value}`),
    '}',
    '',
  ];
  return lines.join(eol) + eol;
}
