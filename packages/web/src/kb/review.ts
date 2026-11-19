import type { KnowledgeBase } from '@gt6tg/core';
import { buildCorpusComparison } from './data';

export type ReviewStatus = 'issue' | 'verified';

export interface ReviewMark {
  kind: 'material' | 'glossary';
  id: string;
  status: ReviewStatus;
  suggestedZh: string;
  comment: string;
  updatedAt: string;
}

export type ReviewMarkMap = Record<string, ReviewMark>;

const STORAGE_KEY = 'gt6tg.kb.review.v1';

export function reviewKey(kind: 'material' | 'glossary', id: string): string {
  return `${kind}:${id}`;
}

export function loadReviewMarks(): ReviewMarkMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return parseReviewJson(raw);
  } catch {
    return {};
  }
}

export function saveReviewMarks(marks: ReviewMarkMap): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(marks));
  } catch {
    // 无痕模式或配额受限时忽略持久化错误，内存态仍可用。
  }
}

export function parseReviewJson(text: string): ReviewMarkMap {
  const parsed = JSON.parse(text) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('审校进度文件必须是 JSON 对象');
  }
  const result: ReviewMarkMap = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const item = value as Partial<ReviewMark>;
    if ((item.kind !== 'material' && item.kind !== 'glossary') || typeof item.id !== 'string') continue;
    if (item.status !== 'issue' && item.status !== 'verified') continue;
    result[key] = {
      kind: item.kind,
      id: item.id,
      status: item.status,
      suggestedZh: typeof item.suggestedZh === 'string' ? item.suggestedZh : '',
      comment: typeof item.comment === 'string' ? item.comment : '',
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    };
  }
  return result;
}

export function exportReviewJson(marks: ReviewMarkMap): string {
  return `${JSON.stringify(marks, null, 2)}\n`;
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll(/\r?\n/g, ' ');
}

function uniqueValues(entries: ReadonlyArray<{ value: string }>): string {
  const seen = [...new Set(entries.map((entry) => entry.value))];
  return seen.length > 0 ? seen.join(' / ') : '—';
}

export function exportReviewMarkdown(
  marks: ReviewMarkMap,
  kb: KnowledgeBase,
  gt6Map: Record<string, string>,
  gt6ceMap: Record<string, string>,
): string {
  const materialById = new Map(kb.materials.map((item) => [item.id, item]));
  const glossaryById = new Map(kb.glossary.map((item) => [item.id, item]));
  const issues = Object.values(marks)
    .filter((mark) => mark.status === 'issue')
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind.localeCompare(right.kind);
      return left.id.localeCompare(right.id);
    });
  const verifiedCount = Object.values(marks).filter((mark) => mark.status === 'verified').length;

  const lines: string[] = [
    '# 知识库词汇人工审校待修清单',
    '',
    `- 导出时间：${new Date().toISOString()}`,
    `- 待修条目：${issues.length} 条；已核对：${verifiedCount} 条`,
    '',
  ];

  if (issues.length === 0) {
    lines.push('当前没有标记为「待修」的条目。', '');
    return lines.join('\n');
  }

  lines.push(
    '| 类型 | ID | 英文规范名 | 现行中文 | GT6 语料 | GT6CE 语料 | 建议译名 | 批注 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  );

  for (const mark of issues) {
    if (mark.kind === 'material') {
      const record = materialById.get(mark.id);
      if (!record) continue;
      const cmp = buildCorpusComparison(record.keys, record.zh, gt6Map, gt6ceMap);
      lines.push(
        `| 材料 | \`${record.id}\` | ${escapeCell(record.en.canonical)} | ${escapeCell(record.zh.canonical)} | ${escapeCell(uniqueValues(cmp.gt6))} | ${escapeCell(uniqueValues(cmp.gt6ce))} | ${escapeCell(mark.suggestedZh || '—')} | ${escapeCell(mark.comment || '—')} |`,
      );
    } else {
      const record = glossaryById.get(mark.id);
      if (!record) continue;
      const cmp = buildCorpusComparison(record.keys, record.zh, gt6Map, gt6ceMap);
      lines.push(
        `| 术语 | \`${record.id}\` | ${escapeCell(record.en.canonical)} | ${escapeCell(record.zh.canonical)} | ${escapeCell(uniqueValues(cmp.gt6))} | ${escapeCell(uniqueValues(cmp.gt6ce))} | ${escapeCell(mark.suggestedZh || '—')} | ${escapeCell(mark.comment || '—')} |`,
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}
