/**
 * 知识库的文本读写：JSONL 逐行解析、JSON 配置解析与稳定序列化。
 *
 * 只接受字符串，不碰文件系统，因此浏览器、worker 与 Node 都能复用；
 * 真正的读文件由 `packages/node` 的 CLI 负责。
 */
import type { ZodType } from 'zod';
import { glossaryRecordSchema, materialDerivationsSchema, materialRecordSchema } from './schema.ts';
import type { GlossaryRecord, KnowledgeBase, MaterialDerivationsConfig, MaterialRecord } from './types.ts';

/** 解析问题：行号从 1 开始，`source` 是文件名或标识。 */
export interface LoadIssue {
  source: string;
  line: number;
  message: string;
}

export interface ParsedRecords<T> {
  records: T[];
  issues: LoadIssue[];
}

export interface ParsedValue<T> {
  value?: T;
  issues: LoadIssue[];
}

function describe(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map((segment) => String(segment)).join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

/** 逐行解析 JSONL；空行跳过，坏行记一条 issue 并继续。 */
export function parseJsonl<T>(text: string, schema: ZodType<T>, source: string): ParsedRecords<T> {
  const records: T[] = [];
  const issues: LoadIssue[] = [];
  const lines = text.split(/\r\n|\n|\r/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (line === '') continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      issues.push({ source, line: index + 1, message: `JSON 解析失败：${(error as Error).message}` });
      continue;
    }
    const result = schema.safeParse(raw);
    if (result.success) {
      records.push(result.data);
    } else {
      issues.push({ source, line: index + 1, message: describe(result.error) });
    }
  }
  return { records, issues };
}

/** 解析单个 JSON 文档。 */
export function parseJson<T>(text: string, schema: ZodType<T>, source: string): ParsedValue<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { issues: [{ source, line: 1, message: `JSON 解析失败：${(error as Error).message}` }] };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return { issues: [{ source, line: 1, message: describe(result.error) }] };
  }
  return { value: result.data, issues: [] };
}

export interface KnowledgeBaseFiles {
  materials: string;
  glossary: string;
  derivations: string;
}

export interface ParsedKnowledgeBase {
  knowledgeBase?: KnowledgeBase;
  issues: LoadIssue[];
}

/** 解析三个知识库文件；任一文件有结构错误时不返回半成品。 */
export function parseKnowledgeBase(files: KnowledgeBaseFiles): ParsedKnowledgeBase {
  const materials = parseJsonl<MaterialRecord>(files.materials, materialRecordSchema, 'materials.jsonl');
  const glossary = parseJsonl<GlossaryRecord>(files.glossary, glossaryRecordSchema, 'glossary.jsonl');
  const derivations = parseJson<MaterialDerivationsConfig>(
    files.derivations,
    materialDerivationsSchema,
    'material-derivations.json',
  );
  const issues = [...materials.issues, ...glossary.issues, ...derivations.issues];
  if (issues.length > 0 || derivations.value === undefined) {
    return { issues };
  }
  return {
    knowledgeBase: {
      materials: materials.records,
      glossary: glossary.records,
      derivations: derivations.value,
    },
    issues,
  };
}

/** 按固定键序序列化，保证渲染与 diff 稳定。 */
export function serializeJsonl(records: readonly unknown[]): string {
  return records.map((record) => `${JSON.stringify(record)}\n`).join('');
}
