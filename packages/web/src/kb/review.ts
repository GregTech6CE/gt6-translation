import { formatAnnotatedZh, formatFullEn, type KnowledgeBase } from '@gt6tg/core';
import { buildCorpusComparison, KIND_LABELS, type KbEntryKind } from './data';

export interface ReviewIssue {
  kind: KbEntryKind;
  id: string;
  suggestedZh: string;
  comment: string;
  updatedAt: string;
}

export type ReviewIssueMap = Record<string, ReviewIssue>;

const STORAGE_KEY = 'gt6tg.kb.review.v1';

export function reviewKey(kind: KbEntryKind, id: string): string {
  return `${kind}:${id}`;
}

function isReviewKind(value: unknown): value is KbEntryKind {
  return value === 'material' || value === 'glossary' || value === 'entity';
}

export function loadReviewIssues(): ReviewIssueMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const result: ReviewIssueMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
      const item = value as Partial<ReviewIssue & { status?: string }>;
      if (!isReviewKind(item.kind) || typeof item.id !== 'string') continue;
      // 兼容旧版存储结构，仅保留待修条目。
      if (item.status !== undefined && item.status !== 'issue') continue;
      result[key] = {
        kind: item.kind,
        id: item.id,
        suggestedZh: typeof item.suggestedZh === 'string' ? item.suggestedZh : '',
        comment: typeof item.comment === 'string' ? item.comment : '',
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
      };
    }
    return result;
  } catch {
    return {};
  }
}

export function saveReviewIssues(issues: ReviewIssueMap): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(issues));
  } catch {
    // 无痕模式或配额受限时忽略持久化错误，内存态仍可用。
  }
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll(/\r?\n/g, ' ');
}

function uniqueValues(entries: ReadonlyArray<{ value: string }>): string {
  const seen = [...new Set(entries.map((entry) => entry.value))];
  return seen.length > 0 ? seen.join(' / ') : '—';
}

export function exportReviewMarkdown(
  issueMap: ReviewIssueMap,
  kb: KnowledgeBase,
  gt6Map: Record<string, string>,
  gt6ceMap: Record<string, string>,
): string {
  const materialById = new Map(kb.materials.map((item) => [item.id, item]));
  const glossaryById = new Map(kb.glossary.map((item) => [item.id, item]));
  const entityById = new Map(kb.entities.map((item) => [item.id, item]));
  const issues = Object.values(issueMap).sort((left, right) => {
    if (left.kind !== right.kind) return left.kind.localeCompare(right.kind);
    return left.id.localeCompare(right.id);
  });

  const lines: string[] = [
    '# 知识库标记清单',
    '',
    `- 导出时间：${new Date().toISOString()}`,
    `- 已标记条目：${issues.length} 条`,
    '',
  ];

  if (issues.length === 0) {
    lines.push('当前没有已标记的条目。', '');
    return lines.join('\n');
  }

  lines.push(
    '| 类型 | ID | 英文规范名 | 现行中文 | GT6 语料 | GT6CE 语料 | 建议译名 | 修改说明 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  );

  for (const item of issues) {
    const record =
      item.kind === 'material'
        ? materialById.get(item.id)
        : item.kind === 'glossary'
          ? glossaryById.get(item.id)
          : entityById.get(item.id);
    if (!record) continue;
    const cmp = buildCorpusComparison(record.keys, record.zh, gt6Map, gt6ceMap);
    lines.push(
      `| ${KIND_LABELS[item.kind]} | \`${record.id}\` | ${escapeCell(formatFullEn(record.en))} | ${escapeCell(formatAnnotatedZh(record.zh))} | ${escapeCell(uniqueValues(cmp.gt6))} | ${escapeCell(uniqueValues(cmp.gt6ce))} | ${escapeCell(item.suggestedZh || '—')} | ${escapeCell(item.comment || '—')} |`,
    );
  }

  lines.push('');
  return lines.join('\n');
}
