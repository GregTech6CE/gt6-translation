<script setup lang="ts">
  import type {
    CeParityStatus,
    EvidenceLevel,
    GlossaryDomain,
    LegacyTermStatus,
    MaterialCategory,
    OriginKind,
  } from '@gt6tg/core';
  import {
    NAlert,
    NButton,
    NCard,
    NCollapse,
    NCollapseItem,
    NDataTable,
    NDescriptions,
    NDescriptionsItem,
    NDrawer,
    NDrawerContent,
    NEmpty,
    NInput,
    NPopconfirm,
    NRadioButton,
    NRadioGroup,
    NSelect,
    NSpace,
    NTag,
    useMessage,
    type DataTableColumns,
    type SelectOption,
  } from 'naive-ui';
  import { computed, h, reactive, ref, watch, type VNodeChild } from 'vue';
  import { downloadText } from '../backend/download';
  import {
    CATEGORY_LABELS,
    DOMAIN_LABELS,
    EVIDENCE_LABELS,
    GT6CE_STATUS_LABELS,
    LEGACY_STATUS_LABELS,
    ORIGIN_KIND_LABELS,
    buildGlossaryRows,
    buildMaterialRows,
    loadBundledKnowledgeBase,
    parseGt6ceLangJson,
    type CorpusComparison,
    type GlossaryRow,
    type KbRow,
    type MaterialRow,
  } from '../kb/data';
  import {
    exportReviewJson,
    exportReviewMarkdown,
    loadReviewMarks,
    parseReviewJson,
    reviewKey,
    saveReviewMarks,
    type ReviewMark,
    type ReviewMarkMap,
    type ReviewStatus,
  } from '../kb/review';

  type SubView = 'materials' | 'glossary' | 'derivations';
  type QuickFilter =
    | 'all'
    | 'untranslated'
    | 'gt6-diff'
    | 'gt6ce-diff'
    | 'unrecorded-diff'
    | 'has-legacy'
    | 'collision'
    | 'state-names'
    | 'marked-issue'
    | 'unverified';

  const message = useMessage();
  const bundle = loadBundledKnowledgeBase();

  const subView = ref<SubView>('materials');
  const quickFilter = ref<QuickFilter>('all');
  const search = ref('');
  const categoryFilter = ref<MaterialCategory | null>(null);
  const originKindFilter = ref<OriginKind | null>(null);
  const evidenceFilter = ref<EvidenceLevel | null>(null);
  const gt6ceStatusFilter = ref<CeParityStatus | null>(null);
  const legacyStatusFilter = ref<LegacyTermStatus | null>(null);
  const domainFilter = ref<GlossaryDomain | null>(null);

  const customGt6ceMap = ref<Record<string, string> | null>(null);
  const customGt6ceLabel = ref<string | null>(null);
  const gt6ceFileInput = ref<HTMLInputElement | null>(null);
  const reviewFileInput = ref<HTMLInputElement | null>(null);

  const reviewMarks = ref<ReviewMarkMap>(loadReviewMarks());
  watch(reviewMarks, (next) => saveReviewMarks(next), { deep: true });

  const gt6Map = computed(() => bundle.defaultCorpus.gt6);
  const gt6ceMap = computed(() => customGt6ceMap.value ?? bundle.defaultCorpus.gt6ce);
  const gt6ceLoaded = computed(() => customGt6ceMap.value !== null || bundle.defaultCorpus.gt6ceAvailable);
  const gt6ceSourceLabel = computed(
    () => customGt6ceLabel.value ?? bundle.defaultCorpus.gt6ceSource ?? '未载入同级 GT6CE 语料',
  );

  const materialRows = computed<MaterialRow[]>(() =>
    bundle.knowledgeBase
      ? buildMaterialRows(bundle.knowledgeBase.materials, bundle.issuesBySubject, gt6Map.value, gt6ceMap.value)
      : [],
  );

  const glossaryRows = computed<GlossaryRow[]>(() =>
    bundle.knowledgeBase
      ? buildGlossaryRows(bundle.knowledgeBase.glossary, bundle.issuesBySubject, gt6Map.value, gt6ceMap.value)
      : [],
  );

  const reviewCounts = computed(() => {
    let issue = 0;
    let verified = 0;
    for (const mark of Object.values(reviewMarks.value)) {
      if (mark.status === 'issue') issue++;
      else verified++;
    }
    return { issue, verified };
  });

  function getMark(kind: 'material' | 'glossary', id: string): ReviewMark | undefined {
    return reviewMarks.value[reviewKey(kind, id)];
  }

  function setMarkStatus(kind: 'material' | 'glossary', id: string, status: ReviewStatus): void {
    const key = reviewKey(kind, id);
    const existing = reviewMarks.value[key];
    if (existing && existing.status === status && status === 'verified' && !existing.comment && !existing.suggestedZh) {
      delete reviewMarks.value[key];
      return;
    }
    reviewMarks.value[key] = {
      kind,
      id,
      status,
      suggestedZh: existing?.suggestedZh ?? '',
      comment: existing?.comment ?? '',
      updatedAt: new Date().toISOString(),
    };
  }

  function clearMark(kind: 'material' | 'glossary', id: string): void {
    delete reviewMarks.value[reviewKey(kind, id)];
  }

  function updateMarkField(
    kind: 'material' | 'glossary',
    id: string,
    field: 'suggestedZh' | 'comment',
    value: string,
  ): void {
    const key = reviewKey(kind, id);
    const existing = reviewMarks.value[key];
    reviewMarks.value[key] = {
      kind,
      id,
      status: existing?.status ?? 'issue',
      suggestedZh: field === 'suggestedZh' ? value : (existing?.suggestedZh ?? ''),
      comment: field === 'comment' ? value : (existing?.comment ?? ''),
      updatedAt: new Date().toISOString(),
    };
  }

  function matchesQuickFilter(row: KbRow, filter: QuickFilter): boolean {
    if (filter === 'all') return true;
    if (filter === 'untranslated') return row.untranslated;
    if (filter === 'gt6-diff') return row.corpus.gt6Diff;
    if (filter === 'gt6ce-diff') return row.corpus.gt6ceDiff;
    if (filter === 'unrecorded-diff') return row.corpus.unrecordedDiff;
    if (filter === 'has-legacy') return (row.record.zh.legacy?.length ?? 0) > 0;
    if (filter === 'collision') return row.hasCollision;
    if (filter === 'state-names') return row.kind === 'material' && row.hasStateNames;
    const mark = getMark(row.kind, row.id);
    if (filter === 'marked-issue') return mark?.status === 'issue';
    if (filter === 'unverified') return mark?.status !== 'verified';
    return true;
  }

  function matchesSearch(row: KbRow, needle: string): boolean {
    if (!needle) return true;
    if (row.searchText.includes(needle)) return true;
    const mark = getMark(row.kind, row.id);
    if (!mark) return false;
    return mark.comment.toLowerCase().includes(needle) || mark.suggestedZh.toLowerCase().includes(needle);
  }

  const filteredMaterials = computed(() => {
    const needle = search.value.trim().toLowerCase();
    return materialRows.value.filter((row) => {
      if (!matchesQuickFilter(row, quickFilter.value)) return false;
      if (categoryFilter.value && row.record.category !== categoryFilter.value) return false;
      if (originKindFilter.value && row.record.origin.kind !== originKindFilter.value) return false;
      if (evidenceFilter.value && row.record.origin.evidence !== evidenceFilter.value) return false;
      if (gt6ceStatusFilter.value && row.record.targets.gt6ce !== gt6ceStatusFilter.value) return false;
      if (
        legacyStatusFilter.value &&
        !(row.record.zh.legacy ?? []).some((entry) => entry.status === legacyStatusFilter.value)
      ) {
        return false;
      }
      return matchesSearch(row, needle);
    });
  });

  const filteredGlossary = computed(() => {
    const needle = search.value.trim().toLowerCase();
    return glossaryRows.value.filter((row) => {
      if (!matchesQuickFilter(row, quickFilter.value)) return false;
      if (domainFilter.value && row.record.domain !== domainFilter.value) return false;
      if (
        legacyStatusFilter.value &&
        !(row.record.zh.legacy ?? []).some((entry) => entry.status === legacyStatusFilter.value)
      ) {
        return false;
      }
      return matchesSearch(row, needle);
    });
  });

  const activeRows = computed<readonly KbRow[]>(() =>
    subView.value === 'materials' ? filteredMaterials.value : filteredGlossary.value,
  );

  const quickCounts = computed(() => {
    const rows: readonly KbRow[] = subView.value === 'materials' ? materialRows.value : glossaryRows.value;
    const count = (filter: QuickFilter) => rows.filter((row) => matchesQuickFilter(row, filter)).length;
    return {
      all: rows.length,
      untranslated: count('untranslated'),
      gt6Diff: count('gt6-diff'),
      gt6ceDiff: count('gt6ce-diff'),
      unrecordedDiff: count('unrecorded-diff'),
      hasLegacy: count('has-legacy'),
      collision: count('collision'),
      stateNames: count('state-names'),
      markedIssue: count('marked-issue'),
      unverified: count('unverified'),
    };
  });

  const quickFilterOptions = computed<Array<{ id: QuickFilter; label: string; count: number; show: boolean }>>(() => [
    { id: 'all', label: '全部', count: quickCounts.value.all, show: true },
    { id: 'untranslated', label: '未译', count: quickCounts.value.untranslated, show: true },
    { id: 'gt6-diff', label: '与 GT6 语料不同', count: quickCounts.value.gt6Diff, show: true },
    { id: 'gt6ce-diff', label: '与 GT6CE 语料不同', count: quickCounts.value.gt6ceDiff, show: gt6ceLoaded.value },
    { id: 'unrecorded-diff', label: '差异未记入 legacy', count: quickCounts.value.unrecordedDiff, show: true },
    { id: 'has-legacy', label: '有旧译/候选', count: quickCounts.value.hasLegacy, show: true },
    { id: 'collision', label: '中文撞车', count: quickCounts.value.collision, show: true },
    {
      id: 'state-names',
      label: '分形态译名',
      count: quickCounts.value.stateNames,
      show: subView.value === 'materials',
    },
    { id: 'marked-issue', label: '已标待修', count: quickCounts.value.markedIssue, show: true },
    { id: 'unverified', label: '未核对', count: quickCounts.value.unverified, show: true },
  ]);

  const categoryOptions: SelectOption[] = Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ label, value }));
  const originKindOptions: SelectOption[] = Object.entries(ORIGIN_KIND_LABELS).map(([value, label]) => ({
    label,
    value,
  }));
  const evidenceOptions: SelectOption[] = Object.entries(EVIDENCE_LABELS).map(([value, label]) => ({ label, value }));
  const gt6ceStatusOptions: SelectOption[] = Object.entries(GT6CE_STATUS_LABELS).map(([value, label]) => ({
    label,
    value,
  }));
  const legacyStatusOptions: SelectOption[] = Object.entries(LEGACY_STATUS_LABELS).map(([value, label]) => ({
    label,
    value,
  }));
  const domainOptions: SelectOption[] = Object.entries(DOMAIN_LABELS).map(([value, label]) => ({ label, value }));

  const pagination = reactive({
    page: 1,
    pageSize: 50,
    showSizePicker: true,
    pageSizes: [25, 50, 100, 200],
    onChange(page: number) {
      pagination.page = page;
    },
    onUpdatePageSize(pageSize: number) {
      pagination.pageSize = pageSize;
      pagination.page = 1;
    },
  });

  watch(
    [
      subView,
      quickFilter,
      search,
      categoryFilter,
      originKindFilter,
      evidenceFilter,
      gt6ceStatusFilter,
      legacyStatusFilter,
      domainFilter,
    ],
    () => {
      pagination.page = 1;
    },
  );

  function resetFilters(): void {
    quickFilter.value = 'all';
    search.value = '';
    categoryFilter.value = null;
    originKindFilter.value = null;
    evidenceFilter.value = null;
    gt6ceStatusFilter.value = null;
    legacyStatusFilter.value = null;
    domainFilter.value = null;
  }

  // 详情与审校抽屉状态
  const drawerVisible = ref(false);
  const selectedKind = ref<'material' | 'glossary'>('material');
  const selectedId = ref<string | null>(null);

  const selectedIndex = computed(() => {
    if (!selectedId.value) return -1;
    return activeRows.value.findIndex((row) => row.kind === selectedKind.value && row.id === selectedId.value);
  });

  const selectedRow = computed<KbRow | null>(() => {
    if (!selectedId.value) return null;
    const rows = selectedKind.value === 'material' ? materialRows.value : glossaryRows.value;
    return rows.find((row) => row.id === selectedId.value) ?? null;
  });

  const selectedMark = computed<ReviewMark | undefined>(() =>
    selectedRow.value ? getMark(selectedRow.value.kind, selectedRow.value.id) : undefined,
  );

  function openDetail(row: KbRow): void {
    selectedKind.value = row.kind;
    selectedId.value = row.id;
    drawerVisible.value = true;
  }

  function stepDetail(delta: number): void {
    const index = selectedIndex.value;
    if (index < 0) return;
    const next = activeRows.value[index + delta];
    if (!next) return;
    selectedKind.value = next.kind;
    selectedId.value = next.id;
  }

  function renderCorpusColumn(corpus: CorpusComparison): VNodeChild {
    const nodes: VNodeChild[] = [];
    const renderGroup = (label: string, entries: CorpusComparison['gt6']) => {
      if (entries.length === 0) return;
      const unique = [...new Map(entries.map((entry) => [entry.value, entry])).values()];
      nodes.push(
        h('div', { class: 'kb-corpus-line' }, [
          h('span', { class: 'kb-corpus-label' }, `${label}:`),
          ...unique.map((entry) =>
            h(
              NTag,
              {
                size: 'tiny',
                bordered: false,
                type: entry.sameAsCanonical ? 'default' : entry.inLegacyOrState ? 'warning' : 'error',
              },
              { default: () => entry.value },
            ),
          ),
        ]),
      );
    };
    renderGroup('GT6', corpus.gt6);
    renderGroup('CE', corpus.gt6ce);
    if (nodes.length === 0) return h('span', { class: 'muted' }, '—');
    return h('div', { class: 'kb-corpus-cell' }, nodes);
  }

  function renderLegacyColumn(legacy: KbRow['record']['zh']['legacy']): VNodeChild {
    if (!legacy || legacy.length === 0) return h('span', { class: 'muted' }, '—');
    return h(
      'div',
      { class: 'kb-tag-wrap' },
      legacy.map((entry) =>
        h(
          NTag,
          {
            size: 'tiny',
            type: entry.status === 'rejected' ? 'error' : entry.status === 'proposed' ? 'info' : 'default',
          },
          { default: () => `${LEGACY_STATUS_LABELS[entry.status]}: ${entry.text} (${entry.source})` },
        ),
      ),
    );
  }

  function renderReviewActions(row: KbRow): VNodeChild {
    const mark = getMark(row.kind, row.id);
    const children: VNodeChild[] = [
      h('div', { class: 'kb-action-row' }, [
        h(
          NButton,
          { size: 'tiny', quaternary: true, type: 'primary', onClick: () => openDetail(row) },
          { default: () => '详情' },
        ),
        h(
          NButton,
          {
            size: 'tiny',
            secondary: mark?.status === 'issue',
            quaternary: mark?.status !== 'issue',
            type: mark?.status === 'issue' ? 'error' : 'default',
            onClick: () => {
              setMarkStatus(row.kind, row.id, 'issue');
              openDetail(row);
            },
          },
          { default: () => (mark?.status === 'issue' ? '待修' : '标待修') },
        ),
        h(
          NButton,
          {
            size: 'tiny',
            secondary: mark?.status === 'verified',
            quaternary: mark?.status !== 'verified',
            type: mark?.status === 'verified' ? 'success' : 'default',
            onClick: () => setMarkStatus(row.kind, row.id, 'verified'),
          },
          { default: () => (mark?.status === 'verified' ? '✓ 已核' : '已核') },
        ),
      ]),
    ];
    if (mark?.suggestedZh || mark?.comment) {
      const hint = [mark.suggestedZh ? `建议：${mark.suggestedZh}` : '', mark.comment].filter(Boolean).join(' · ');
      children.push(h('div', { class: 'kb-note-preview', title: hint }, hint));
    }
    return h('div', { class: 'kb-action-cell' }, children);
  }

  const materialColumns: DataTableColumns<MaterialRow> = [
    {
      title: 'ID / 英文',
      key: 'id',
      width: 210,
      sorter: (left, right) => left.record.en.canonical.localeCompare(right.record.en.canonical, 'en'),
      render: (row) =>
        h('div', { class: 'kb-primary-cell', onClick: () => openDetail(row) }, [
          h('div', { class: 'kb-strong' }, row.record.en.canonical),
          h('div', { class: 'kb-mono muted' }, row.id),
          row.record.en.aliases?.length
            ? h('div', { class: 'muted kb-subline' }, `别名: ${row.record.en.aliases.join(', ')}`)
            : null,
        ]),
    },
    {
      title: '现行中文',
      key: 'zh',
      width: 170,
      sorter: (left, right) => left.record.zh.canonical.localeCompare(right.record.zh.canonical, 'zh-CN'),
      render: (row) => {
        const mark = getMark('material', row.id);
        return h('div', { class: 'kb-zh-cell' }, [
          h('div', { class: 'kb-strong' }, row.record.zh.canonical),
          h('div', { class: 'kb-tag-wrap' }, [
            row.untranslated ? h(NTag, { size: 'tiny', type: 'warning' }, { default: () => '未译' }) : null,
            row.hasCollision ? h(NTag, { size: 'tiny', type: 'info' }, { default: () => '同名' }) : null,
            row.hasStateNames ? h(NTag, { size: 'tiny', type: 'success' }, { default: () => '分形态' }) : null,
            mark?.status === 'issue' ? h(NTag, { size: 'tiny', type: 'error' }, { default: () => '待修' }) : null,
            mark?.status === 'verified' ? h(NTag, { size: 'tiny', type: 'success' }, { default: () => '已核' }) : null,
          ]),
        ]);
      },
    },
    {
      title: 'GT6 / GT6CE 语料',
      key: 'corpus',
      width: 220,
      render: (row) => renderCorpusColumn(row.corpus),
    },
    {
      title: '旧译 / 候选',
      key: 'legacy',
      width: 220,
      render: (row) => renderLegacyColumn(row.record.zh.legacy),
    },
    {
      title: '类别 / 组成',
      key: 'category',
      width: 140,
      sorter: (left, right) => left.record.category.localeCompare(right.record.category, 'en'),
      render: (row) =>
        h('div', [
          h(NTag, { size: 'tiny', bordered: false }, { default: () => CATEGORY_LABELS[row.record.category] }),
          row.record.composition ? h('div', { class: 'kb-mono kb-subline' }, row.record.composition) : null,
        ]),
    },
    {
      title: '出处',
      key: 'origin',
      width: 155,
      sorter: (left, right) => left.record.origin.kind.localeCompare(right.record.origin.kind, 'en'),
      render: (row) =>
        h('div', [
          h('div', { class: 'kb-tag-wrap' }, [
            h(
              NTag,
              { size: 'tiny', type: row.record.origin.kind === 'minecraft' ? 'success' : 'default' },
              { default: () => ORIGIN_KIND_LABELS[row.record.origin.kind] },
            ),
            h(
              NTag,
              {
                size: 'tiny',
                bordered: false,
                type:
                  row.record.origin.evidence === 'verified'
                    ? 'success'
                    : row.record.origin.evidence === 'unknown'
                      ? 'warning'
                      : 'default',
              },
              { default: () => EVIDENCE_LABELS[row.record.origin.evidence] },
            ),
          ]),
          h('div', { class: 'muted kb-subline' }, row.record.origin.source),
        ]),
    },
    {
      title: 'GT6CE',
      key: 'gt6ce',
      width: 82,
      render: (row) =>
        h(
          NTag,
          {
            size: 'tiny',
            type:
              row.record.targets.gt6ce === 'active'
                ? 'success'
                : row.record.targets.gt6ce === 'removed'
                  ? 'error'
                  : 'default',
          },
          { default: () => GT6CE_STATUS_LABELS[row.record.targets.gt6ce] },
        ),
    },
    {
      title: '审校',
      key: 'actions',
      width: 165,
      render: (row) => renderReviewActions(row),
    },
  ];

  const glossaryColumns: DataTableColumns<GlossaryRow> = [
    {
      title: 'ID / 英文',
      key: 'id',
      width: 220,
      sorter: (left, right) => left.record.en.canonical.localeCompare(right.record.en.canonical, 'en'),
      render: (row) =>
        h('div', { class: 'kb-primary-cell', onClick: () => openDetail(row) }, [
          h('div', { class: 'kb-strong' }, row.record.en.canonical),
          h('div', { class: 'kb-mono muted' }, row.id),
        ]),
    },
    {
      title: '域',
      key: 'domain',
      width: 100,
      sorter: (left, right) => left.record.domain.localeCompare(right.record.domain, 'en'),
      render: (row) => h(NTag, { size: 'tiny', bordered: false }, { default: () => DOMAIN_LABELS[row.record.domain] }),
    },
    {
      title: '现行中文',
      key: 'zh',
      width: 170,
      sorter: (left, right) => left.record.zh.canonical.localeCompare(right.record.zh.canonical, 'zh-CN'),
      render: (row) => {
        const mark = getMark('glossary', row.id);
        return h('div', { class: 'kb-zh-cell' }, [
          h('div', { class: 'kb-strong' }, row.record.zh.canonical),
          h('div', { class: 'kb-tag-wrap' }, [
            row.hasCollision ? h(NTag, { size: 'tiny', type: 'info' }, { default: () => '同名' }) : null,
            mark?.status === 'issue' ? h(NTag, { size: 'tiny', type: 'error' }, { default: () => '待修' }) : null,
            mark?.status === 'verified' ? h(NTag, { size: 'tiny', type: 'success' }, { default: () => '已核' }) : null,
          ]),
        ]);
      },
    },
    {
      title: 'GT6 / GT6CE 语料',
      key: 'corpus',
      width: 220,
      render: (row) => renderCorpusColumn(row.corpus),
    },
    {
      title: '旧译 / 候选',
      key: 'legacy',
      width: 220,
      render: (row) => renderLegacyColumn(row.record.zh.legacy),
    },
    {
      title: '关联',
      key: 'seeAlso',
      width: 140,
      render: (row) =>
        row.record.seeAlso?.length
          ? h('span', { class: 'kb-mono muted' }, row.record.seeAlso.join(', '))
          : h('span', { class: 'muted' }, '—'),
    },
    {
      title: '审校',
      key: 'actions',
      width: 165,
      render: (row) => renderReviewActions(row),
    },
  ];

  // 导入导出与剪贴板工具
  function triggerImportGt6ce(): void {
    gt6ceFileInput.value?.click();
  }

  async function onImportGt6ceFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const map = parseGt6ceLangJson(text, bundle.allGt6ceKeys);
      customGt6ceMap.value = map;
      customGt6ceLabel.value = `手动导入：${file.name}（命中 ${Object.keys(map).length} 键）`;
      message.success(`已导入 ${file.name}，匹配 ${Object.keys(map).length} 个知识库键`);
    } catch (error) {
      message.error(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function handleExportMarkdown(): void {
    if (!bundle.knowledgeBase) return;
    const md = exportReviewMarkdown(reviewMarks.value, bundle.knowledgeBase, gt6Map.value, gt6ceMap.value);
    downloadText('kb-review-issues.md', md);
    message.success(`已导出审校清单（待修 ${reviewCounts.value.issue} 条）`);
  }

  async function handleCopyMarkdown(): Promise<void> {
    if (!bundle.knowledgeBase) return;
    const md = exportReviewMarkdown(reviewMarks.value, bundle.knowledgeBase, gt6Map.value, gt6ceMap.value);
    try {
      await navigator.clipboard.writeText(md);
      message.success(`已复制审校清单到剪贴板（待修 ${reviewCounts.value.issue} 条）`);
    } catch {
      downloadText('kb-review-issues.md', md);
      message.info('剪贴板不可用，已改为下载 kb-review-issues.md');
    }
  }

  function handleExportJson(): void {
    downloadText('kb-review-progress.json', exportReviewJson(reviewMarks.value));
    message.success('已导出审校进度 JSON');
  }

  function triggerImportReview(): void {
    reviewFileInput.value?.click();
  }

  async function onImportReviewFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const imported = parseReviewJson(await file.text());
      reviewMarks.value = { ...reviewMarks.value, ...imported };
      message.success(`已合并导入 ${Object.keys(imported).length} 条审校标记`);
    } catch (error) {
      message.error(`导入进度失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function handleClearAllMarks(): void {
    reviewMarks.value = {};
    message.success('已清空本地审校标记');
  }

  async function copySelectedJson(): Promise<void> {
    if (!selectedRow.value) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(selectedRow.value.record, null, 2));
      message.success('已复制条目 JSON');
    } catch {
      message.error('复制失败，请手动选中复制');
    }
  }

  const drawerKeyRows = computed(() => {
    const row = selectedRow.value;
    if (!row) return [];
    const keys = row.record.keys;
    const canonical = row.record.zh.canonical;
    const items: Array<{ target: string; key: string; corpusZh: string; status: 'same' | 'legacy' | 'diff' | 'none' }> =
      [];

    for (const key of keys?.gt6 ?? []) {
      const found = row.corpus.gt6.find((entry) => entry.key === key);
      items.push({
        target: 'GT6',
        key,
        corpusZh: found ? found.value : '—',
        status: !found ? 'none' : found.value === canonical ? 'same' : found.inLegacyOrState ? 'legacy' : 'diff',
      });
    }
    for (const key of keys?.gt6ce ?? []) {
      const found = row.corpus.gt6ce.find((entry) => entry.key === key);
      items.push({
        target: 'GT6CE',
        key,
        corpusZh: found ? found.value : gt6ceLoaded.value ? '（未译或缺失）' : '（未载入语料）',
        status: !found ? 'none' : found.value === canonical ? 'same' : found.inLegacyOrState ? 'legacy' : 'diff',
      });
    }
    for (const key of keys?.gt6w ?? []) {
      items.push({ target: 'GT6_w', key, corpusZh: '—', status: 'none' });
    }
    return items;
  });
</script>

<template>
  <div class="page">
    <input ref="gt6ceFileInput" type="file" accept=".json,application/json" hidden @change="onImportGt6ceFile" />
    <input ref="reviewFileInput" type="file" accept=".json,application/json" hidden @change="onImportReviewFile" />

    <n-alert v-if="bundle.loadIssues.length > 0" type="error" class="section" title="知识库加载失败">
      <div v-for="(issue, index) in bundle.loadIssues" :key="index" class="kb-mono">
        {{ issue.source }}:{{ issue.line }} {{ issue.message }}
      </div>
    </n-alert>

    <template v-else-if="bundle.knowledgeBase && bundle.report">
      <n-card size="small" class="section">
        <div class="kb-summary-bar">
          <div class="kb-summary-group">
            <n-tag size="small" type="info">材料 {{ bundle.report.stats.materials }}</n-tag>
            <n-tag size="small" type="info">术语 {{ bundle.report.stats.glossary }}</n-tag>
            <n-tag size="small">
              派生族 {{ bundle.report.stats.families }} / 占位 {{ bundle.report.stats.internalPlaceholders }}
            </n-tag>
            <n-tag size="small" :type="bundle.report.errors.length === 0 ? 'success' : 'error'">
              校验 {{ bundle.report.errors.length }} err / {{ bundle.report.warnings.length }} warn
            </n-tag>
            <n-tag size="small" :type="bundle.defaultCorpus.gt6Available ? 'success' : 'warning'">
              GT6 语料 {{ Object.keys(gt6Map).length }} 键
            </n-tag>
            <n-tag size="small" :type="gt6ceLoaded ? 'success' : 'warning'" :title="gt6ceSourceLabel">
              GT6CE 语料 {{ gt6ceLoaded ? `${Object.keys(gt6ceMap).length} 键` : '未载入' }}
            </n-tag>
            <n-button size="tiny" quaternary @click="triggerImportGt6ce">导入 GT6CE zh_cn.json</n-button>
          </div>

          <div class="kb-summary-group">
            <n-tag size="small" type="error">待修 {{ reviewCounts.issue }}</n-tag>
            <n-tag size="small" type="success">已核对 {{ reviewCounts.verified }}</n-tag>
            <n-button size="tiny" type="primary" :disabled="reviewCounts.issue === 0" @click="handleCopyMarkdown">
              复制待修 MD
            </n-button>
            <n-button size="tiny" :disabled="reviewCounts.issue === 0" @click="handleExportMarkdown">导出 MD</n-button>
            <n-button size="tiny" quaternary @click="handleExportJson">导出进度</n-button>
            <n-button size="tiny" quaternary @click="triggerImportReview">导入进度</n-button>
            <n-popconfirm @positive-click="handleClearAllMarks">
              <template #trigger>
                <n-button
                  size="tiny"
                  quaternary
                  type="error"
                  :disabled="reviewCounts.issue + reviewCounts.verified === 0"
                >
                  清空标记
                </n-button>
              </template>
              确定清空当前浏览器保存的全部审校标记与批注？
            </n-popconfirm>
          </div>
        </div>
      </n-card>

      <div class="toolbar">
        <n-radio-group v-model:value="subView" size="small">
          <n-radio-button value="materials">材料 ({{ materialRows.length }})</n-radio-button>
          <n-radio-button value="glossary">术语 ({{ glossaryRows.length }})</n-radio-button>
          <n-radio-button value="derivations">
            派生族与占位 ({{ bundle.knowledgeBase.derivations.families.length }} +
            {{ bundle.knowledgeBase.derivations.internalPlaceholders.length }})
          </n-radio-button>
        </n-radio-group>

        <span v-if="subView !== 'derivations'" class="muted">
          当前显示 {{ activeRows.length }} 条 · 点击行或「详情」查看完整语言键与外链，标记自动保存至浏览器本地
        </span>
      </div>

      <template v-if="subView !== 'derivations'">
        <div class="kb-chip-bar">
          <n-tag
            v-for="item in quickFilterOptions.filter((option) => option.show)"
            :key="item.id"
            size="small"
            class="preset"
            :type="quickFilter === item.id ? 'primary' : 'default'"
            :bordered="quickFilter !== item.id"
            @click="quickFilter = item.id"
          >
            {{ item.label }} ({{ item.count }})
          </n-tag>
        </div>

        <div class="toolbar">
          <n-input
            v-model:value="search"
            size="small"
            clearable
            placeholder="搜索 id / 英文 / 中文 / 别名 / 语言键 / 语料现值 / 备注 / 批注"
            style="width: 340px"
          />

          <template v-if="subView === 'materials'">
            <n-select
              v-model:value="categoryFilter"
              size="small"
              clearable
              placeholder="类别"
              :options="categoryOptions"
              style="width: 115px"
            />
            <n-select
              v-model:value="originKindFilter"
              size="small"
              clearable
              placeholder="出处大类"
              :options="originKindOptions"
              style="width: 120px"
            />
            <n-select
              v-model:value="evidenceFilter"
              size="small"
              clearable
              placeholder="证据等级"
              :options="evidenceOptions"
              style="width: 110px"
            />
            <n-select
              v-model:value="gt6ceStatusFilter"
              size="small"
              clearable
              placeholder="GT6CE 状态"
              :options="gt6ceStatusOptions"
              style="width: 115px"
            />
          </template>

          <n-select
            v-else
            v-model:value="domainFilter"
            size="small"
            clearable
            placeholder="术语域"
            :options="domainOptions"
            style="width: 130px"
          />

          <n-select
            v-model:value="legacyStatusFilter"
            size="small"
            clearable
            placeholder="旧译状态"
            :options="legacyStatusOptions"
            style="width: 110px"
          />

          <n-button size="small" quaternary @click="resetFilters">重置筛选</n-button>
        </div>

        <n-data-table
          v-if="subView === 'materials'"
          size="small"
          :bordered="true"
          :striped="true"
          :columns="materialColumns"
          :data="filteredMaterials"
          :row-key="(row: MaterialRow) => row.id"
          :pagination="pagination"
          :scroll-x="1360"
        />

        <n-data-table
          v-else
          size="small"
          :bordered="true"
          :striped="true"
          :columns="glossaryColumns"
          :data="filteredGlossary"
          :row-key="(row: GlossaryRow) => row.id"
          :pagination="pagination"
          :scroll-x="1200"
        />
      </template>

      <template v-else>
        <div class="section-title">规则派生族（{{ bundle.knowledgeBase.derivations.families.length }}）</div>
        <div class="kb-card-grid">
          <n-card
            v-for="family in bundle.knowledgeBase.derivations.families"
            :key="family.id"
            size="small"
            :title="family.id"
          >
            <div class="section">{{ family.description }}</div>
            <n-descriptions :column="1" size="small" label-placement="left" bordered>
              <n-descriptions-item v-if="family.template" label="英文模板">
                <span class="kb-mono">{{ family.template.en }}</span>
              </n-descriptions-item>
              <n-descriptions-item v-if="family.template" label="中文模板">
                <span class="kb-mono">{{ family.template.zh }}</span>
              </n-descriptions-item>
              <n-descriptions-item label="键正则">
                <div v-for="pattern in family.keyPatterns" :key="pattern" class="kb-mono">{{ pattern }}</div>
              </n-descriptions-item>
            </n-descriptions>
          </n-card>
        </div>

        <div class="section-title">
          内部占位 / 彩蛋键（{{ bundle.knowledgeBase.derivations.internalPlaceholders.length }}）
        </div>
        <n-card size="small">
          <n-descriptions :column="1" size="small" label-placement="left" bordered>
            <n-descriptions-item
              v-for="(item, index) in bundle.knowledgeBase.derivations.internalPlaceholders"
              :key="index"
              :label="item.keys.join(', ')"
            >
              {{ item.reason }}
            </n-descriptions-item>
          </n-descriptions>
        </n-card>
      </template>
    </template>

    <n-empty v-else description="知识库未加载" />

    <n-drawer v-model:show="drawerVisible" :width="620" placement="right">
      <n-drawer-content v-if="selectedRow" closable>
        <template #header>
          <div class="kb-drawer-head">
            <div>
              <div class="kb-strong">{{ selectedRow.record.en.canonical }} / {{ selectedRow.record.zh.canonical }}</div>
              <div class="kb-mono muted">{{ selectedRow.kind }}:{{ selectedRow.id }}</div>
            </div>
            <n-space size="small" align="center">
              <span v-if="selectedIndex >= 0" class="muted">{{ selectedIndex + 1 }} / {{ activeRows.length }}</span>
              <n-button size="tiny" :disabled="selectedIndex <= 0" @click="stepDetail(-1)">上一条</n-button>
              <n-button
                size="tiny"
                :disabled="selectedIndex < 0 || selectedIndex >= activeRows.length - 1"
                @click="stepDetail(1)"
              >
                下一条
              </n-button>
            </n-space>
          </div>
        </template>

        <n-card size="small" title="人工审校标记（本地自动保存）" class="section">
          <div class="toolbar">
            <n-button
              size="small"
              :type="selectedMark?.status === 'issue' ? 'error' : 'default'"
              :secondary="selectedMark?.status === 'issue'"
              @click="setMarkStatus(selectedRow.kind, selectedRow.id, 'issue')"
            >
              标记待修
            </n-button>
            <n-button
              size="small"
              :type="selectedMark?.status === 'verified' ? 'success' : 'default'"
              :secondary="selectedMark?.status === 'verified'"
              @click="setMarkStatus(selectedRow.kind, selectedRow.id, 'verified')"
            >
              标记已核对
            </n-button>
            <n-button v-if="selectedMark" size="small" quaternary @click="clearMark(selectedRow.kind, selectedRow.id)">
              清除标记
            </n-button>
          </div>

          <div class="kb-review-fields">
            <div>
              <div class="field-label">建议中文译名（留空表示不改译名或另见批注）</div>
              <n-input
                size="small"
                :value="selectedMark?.suggestedZh ?? ''"
                placeholder="例如：青金石"
                @update:value="(val) => updateMarkField(selectedRow!.kind, selectedRow!.id, 'suggestedZh', val)"
              />
            </div>
            <div>
              <div class="field-label">审校批注（如出处/分类/旧译归属/撞车问题）</div>
              <n-input
                type="textarea"
                size="small"
                :autosize="{ minRows: 2, maxRows: 5 }"
                :value="selectedMark?.comment ?? ''"
                placeholder="记录需要修改的原因、参考链接或语料差异说明…"
                @update:value="(val) => updateMarkField(selectedRow!.kind, selectedRow!.id, 'comment', val)"
              />
            </div>
          </div>
        </n-card>

        <n-alert
          v-for="(issue, index) in selectedRow.issues"
          :key="index"
          :type="issue.severity === 'error' ? 'error' : 'warning'"
          class="section"
        >
          [{{ issue.code }}] {{ issue.message }}
        </n-alert>

        <n-descriptions :column="2" size="small" bordered label-placement="left" class="section">
          <n-descriptions-item label="英文规范名">{{ selectedRow.record.en.canonical }}</n-descriptions-item>
          <n-descriptions-item label="现行中文">{{ selectedRow.record.zh.canonical }}</n-descriptions-item>
          <n-descriptions-item v-if="selectedRow.record.en.aliases?.length" label="英文别名" :span="2">
            {{ selectedRow.record.en.aliases.join(', ') }}
          </n-descriptions-item>
          <n-descriptions-item v-if="selectedRow.record.zh.aliases?.length" label="中文别名" :span="2">
            {{ selectedRow.record.zh.aliases.join('、') }}
          </n-descriptions-item>

          <template v-if="selectedRow.kind === 'material'">
            <n-descriptions-item label="类别">
              {{ CATEGORY_LABELS[selectedRow.record.category] }} ({{ selectedRow.record.category }})
            </n-descriptions-item>
            <n-descriptions-item label="形态">{{ selectedRow.record.states.join(', ') }}</n-descriptions-item>
            <n-descriptions-item label="组成">{{ selectedRow.record.composition ?? '—' }}</n-descriptions-item>
            <n-descriptions-item label="特征">{{ selectedRow.record.traits?.join(', ') || '—' }}</n-descriptions-item>
            <n-descriptions-item label="出处大类">
              {{ ORIGIN_KIND_LABELS[selectedRow.record.origin.kind] }} · {{ selectedRow.record.origin.source }}
            </n-descriptions-item>
            <n-descriptions-item label="证据等级">
              {{ EVIDENCE_LABELS[selectedRow.record.origin.evidence] }}
            </n-descriptions-item>
            <n-descriptions-item v-if="selectedRow.record.origin.alsoIn?.length" label="也见于" :span="2">
              {{ selectedRow.record.origin.alsoIn.join(', ') }}
            </n-descriptions-item>
            <n-descriptions-item label="GT6CE 状态">
              {{ GT6CE_STATUS_LABELS[selectedRow.record.targets.gt6ce] }}
              <span v-if="selectedRow.record.targets.numericId !== undefined" class="muted">
                · ID {{ selectedRow.record.targets.numericId }}
              </span>
              <span v-if="selectedRow.record.targets.modTag" class="muted">
                · {{ selectedRow.record.targets.modTag }}
              </span>
            </n-descriptions-item>
            <n-descriptions-item label="MT.java">
              <a
                v-if="selectedRow.record.targets.mtRef"
                :href="selectedRow.record.targets.mtRef"
                target="_blank"
                rel="noopener noreferrer"
              >
                打开 MT.java 参考
              </a>
              <span v-else class="muted">—</span>
            </n-descriptions-item>
            <n-descriptions-item
              v-if="selectedRow.record.zh.stateNames && Object.keys(selectedRow.record.zh.stateNames).length > 0"
              label="分形态译名"
              :span="2"
            >
              <div class="kb-tag-wrap">
                <n-tag
                  v-for="(name, state) in selectedRow.record.zh.stateNames"
                  :key="state"
                  size="small"
                  type="success"
                >
                  {{ state }}: {{ name }}
                </n-tag>
              </div>
            </n-descriptions-item>
            <n-descriptions-item v-if="selectedRow.record.origin.urls?.length" label="外部信源" :span="2">
              <div v-for="url in selectedRow.record.origin.urls" :key="url" class="kb-link-line">
                <a :href="url" target="_blank" rel="noopener noreferrer">{{ url }}</a>
              </div>
            </n-descriptions-item>
          </template>

          <template v-else>
            <n-descriptions-item label="术语域">
              {{ DOMAIN_LABELS[selectedRow.record.domain] }} ({{ selectedRow.record.domain }})
            </n-descriptions-item>
            <n-descriptions-item label="关联术语">
              {{ selectedRow.record.seeAlso?.join(', ') || '—' }}
            </n-descriptions-item>
          </template>

          <n-descriptions-item v-if="selectedRow.record.allowSameZhReason" label="允许同名理由" :span="2">
            {{ selectedRow.record.allowSameZhReason }}
          </n-descriptions-item>
          <n-descriptions-item v-if="selectedRow.record.notes" label="备注" :span="2">
            {{ selectedRow.record.notes }}
          </n-descriptions-item>
        </n-descriptions>

        <div class="section-title">逐键语料对照</div>
        <n-card size="small" class="section">
          <div v-if="drawerKeyRows.length === 0" class="muted">无登记语言键</div>
          <div v-for="item in drawerKeyRows" :key="`${item.target}:${item.key}`" class="kb-key-row">
            <n-tag size="tiny" :type="item.target === 'GT6CE' ? 'info' : 'default'">{{ item.target }}</n-tag>
            <span class="kb-mono">{{ item.key }}</span>
            <span class="muted">→</span>
            <n-tag
              size="tiny"
              :type="
                item.status === 'same'
                  ? 'success'
                  : item.status === 'legacy'
                    ? 'warning'
                    : item.status === 'diff'
                      ? 'error'
                      : 'default'
              "
            >
              {{ item.corpusZh }}
            </n-tag>
          </div>
        </n-card>

        <div class="section-title">旧译 / 不采用 / 待定候选</div>
        <n-card size="small" class="section">
          <div v-if="!selectedRow.record.zh.legacy?.length" class="muted">无历史或候选记录</div>
          <div v-for="(entry, index) in selectedRow.record.zh.legacy ?? []" :key="index" class="kb-key-row">
            <n-tag
              size="tiny"
              :type="entry.status === 'rejected' ? 'error' : entry.status === 'proposed' ? 'info' : 'default'"
            >
              {{ LEGACY_STATUS_LABELS[entry.status] }}
            </n-tag>
            <span class="kb-strong">{{ entry.text }}</span>
            <span class="muted">({{ entry.source }})</span>
            <span v-if="entry.note" class="muted">— {{ entry.note }}</span>
          </div>
        </n-card>

        <n-collapse class="section">
          <n-collapse-item title="原始 JSON" name="raw">
            <template #header-extra>
              <n-button size="tiny" quaternary @click.stop="copySelectedJson">复制 JSON</n-button>
            </template>
            <pre class="kb-json-pre">{{ JSON.stringify(selectedRow.record, null, 2) }}</pre>
          </n-collapse-item>
        </n-collapse>
      </n-drawer-content>
    </n-drawer>
  </div>
</template>
