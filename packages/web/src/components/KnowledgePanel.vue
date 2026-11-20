<script setup lang="ts">
  import type {
    EntityDomain,
    EvidenceLevel,
    GlossaryDomain,
    LegacyTermEntry,
    LegacyTermStatus,
    LocalizedEn,
    LocalizedZh,
    MaterialCategory,
    OriginKind,
  } from '@gt6tg/core';
  import {
    NAlert,
    NButton,
    NCard,
    NCheckbox,
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
    NTooltip,
    useMessage,
    type DataTableColumns,
    type SelectOption,
  } from 'naive-ui';
  import { computed, h, reactive, ref, watch, type VNodeChild } from 'vue';
  import { downloadText } from '../backend/download';
  import {
    CATEGORY_LABELS,
    DOMAIN_LABELS,
    ENTITY_DOMAIN_LABELS,
    EVIDENCE_LABELS,
    GT6CE_STATUS_LABELS,
    KIND_LABELS,
    LEGACY_STATUS_LABELS,
    ORIGIN_KIND_LABELS,
    buildEntityRows,
    buildGlossaryRows,
    buildMaterialRows,
    formatLegacySource,
    loadBundledKnowledgeBase,
    parseGt6ceLangJson,
    type CorpusKeyValue,
    type EntityRow,
    type GlossaryRow,
    type KbEntryKind,
    type KbRow,
    type MaterialRow,
  } from '../kb/data';
  import {
    exportReviewMarkdown,
    loadReviewIssues,
    reviewKey,
    saveReviewIssues,
    type ReviewIssue,
    type ReviewIssueMap,
  } from '../kb/review';

  type SubView = 'materials' | 'entities' | 'glossary' | 'derivations';
  type CorpusDisplayMode = 'compact' | 'full';
  type ProblemFilter =
    | 'multi-split'
    | 'gt6ce-diff'
    | 'gt6-diff'
    | 'only-suffix'
    | 'untranslated'
    | 'unicode-risk'
    | 'collision';
  type OtherFilter = 'suffix-stem' | 'variant' | 'marked-issue';

  const COLOR_LEGEND: ReadonlyArray<{ id: ProblemFilter; cls: string; label: string; requireCe?: boolean }> = [
    { id: 'multi-split', cls: 'kb-pill--split', label: '多键分裂' },
    { id: 'gt6ce-diff', cls: 'kb-pill--ce-diff', label: 'GT6CE 不一致', requireCe: true },
    { id: 'gt6-diff', cls: 'kb-pill--gt6-diff', label: 'GT6 不一致' },
    { id: 'only-suffix', cls: 'kb-pill--suffix', label: '仅后缀差' },
    { id: 'untranslated', cls: 'kb-pill--untranslated', label: '未译' },
    { id: 'unicode-risk', cls: 'kb-pill--unicode', label: 'Unicode 扩展区风险' },
    { id: 'collision', cls: 'kb-pill--collision', label: '中文撞车' },
  ];

  const message = useMessage();
  const bundle = loadBundledKnowledgeBase();

  const subView = ref<SubView>('materials');
  const corpusMode = ref<CorpusDisplayMode>('compact');
  const problemFilter = ref<ProblemFilter | null>(null);
  const otherFilters = ref<OtherFilter[]>([]);
  const hideConsistent = ref(true);
  const hidePureSuffix = ref(false);
  const search = ref('');
  const categoryFilter = ref<MaterialCategory | null>(null);
  const originKindFilter = ref<OriginKind | null>(null);
  const evidenceFilter = ref<EvidenceLevel | null>(null);
  const glossaryDomainFilter = ref<GlossaryDomain | null>(null);
  const entityDomainFilter = ref<EntityDomain | null>(null);

  const customGt6ceMap = ref<Record<string, string> | null>(null);
  const customGt6ceLabel = ref<string | null>(null);
  const gt6ceFileInput = ref<HTMLInputElement | null>(null);

  const reviewIssues = ref<ReviewIssueMap>(loadReviewIssues());
  watch(reviewIssues, (next) => saveReviewIssues(next), { deep: true });

  const gt6Map = computed(() => bundle.defaultCorpus.gt6);
  const gt6ceMap = computed(() => customGt6ceMap.value ?? bundle.defaultCorpus.gt6ce);
  const gt6ceLoaded = computed(() => customGt6ceMap.value !== null || bundle.defaultCorpus.gt6ceAvailable);
  const gt6ceSourceLabel = computed(
    () => customGt6ceLabel.value ?? bundle.defaultCorpus.gt6ceSource ?? '未载入同级 GT6CE 语料',
  );
  const hasActiveSearch = computed(() => search.value.trim().length > 0);

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

  const entityRows = computed<EntityRow[]>(() =>
    bundle.knowledgeBase
      ? buildEntityRows(bundle.knowledgeBase.entities, bundle.issuesBySubject, gt6Map.value, gt6ceMap.value)
      : [],
  );

  const issueCount = computed(() => Object.keys(reviewIssues.value).length);

  function getIssue(kind: KbEntryKind, id: string): ReviewIssue | undefined {
    return reviewIssues.value[reviewKey(kind, id)];
  }

  function markIssue(kind: KbEntryKind, id: string): void {
    const key = reviewKey(kind, id);
    const existing = reviewIssues.value[key];
    reviewIssues.value[key] = {
      kind,
      id,
      suggestedZh: existing?.suggestedZh ?? '',
      comment: existing?.comment ?? '',
      updatedAt: new Date().toISOString(),
    };
  }

  function removeIssue(kind: KbEntryKind, id: string): void {
    delete reviewIssues.value[reviewKey(kind, id)];
  }

  function toggleIssue(kind: KbEntryKind, id: string): void {
    if (getIssue(kind, id)) {
      removeIssue(kind, id);
    } else {
      markIssue(kind, id);
    }
  }

  function toggleProblemFilter(id: ProblemFilter): void {
    if (problemFilter.value === id) {
      problemFilter.value = null;
      return;
    }
    problemFilter.value = id;
    if (id === 'collision' && hideConsistent.value) {
      hideConsistent.value = false;
    }
    if (id === 'only-suffix' && hidePureSuffix.value) {
      hidePureSuffix.value = false;
    }
  }

  function toggleOtherFilter(id: OtherFilter): void {
    const index = otherFilters.value.indexOf(id);
    if (index >= 0) {
      otherFilters.value.splice(index, 1);
      return;
    }
    otherFilters.value.push(id);
    if (hideConsistent.value) {
      hideConsistent.value = false;
    }
    if (id === 'suffix-stem' && hidePureSuffix.value) {
      hidePureSuffix.value = false;
    }
  }

  function matchesProblemFilter(row: KbRow, filter: ProblemFilter | null): boolean {
    if (!filter) return true;
    if (filter === 'multi-split') return row.corpus.multiKeySplit;
    if (filter === 'gt6ce-diff') return row.corpus.gt6ceDiff;
    if (filter === 'gt6-diff') return row.corpus.gt6Diff;
    if (filter === 'only-suffix') return row.corpus.onlySuffixDiff;
    if (filter === 'untranslated') return row.untranslated;
    if (filter === 'unicode-risk') return row.hasUnicodeRisk;
    if (filter === 'collision') return row.hasCollision;
    return true;
  }

  function matchesOtherFilters(row: KbRow, filters: readonly OtherFilter[]): boolean {
    for (const id of filters) {
      if (id === 'suffix-stem' && !(row.hasSuffix || row.corpus.onlySuffixDiff)) return false;
      if (id === 'variant' && !row.hasVariant) return false;
      if (id === 'marked-issue' && !getIssue(row.kind, row.id)) return false;
    }
    return true;
  }

  function matchesDenoise(row: KbRow, ignoreConsistentHide = false): boolean {
    if (!ignoreConsistentHide && hideConsistent.value && row.allConsistent) return false;
    if (
      hidePureSuffix.value &&
      row.corpus.onlySuffixDiff &&
      !row.corpus.multiKeySplit &&
      !row.untranslated &&
      !row.hasUnicodeRisk
    ) {
      return false;
    }
    return true;
  }

  function matchesSearch(row: KbRow, needle: string): boolean {
    if (!needle) return true;
    if (row.searchText.includes(needle)) return true;
    const item = getIssue(row.kind, row.id);
    if (!item) return false;
    return item.comment.toLowerCase().includes(needle) || item.suggestedZh.toLowerCase().includes(needle);
  }

  function matchesDropdownAndSearch(row: KbRow, needle: string): boolean {
    if (row.kind === 'material') {
      if (categoryFilter.value && row.record.category !== categoryFilter.value) return false;
      if (originKindFilter.value && row.record.origin.kind !== originKindFilter.value) return false;
      if (evidenceFilter.value && row.record.origin.evidence !== evidenceFilter.value) return false;
    } else if (row.kind === 'glossary') {
      if (glossaryDomainFilter.value && row.record.domain !== glossaryDomainFilter.value) return false;
    } else {
      if (entityDomainFilter.value && row.record.domain !== entityDomainFilter.value) return false;
    }
    return matchesSearch(row, needle);
  }

  function filterTabRows(rows: readonly KbRow[]): KbRow[] {
    const needle = search.value.trim().toLowerCase();
    const bypassConsistent = needle.length > 0;
    return rows.filter((row) => {
      if (!matchesDenoise(row, bypassConsistent)) return false;
      if (!matchesProblemFilter(row, problemFilter.value)) return false;
      if (!matchesOtherFilters(row, otherFilters.value)) return false;
      return matchesDropdownAndSearch(row, needle);
    });
  }

  const filteredMaterials = computed(() => filterTabRows(materialRows.value) as MaterialRow[]);
  const filteredGlossary = computed(() => filterTabRows(glossaryRows.value) as GlossaryRow[]);
  const filteredEntities = computed(() => filterTabRows(entityRows.value) as EntityRow[]);

  const currentTabRawRows = computed<readonly KbRow[]>(() => {
    if (subView.value === 'materials') return materialRows.value;
    if (subView.value === 'glossary') return glossaryRows.value;
    if (subView.value === 'entities') return entityRows.value;
    return [];
  });

  const activeRows = computed<readonly KbRow[]>(() => {
    if (subView.value === 'materials') return filteredMaterials.value;
    if (subView.value === 'glossary') return filteredGlossary.value;
    if (subView.value === 'entities') return filteredEntities.value;
    return [];
  });

  const tabStats = computed(() => {
    const rows = currentTabRawRows.value;
    let consistent = 0;
    let pureSuffix = 0;
    for (const row of rows) {
      if (row.allConsistent) consistent++;
      if (row.corpus.onlySuffixDiff && !row.corpus.multiKeySplit && !row.untranslated && !row.hasUnicodeRisk) {
        pureSuffix++;
      }
    }
    return { total: rows.length, consistent, pureSuffix };
  });

  const problemOptions = computed(() => {
    const needle = search.value.trim().toLowerCase();
    const bypassConsistent = needle.length > 0;
    const basePool = currentTabRawRows.value.filter(
      (row) => matchesOtherFilters(row, otherFilters.value) && matchesDropdownAndSearch(row, needle),
    );
    const denoised = basePool.filter((row) => matchesDenoise(row, bypassConsistent));
    return COLOR_LEGEND.filter((item) => !item.requireCe || gt6ceLoaded.value).map((item) => {
      const pool = item.id === 'collision' ? basePool : denoised;
      return {
        ...item,
        count: pool.filter((row) => matchesProblemFilter(row, item.id)).length,
      };
    });
  });

  const otherFilterOptions = computed<
    Array<{ id: OtherFilter; label: string; hint: string; count: number; show: boolean }>
  >(() => {
    const needle = search.value.trim().toLowerCase();
    const bypassConsistent = needle.length > 0;
    const basePool = currentTabRawRows.value.filter(
      (row) => matchesProblemFilter(row, problemFilter.value) && matchesDropdownAndSearch(row, needle),
    );
    const count = (id: OtherFilter) => {
      const otherActive = otherFilters.value.filter((item) => item !== id);
      const isActive = otherFilters.value.includes(id);
      return basePool.filter((row) => {
        if (isActive && !matchesDenoise(row, bypassConsistent)) return false;
        return matchesOtherFilters(row, [...otherActive, id]);
      }).length;
    };
    return [
      {
        id: 'suffix-stem',
        label: '模板后缀 / 词干',
        hint: '含结构化 suffix 后缀或纯后缀差异的材料/术语',
        count: count('suffix-stem'),
        show: true,
      },
      {
        id: 'variant',
        label: '形态变体',
        hint: '按形态拆分为独立词条的主材料与变体（如盐酸与氯化氢）',
        count: count('variant'),
        show: subView.value === 'materials',
      },
      {
        id: 'marked-issue',
        label: '已标记',
        hint: '行内已点击「标记」的条目',
        count: count('marked-issue'),
        show: true,
      },
    ];
  });

  const categoryOptions: SelectOption[] = Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ label, value }));
  const originKindOptions: SelectOption[] = Object.entries(ORIGIN_KIND_LABELS).map(([value, label]) => ({
    label,
    value,
  }));
  const evidenceOptions: SelectOption[] = Object.entries(EVIDENCE_LABELS).map(([value, label]) => ({ label, value }));
  const glossaryDomainOptions: SelectOption[] = Object.entries(DOMAIN_LABELS).map(([value, label]) => ({
    label,
    value,
  }));
  const entityDomainOptions: SelectOption[] = Object.entries(ENTITY_DOMAIN_LABELS).map(([value, label]) => ({
    label,
    value,
  }));

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
      problemFilter,
      otherFilters,
      hideConsistent,
      hidePureSuffix,
      search,
      categoryFilter,
      originKindFilter,
      evidenceFilter,
      glossaryDomainFilter,
      entityDomainFilter,
    ],
    () => {
      pagination.page = 1;
    },
    { deep: true },
  );

  watch(subView, (next) => {
    if (next !== 'materials') {
      otherFilters.value = otherFilters.value.filter((item) => item !== 'variant');
    }
  });

  function resetFilters(): void {
    problemFilter.value = null;
    otherFilters.value = [];
    hideConsistent.value = true;
    hidePureSuffix.value = false;
    search.value = '';
    categoryFilter.value = null;
    originKindFilter.value = null;
    evidenceFilter.value = null;
    glossaryDomainFilter.value = null;
    entityDomainFilter.value = null;
  }

  // 详情与待修抽屉状态
  const drawerVisible = ref(false);
  const selectedKind = ref<KbEntryKind>('material');
  const selectedId = ref<string | null>(null);

  const selectedIndex = computed(() => {
    if (!selectedId.value) return -1;
    return activeRows.value.findIndex((row) => row.kind === selectedKind.value && row.id === selectedId.value);
  });

  const selectedRow = computed<KbRow | null>(() => {
    if (!selectedId.value) return null;
    const rows: readonly KbRow[] =
      selectedKind.value === 'material'
        ? materialRows.value
        : selectedKind.value === 'glossary'
          ? glossaryRows.value
          : entityRows.value;
    return rows.find((row) => row.id === selectedId.value) ?? null;
  });

  function openDetail(row: KbRow): void {
    selectedKind.value = row.kind;
    selectedId.value = row.id;
    drawerVisible.value = true;
  }

  function jumpToId(id: string): void {
    const target = bundle.lookupById.get(id);
    if (!target) {
      message.warning(`未找到词条：${id}`);
      return;
    }
    subView.value = target.kind === 'material' ? 'materials' : target.kind === 'glossary' ? 'glossary' : 'entities';
    selectedKind.value = target.kind;
    selectedId.value = target.id;
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

  function renderTipTable(rows: ReadonlyArray<readonly [string, VNodeChild]>): VNodeChild {
    return h(
      'table',
      { class: 'kb-tip-table' },
      rows.map(([label, value]) => h('tr', [h('th', label), h('td', Array.isArray(value) ? value : [value])])),
    );
  }

  function renderPill(text: string, cls: string, tooltip?: VNodeChild): VNodeChild {
    const node = h('span', { class: ['kb-pill', cls] }, text);
    if (!tooltip) return node;
    return h(
      NTooltip,
      { trigger: 'hover', placement: 'top', style: { maxWidth: '460px' } },
      { trigger: () => node, default: () => tooltip },
    );
  }

  function renderEnName(en: LocalizedEn): VNodeChild {
    return h('span', { class: 'kb-name-inline' }, [
      h('span', { class: 'kb-strong' }, en.canonical),
      en.suffix ? h('span', { class: 'kb-suffix' }, ` (${en.suffix})`) : null,
    ]);
  }

  function renderZhTextNodes(zh: LocalizedZh): VNodeChild[] {
    return [
      h('span', { class: 'kb-strong' }, zh.canonical),
      zh.suffix ? h('span', { class: 'kb-suffix' }, `（${zh.suffix}）`) : null,
    ];
  }

  function renderZhCell(row: KbRow): VNodeChild {
    const issue = getIssue(row.kind, row.id);
    const tipRows: Array<[string, VNodeChild]> = [];
    let frameClass: string | null = null;

    if (row.untranslated) {
      frameClass = 'kb-pill--untranslated';
      tipRows.push(['未译：', '现行中文与英文相同']);
    } else if (row.hasUnicodeRisk) {
      frameClass = 'kb-pill--unicode';
      for (const item of row.unicodeRisks) {
        tipRows.push(['Unicode 风险：', `${item.char} (${item.codePoint}) · ${item.block}：${item.reason}`]);
      }
    } else if (row.hasCollision) {
      frameClass = 'kb-pill--collision';
      tipRows.push(['中文撞车：', row.record.allowSameZhReason ?? '存在同名撞车']);
    }

    const secondaryDots: VNodeChild[] = [];
    if (frameClass !== 'kb-pill--unicode' && row.hasUnicodeRisk) {
      const tip = row.unicodeRisks.map((u) => `${u.char} (${u.codePoint}) ${u.block}`).join('；');
      secondaryDots.push(
        h(
          NTooltip,
          { trigger: 'hover' },
          {
            trigger: () => h('span', { class: 'kb-dot kb-dot--unicode' }),
            default: () => renderTipTable([['Unicode 风险：', tip]]),
          },
        ),
      );
    }
    if (frameClass !== 'kb-pill--collision' && row.hasCollision) {
      const tip = row.record.allowSameZhReason ?? '存在同名撞车';
      secondaryDots.push(
        h(
          NTooltip,
          { trigger: 'hover' },
          {
            trigger: () => h('span', { class: 'kb-dot kb-dot--collision' }),
            default: () => renderTipTable([['中文撞车：', tip]]),
          },
        ),
      );
    }

    const baseContent = frameClass
      ? h('span', { class: ['kb-pill', frameClass, 'kb-zh-framed'] }, renderZhTextNodes(row.record.zh))
      : h('span', { class: 'kb-name-inline' }, renderZhTextNodes(row.record.zh));

    const wrapped =
      tipRows.length > 0
        ? h(
            NTooltip,
            { trigger: 'hover', placement: 'top', style: { maxWidth: '460px' } },
            {
              trigger: () => baseContent,
              default: () => renderTipTable(tipRows),
            },
          )
        : baseContent;

    const lineChildren: VNodeChild[] = [wrapped, ...secondaryDots];

    return h('div', { class: 'kb-zh-cell' }, [
      h('div', { class: 'kb-zh-line' }, lineChildren),
      issue
        ? h('div', { class: 'kb-tag-wrap' }, [h(NTag, { size: 'tiny', type: 'error' }, { default: () => '已标记' })])
        : null,
    ]);
  }

  function summarizeOriginTooltip(row: MaterialRow): VNodeChild {
    const { origin, targets, notes } = row.record;
    const rows: Array<[string, VNodeChild]> = [
      ['类型：', ORIGIN_KIND_LABELS[origin.kind]],
      ['出处：', origin.source],
      [
        '证据：',
        `${EVIDENCE_LABELS[origin.evidence]}${origin.urls?.length ? `（外部信源 ${origin.urls.length} 条）` : ''}`,
      ],
    ];
    if (origin.alsoIn?.length) rows.push(['也见于：', origin.alsoIn.join('、')]);
    if (targets.modTag) rows.push(['代码标签：', targets.modTag]);
    if (notes) rows.push(['说明：', notes]);
    return renderTipTable(rows);
  }

  function renderOriginCell(row: MaterialRow): VNodeChild {
    const { kind, source } = row.record.origin;
    const showNamedSource = kind === 'mod' || kind === 'fiction';
    const labelNodes: VNodeChild[] = [];

    if (showNamedSource) {
      labelNodes.push(
        h(
          NTag,
          { size: 'tiny', bordered: false, type: kind === 'mod' ? 'info' : 'warning' },
          { default: () => (kind === 'mod' ? 'Mod' : '作品') },
        ),
        h('span', { class: 'kb-origin-name', title: source }, source),
      );
    } else {
      labelNodes.push(
        h(
          NTag,
          { size: 'tiny', bordered: false, type: kind === 'minecraft' ? 'success' : 'default' },
          { default: () => ORIGIN_KIND_LABELS[kind] },
        ),
      );
    }

    const helpCircle = h(
      NTooltip,
      { trigger: 'hover', placement: 'top', style: { maxWidth: '460px' } },
      {
        trigger: () => h('span', { class: 'kb-help-circle', 'aria-label': '来源说明' }, '?'),
        default: () => summarizeOriginTooltip(row),
      },
    );

    return h('div', { class: 'kb-origin-cell' }, [...labelNodes, helpCircle]);
  }

  function groupUniqueCorpus(entries: readonly CorpusKeyValue[]): Array<{ entry: CorpusKeyValue; keys: string[] }> {
    const map = new Map<string, { entry: CorpusKeyValue; keys: string[] }>();
    for (const entry of entries) {
      const existing = map.get(entry.value);
      if (existing) {
        existing.keys.push(entry.key);
      } else {
        map.set(entry.value, { entry, keys: [entry.key] });
      }
    }
    return [...map.values()];
  }

  function findLegacyMatchForCorpus(
    target: 'GT6' | 'GT6CE',
    value: string,
    legacy: readonly LegacyTermEntry[],
  ): LegacyTermEntry | undefined {
    const sourceId = target === 'GT6' ? 'gt6-lang' : 'gt6ce-lang';
    return legacy.find((entry) => entry.source === sourceId && entry.text === value);
  }

  function buildCorpusPillTooltip(
    target: 'GT6' | 'GT6CE',
    statusLabel: string,
    value: string,
    keySummary: string,
    legacyMatch?: LegacyTermEntry,
  ): VNodeChild {
    const rows: Array<[string, VNodeChild]> = [
      ['语料：', target],
      ['状态：', statusLabel],
      ['译名：', value],
      ['键名：', keySummary],
    ];
    if (legacyMatch) {
      rows.push(['登记：', LEGACY_STATUS_LABELS[legacyMatch.status]]);
      if (legacyMatch.note) rows.push(['说明：', legacyMatch.note]);
    }
    return renderTipTable(rows);
  }

  function renderCorpusTargetLine(
    target: 'GT6' | 'GT6CE',
    entries: readonly CorpusKeyValue[],
    multiSplit: boolean,
    mode: CorpusDisplayMode,
    legacy: readonly LegacyTermEntry[],
    emptyState?: { symbol: '×' | 'missing'; text: string; tooltip: VNodeChild },
  ): VNodeChild {
    const isFull = mode === 'full';

    if (entries.length === 0) {
      if (!emptyState) return null;
      if (emptyState.symbol === '×') {
        if (!isFull) return null;
        return h('div', { class: 'kb-corpus-line' }, [
          h('span', { class: 'kb-corpus-label' }, `${target}:`),
          renderPill('×', 'kb-pill--removed', emptyState.tooltip),
        ]);
      }
      return h('div', { class: 'kb-corpus-line' }, [
        h('span', { class: 'kb-corpus-label' }, `${target}:`),
        renderPill(emptyState.text, 'kb-pill--untranslated', emptyState.tooltip),
      ]);
    }

    const allSame = entries.every((entry) => entry.sameAsCanonical);
    if (allSame && !multiSplit) {
      if (!isFull) return null;
      const val = entries[0]?.value ?? '';
      const keys = entries.map((e) => e.key).join(', ');
      return h('div', { class: 'kb-corpus-line' }, [
        h('span', { class: 'kb-corpus-label' }, `${target}:`),
        renderPill('=', 'kb-pill--same', buildCorpusPillTooltip(target, '与现行一致', val, keys)),
      ]);
    }

    const grouped = groupUniqueCorpus(entries);
    const pills: VNodeChild[] = [];
    for (const { entry, keys } of grouped) {
      const keySummary = keys.join(', ');
      const legacyMatch = findLegacyMatchForCorpus(target, entry.value, legacy);
      if (multiSplit) {
        const cls = entry.sameAsCanonical ? 'kb-pill--split-match' : 'kb-pill--split';
        const tip = buildCorpusPillTooltip(target, '多键分裂', entry.value, keySummary, legacyMatch);
        pills.push(renderPill(entry.value, cls, tip));
      } else if (entry.sameAsCanonical) {
        if (isFull) {
          pills.push(
            renderPill('=', 'kb-pill--same', buildCorpusPillTooltip(target, '与现行一致', entry.value, keySummary)),
          );
        }
      } else if (entry.pureSuffixDiff) {
        pills.push(
          renderPill(
            entry.value,
            'kb-pill--suffix',
            buildCorpusPillTooltip(target, '仅后缀差', entry.value, keySummary, legacyMatch),
          ),
        );
      } else if (target === 'GT6CE') {
        pills.push(
          renderPill(
            entry.value,
            'kb-pill--ce-diff',
            buildCorpusPillTooltip(target, 'GT6CE 不一致', entry.value, keySummary, legacyMatch),
          ),
        );
      } else {
        pills.push(
          renderPill(
            entry.value,
            'kb-pill--gt6-diff',
            buildCorpusPillTooltip(target, 'GT6 不一致', entry.value, keySummary, legacyMatch),
          ),
        );
      }
    }

    if (pills.length === 0) return null;
    return h('div', { class: 'kb-corpus-line' }, [h('span', { class: 'kb-corpus-label' }, `${target}:`), ...pills]);
  }

  function isLegacyCoveredByCorpus(entry: LegacyTermEntry, row: KbRow): boolean {
    if (entry.source === 'gt6-lang') {
      return row.corpus.gt6.some((item) => item.value === entry.text);
    }
    if (entry.source === 'gt6ce-lang') {
      return row.corpus.gt6ce.some((item) => item.value === entry.text);
    }
    return false;
  }

  function renderCorpusCell(row: KbRow): VNodeChild {
    const mode = corpusMode.value;
    const legacy = row.record.zh.legacy ?? [];
    const nodes: VNodeChild[] = [];

    const gt6Node = renderCorpusTargetLine('GT6', row.corpus.gt6, row.corpus.gt6MultiSplit, mode, legacy);
    if (gt6Node) nodes.push(gt6Node);

    let ceEmpty: { symbol: '×' | 'missing'; text: string; tooltip: VNodeChild } | undefined;
    if (row.kind === 'material') {
      const status = row.record.targets.gt6ce;
      if (status === 'removed') {
        ceEmpty = { symbol: '×', text: '×', tooltip: renderTipTable([['状态：', 'GT6CE 已移除此材料']]) };
      } else if (status === 'legacy-only') {
        ceEmpty = { symbol: '×', text: '×', tooltip: renderTipTable([['状态：', '仅 GT6，GT6CE 未收录']]) };
      } else if (row.record.variantOf && (row.record.keys.gt6ce?.length ?? 0) === 0) {
        ceEmpty = undefined;
      } else if (row.corpus.gt6ce.length === 0 && gt6ceLoaded.value) {
        ceEmpty = {
          symbol: 'missing',
          text: '未译',
          tooltip: renderTipTable([['状态：', 'GT6CE 标记为已收录，但语料中缺失中文译文']]),
        };
      }
    } else if ((row.record.keys?.gt6ce?.length ?? 0) > 0 && row.corpus.gt6ce.length === 0 && gt6ceLoaded.value) {
      ceEmpty = {
        symbol: 'missing',
        text: '未译',
        tooltip: renderTipTable([['状态：', 'GT6CE 语料中缺失该键译文']]),
      };
    }

    const ceNode = renderCorpusTargetLine('GT6CE', row.corpus.gt6ce, row.corpus.gt6ceMultiSplit, mode, legacy, ceEmpty);
    if (ceNode) nodes.push(ceNode);

    // 历史/候选译名按具体来源分组展示，不再与实时 GT6/GT6CE 行重复
    const bySource = new Map<string, LegacyTermEntry[]>();
    for (const entry of legacy) {
      if (isLegacyCoveredByCorpus(entry, row)) continue;
      const list = bySource.get(entry.source) ?? [];
      list.push(entry);
      bySource.set(entry.source, list);
    }

    for (const [source, items] of bySource) {
      const sourceLabel = formatLegacySource(source);
      nodes.push(
        h('div', { class: 'kb-corpus-line' }, [
          h('span', { class: 'kb-corpus-label' }, `${sourceLabel}:`),
          ...items.map((entry) => {
            const pillCls =
              entry.status === 'rejected'
                ? 'kb-pill--legacy-rejected'
                : entry.status === 'proposed'
                  ? 'kb-pill--legacy-proposed'
                  : 'kb-pill--legacy';
            const rows: Array<[string, VNodeChild]> = [
              ['来源：', sourceLabel],
              ['状态：', LEGACY_STATUS_LABELS[entry.status]],
              ['译名：', entry.text],
            ];
            if (entry.note) rows.push(['备注：', entry.note]);
            return renderPill(entry.text, pillCls, renderTipTable(rows));
          }),
        ]),
      );
    }

    if (nodes.length === 0) {
      return h('span', { class: 'muted' }, '—');
    }
    return h('div', { class: 'kb-corpus-cell' }, nodes);
  }

  function renderReviewActions(row: KbRow): VNodeChild {
    const issue = getIssue(row.kind, row.id);
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
            secondary: Boolean(issue),
            quaternary: !issue,
            type: issue ? 'error' : 'default',
            onClick: () => toggleIssue(row.kind, row.id),
          },
          { default: () => (issue ? '已标记' : '标记') },
        ),
      ]),
    ];
    if (issue?.suggestedZh || issue?.comment) {
      const hint = [issue.suggestedZh ? `建议：${issue.suggestedZh}` : '', issue.comment].filter(Boolean).join(' · ');
      children.push(h('div', { class: 'kb-note-preview', title: hint }, hint));
    }
    return h('div', { class: 'kb-action-cell' }, children);
  }

  const materialColumns: DataTableColumns<MaterialRow> = [
    {
      title: '名称 / 英文',
      key: 'en',
      width: '21%',
      sorter: (left, right) => left.record.en.canonical.localeCompare(right.record.en.canonical, 'en'),
      render: (row) =>
        h('div', { class: 'kb-primary-cell' }, [
          h('div', [renderEnName(row.record.en)]),
          h('div', { class: 'kb-meta-line muted' }, [h('span', { class: 'kb-mono' }, row.id)]),
        ]),
    },
    {
      title: '现行规范中文',
      key: 'zh',
      width: '15%',
      sorter: (left, right) => left.record.zh.canonical.localeCompare(right.record.zh.canonical, 'zh-CN'),
      render: (row) => renderZhCell(row),
    },
    {
      title: '类别',
      key: 'category',
      width: '9%',
      sorter: (left, right) =>
        CATEGORY_LABELS[left.record.category].localeCompare(CATEGORY_LABELS[right.record.category], 'zh-CN'),
      render: (row) =>
        h(NTag, { size: 'tiny', bordered: false }, { default: () => CATEGORY_LABELS[row.record.category] }),
    },
    {
      title: '来源',
      key: 'origin',
      width: '16%',
      sorter: (left, right) =>
        `${left.record.origin.kind}:${left.record.origin.source}`.localeCompare(
          `${right.record.origin.kind}:${right.record.origin.source}`,
          'zh-CN',
        ),
      render: (row) => renderOriginCell(row),
    },
    {
      title: 'GT6 / GT6CE 语料对照',
      key: 'corpus',
      width: '27%',
      render: (row) => renderCorpusCell(row),
    },
    {
      title: '操作',
      key: 'actions',
      width: '12%',
      render: (row) => renderReviewActions(row),
    },
  ];

  function createTermOrEntityColumns<T extends GlossaryRow | EntityRow>(
    domainTitle: string,
    domainLabel: (row: T) => string,
  ): DataTableColumns<T> {
    return [
      {
        title: '名称 / 英文',
        key: 'en',
        width: '24%',
        sorter: (left, right) => left.record.en.canonical.localeCompare(right.record.en.canonical, 'en'),
        render: (row) =>
          h('div', { class: 'kb-primary-cell' }, [
            h('div', [renderEnName(row.record.en)]),
            h('div', { class: 'kb-meta-line muted' }, [h('span', { class: 'kb-mono' }, row.id)]),
          ]),
      },
      {
        title: '现行规范中文',
        key: 'zh',
        width: '17%',
        sorter: (left, right) => left.record.zh.canonical.localeCompare(right.record.zh.canonical, 'zh-CN'),
        render: (row) => renderZhCell(row),
      },
      {
        title: domainTitle,
        key: 'domain',
        width: '12%',
        sorter: (left, right) => domainLabel(left).localeCompare(domainLabel(right), 'zh-CN'),
        render: (row) => h(NTag, { size: 'tiny', bordered: false }, { default: () => domainLabel(row) }),
      },
      {
        title: 'GT6 / GT6CE 语料对照',
        key: 'corpus',
        width: '34%',
        render: (row) => renderCorpusCell(row),
      },
      {
        title: '操作',
        key: 'actions',
        width: '13%',
        render: (row) => renderReviewActions(row),
      },
    ];
  }

  const glossaryColumns = createTermOrEntityColumns<GlossaryRow>('术语域', (row) => DOMAIN_LABELS[row.record.domain]);
  const entityColumns = createTermOrEntityColumns<EntityRow>(
    '对象域',
    (row) => ENTITY_DOMAIN_LABELS[row.record.domain],
  );

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
    const md = exportReviewMarkdown(reviewIssues.value, bundle.knowledgeBase, gt6Map.value, gt6ceMap.value);
    downloadText('kb-review-issues.md', md);
    message.success(`已导出标记清单（${issueCount.value} 条）`);
  }

  async function handleCopyMarkdown(): Promise<void> {
    if (!bundle.knowledgeBase) return;
    const md = exportReviewMarkdown(reviewIssues.value, bundle.knowledgeBase, gt6Map.value, gt6ceMap.value);
    try {
      await navigator.clipboard.writeText(md);
      message.success(`已复制标记清单到剪贴板（${issueCount.value} 条）`);
    } catch {
      downloadText('kb-review-issues.md', md);
      message.info('剪贴板不可用，已改为下载 kb-review-issues.md');
    }
  }

  function handleClearAllIssues(): void {
    reviewIssues.value = {};
    message.success('已清空标记清单');
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

  const KEY_STATUS_LABELS: Record<'same' | 'suffix' | 'legacy' | 'diff' | 'none', string> = {
    same: '与现行一致',
    suffix: '仅后缀差',
    legacy: '已登记旧译',
    diff: '与现行不一致',
    none: '未载入/无值',
  };

  const drawerKeyRows = computed(() => {
    const row = selectedRow.value;
    if (!row) return [];
    const keys = row.record.keys;
    const legacy = row.record.zh.legacy ?? [];
    const items: Array<{
      target: 'GT6' | 'GT6CE' | 'GT6_w';
      key: string;
      corpusZh: string;
      status: 'same' | 'suffix' | 'legacy' | 'diff' | 'none';
      note?: string;
    }> = [];

    for (const key of keys?.gt6 ?? []) {
      const found = row.corpus.gt6.find((entry) => entry.key === key);
      const matched = found ? findLegacyMatchForCorpus('GT6', found.value, legacy) : undefined;
      items.push({
        target: 'GT6',
        key,
        corpusZh: found ? found.value : '—',
        status: !found
          ? 'none'
          : found.sameAsCanonical
            ? 'same'
            : found.pureSuffixDiff
              ? 'suffix'
              : found.inLegacy
                ? 'legacy'
                : 'diff',
        note: matched?.status === 'rejected' ? '不采用' : matched?.note,
      });
    }
    for (const key of keys?.gt6ce ?? []) {
      const found = row.corpus.gt6ce.find((entry) => entry.key === key);
      const matched = found ? findLegacyMatchForCorpus('GT6CE', found.value, legacy) : undefined;
      items.push({
        target: 'GT6CE',
        key,
        corpusZh: found ? found.value : gt6ceLoaded.value ? '（未译或缺失）' : '（未载入语料）',
        status: !found
          ? 'none'
          : found.sameAsCanonical
            ? 'same'
            : found.pureSuffixDiff
              ? 'suffix'
              : found.inLegacy
                ? 'legacy'
                : 'diff',
        note: matched?.status === 'rejected' ? '不采用' : matched?.note,
      });
    }
    for (const key of keys?.gt6w ?? []) {
      items.push({ target: 'GT6_w', key, corpusZh: '—', status: 'none' });
    }
    return items;
  });

  const drawerExtraLegacyRows = computed(() => {
    const row = selectedRow.value;
    if (!row) return [];
    return (row.record.zh.legacy ?? [])
      .filter((entry) => !isLegacyCoveredByCorpus(entry, row))
      .map((entry) => ({
        ...entry,
        sourceLabel: formatLegacySource(entry.source),
      }));
  });

  function refLabel(id: string): string {
    const target = bundle.lookupById.get(id);
    if (!target) return id;
    return `${target.enLabel} · ${target.zhLabel}`;
  }
</script>

<template>
  <div class="page">
    <input ref="gt6ceFileInput" type="file" accept=".json,application/json" hidden @change="onImportGt6ceFile" />

    <n-alert v-if="bundle.loadIssues.length > 0" type="error" class="section" title="知识库加载失败">
      <div v-for="(issue, index) in bundle.loadIssues" :key="index" class="kb-mono">
        {{ issue.source }}:{{ issue.line }} {{ issue.message }}
      </div>
    </n-alert>

    <template v-else-if="bundle.knowledgeBase && bundle.report">
      <!-- Box 1：信息与导入 / 标记导出 -->
      <n-card size="small" class="kb-box">
        <div class="kb-box-stack">
          <div class="kb-box-row kb-box-row--between">
            <div class="kb-box-group">
              <span class="kb-box-label">数据统计</span>
              <n-tag size="small" type="info">材料 {{ bundle.report.stats.materials }}</n-tag>
              <n-tag size="small" type="info">术语 {{ bundle.report.stats.glossary }}</n-tag>
              <n-tag size="small" type="info">对象 {{ bundle.report.stats.entities }}</n-tag>
              <n-tag size="small" :type="bundle.report.errors.length === 0 ? 'success' : 'error'">
                校验 {{ bundle.report.errors.length }} err / {{ bundle.report.warnings.length }} warn
              </n-tag>
            </div>

            <div class="kb-box-group">
              <n-tag size="small" :type="issueCount > 0 ? 'error' : 'default'">已标记 {{ issueCount }}</n-tag>
              <n-button size="tiny" type="primary" :disabled="issueCount === 0" @click="handleCopyMarkdown">
                复制标记 MD
              </n-button>
              <n-button size="tiny" :disabled="issueCount === 0" @click="handleExportMarkdown">导出 MD</n-button>
              <n-popconfirm @positive-click="handleClearAllIssues">
                <template #trigger>
                  <n-button size="tiny" quaternary type="error" :disabled="issueCount === 0">清空</n-button>
                </template>
                确定清空当前标记清单？
              </n-popconfirm>
            </div>
          </div>

          <div class="kb-box-row">
            <span class="kb-box-label">语料导入</span>
            <n-tag size="small" :type="bundle.defaultCorpus.gt6Available ? 'success' : 'warning'">
              GT6 {{ Object.keys(gt6Map).length }} 键
            </n-tag>
            <n-tag size="small" :type="gt6ceLoaded ? 'success' : 'warning'" :title="gt6ceSourceLabel">
              GT6CE {{ gt6ceLoaded ? `${Object.keys(gt6ceMap).length} 键` : '未载入' }}
            </n-tag>
            <n-button size="tiny" secondary @click="triggerImportGt6ce">导入 GT6CE zh_cn.json</n-button>
            <span v-if="customGt6ceLabel" class="muted">{{ customGt6ceLabel }}</span>
          </div>
        </div>
      </n-card>

      <!-- Box 2：视图与筛选 -->
      <n-card size="small" class="kb-box">
        <div class="kb-box-stack">
          <div class="kb-box-row kb-box-row--between">
            <div class="kb-box-group">
              <span class="kb-box-label">数据视图</span>
              <n-radio-group v-model:value="subView" size="small">
                <n-radio-button value="materials">材料 ({{ materialRows.length }})</n-radio-button>
                <n-radio-button value="entities">物品与机器 ({{ entityRows.length }})</n-radio-button>
                <n-radio-button value="glossary">规则术语 ({{ glossaryRows.length }})</n-radio-button>
                <n-radio-button value="derivations">
                  派生族与占位 ({{
                    bundle.knowledgeBase.derivations.families.length +
                    (bundle.knowledgeBase.entityDerivations?.families.length ?? 0)
                  }}
                  +
                  {{
                    bundle.knowledgeBase.derivations.internalPlaceholders.length +
                    (bundle.knowledgeBase.entityDerivations?.internalPlaceholders.length ?? 0)
                  }})
                </n-radio-button>
              </n-radio-group>

              <n-radio-group v-if="subView !== 'derivations'" v-model:value="corpusMode" size="small">
                <n-radio-button value="compact">简洁模式</n-radio-button>
                <n-radio-button value="full">完全模式</n-radio-button>
              </n-radio-group>
            </div>

            <span v-if="subView !== 'derivations'" class="muted">
              当前显示
              <strong>{{ activeRows.length }}</strong>
              / {{ tabStats.total }} 条
            </span>
          </div>

          <template v-if="subView !== 'derivations'">
            <div class="kb-box-divider" />

            <div class="kb-box-row">
              <span class="kb-box-label">降噪</span>
              <n-checkbox v-model:checked="hideConsistent" size="small">
                隐藏语料一致项
                <span class="muted">({{ tabStats.consistent }})</span>
              </n-checkbox>
              <span v-if="hasActiveSearch && hideConsistent" class="muted kb-search-hint">
                （搜索时自动包含一致项）
              </span>
              <n-checkbox v-model:checked="hidePureSuffix" size="small">
                隐藏纯后缀差
                <span class="muted">({{ tabStats.pureSuffix }})</span>
              </n-checkbox>
            </div>

            <div class="kb-box-row">
              <span class="kb-box-label">筛选条件</span>
              <button
                v-for="item in problemOptions"
                :key="item.id"
                type="button"
                :title="problemFilter === item.id ? '再次点击取消筛选' : `点击筛选「${item.label}」`"
                :class="['kb-pill', item.cls, 'kb-legend-btn', { 'kb-legend-btn--active': problemFilter === item.id }]"
                @click="toggleProblemFilter(item.id)"
              >
                {{ item.label }} ({{ item.count }})
              </button>
              <span v-if="corpusMode === 'full'" class="kb-pill kb-pill--same">= 一致</span>
              <span v-if="corpusMode === 'full'" class="kb-pill kb-pill--removed">× 已移除/未收录</span>
              <span class="kb-box-sublabel">其他</span>
              <button
                v-for="item in otherFilterOptions.filter((option) => option.show)"
                :key="item.id"
                type="button"
                :title="
                  otherFilters.includes(item.id)
                    ? `${item.hint}（再次点击取消；可与问题筛选叠加）`
                    : `${item.hint}（可与问题筛选正交叠加）`
                "
                :class="['kb-other-btn', { 'kb-other-btn--active': otherFilters.includes(item.id) }]"
                @click="toggleOtherFilter(item.id)"
              >
                {{ item.label }} ({{ item.count }})
              </button>
            </div>

            <div class="kb-box-row">
              <span class="kb-box-label">检索</span>
              <n-input
                v-model:value="search"
                size="small"
                clearable
                placeholder="搜索 id / 英文 / 中文 / 后缀 / 别名 / 语言键 / 语料现值 / 批注"
                style="width: 340px"
              />

              <template v-if="subView === 'materials'">
                <n-select
                  v-model:value="categoryFilter"
                  size="small"
                  clearable
                  placeholder="类别"
                  :options="categoryOptions"
                  style="width: 110px"
                />
                <n-select
                  v-model:value="originKindFilter"
                  size="small"
                  clearable
                  placeholder="出处"
                  :options="originKindOptions"
                  style="width: 115px"
                />
                <n-select
                  v-model:value="evidenceFilter"
                  size="small"
                  clearable
                  placeholder="证据"
                  :options="evidenceOptions"
                  style="width: 100px"
                />
              </template>

              <n-select
                v-else-if="subView === 'glossary'"
                v-model:value="glossaryDomainFilter"
                size="small"
                clearable
                placeholder="术语域"
                :options="glossaryDomainOptions"
                style="width: 130px"
              />

              <n-select
                v-else
                v-model:value="entityDomainFilter"
                size="small"
                clearable
                placeholder="对象域"
                :options="entityDomainOptions"
                style="width: 130px"
              />

              <n-button size="small" quaternary @click="resetFilters">重置筛选</n-button>
            </div>
          </template>
        </div>
      </n-card>

      <template v-if="subView !== 'derivations'">
        <n-data-table
          v-if="subView === 'materials'"
          class="kb-table"
          size="small"
          :bordered="true"
          :striped="true"
          :columns="materialColumns"
          :data="filteredMaterials"
          :row-key="(row: MaterialRow) => row.id"
          :pagination="pagination"
        />

        <n-data-table
          v-else-if="subView === 'glossary'"
          class="kb-table"
          size="small"
          :bordered="true"
          :striped="true"
          :columns="glossaryColumns"
          :data="filteredGlossary"
          :row-key="(row: GlossaryRow) => row.id"
          :pagination="pagination"
        />

        <n-data-table
          v-else
          class="kb-table"
          size="small"
          :bordered="true"
          :striped="true"
          :columns="entityColumns"
          :data="filteredEntities"
          :row-key="(row: EntityRow) => row.id"
          :pagination="pagination"
        />
      </template>

      <template v-else>
        <template
          v-for="sec in [
            { title: '材料规则派生族', config: bundle.knowledgeBase.derivations },
            ...(bundle.knowledgeBase.entityDerivations
              ? [{ title: '物品与机器派生族', config: bundle.knowledgeBase.entityDerivations }]
              : []),
          ]"
          :key="sec.title"
        >
          <div class="section-title">{{ sec.title }}（{{ sec.config.families.length }}）</div>
          <div class="kb-card-grid">
            <n-card v-for="family in sec.config.families" :key="family.id" size="small" :title="family.id">
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
            {{ sec.title }} — 内部占位与非实体键（{{ sec.config.internalPlaceholders.length }}）
          </div>
          <n-card size="small" class="section">
            <n-descriptions :column="1" size="small" label-placement="left" bordered>
              <n-descriptions-item
                v-for="(item, index) in sec.config.internalPlaceholders"
                :key="index"
                :label="
                  item.keys.length > 6
                    ? `${item.keys.slice(0, 6).join(', ')} 等 ${item.keys.length} 键`
                    : item.keys.join(', ')
                "
              >
                {{ item.reason }}
              </n-descriptions-item>
            </n-descriptions>
          </n-card>
        </template>
      </template>
    </template>

    <n-empty v-else description="知识库未加载" />

    <n-drawer v-model:show="drawerVisible" :width="740" placement="right">
      <n-drawer-content v-if="selectedRow" closable>
        <template #header>
          <div class="kb-drawer-head">
            <div class="kb-drawer-title-wrap">
              <div class="kb-drawer-title">
                {{ selectedRow.record.en.canonical }}
                <span v-if="selectedRow.record.en.suffix" class="kb-suffix">({{ selectedRow.record.en.suffix }})</span>
                /
                {{ selectedRow.record.zh.canonical }}
                <span v-if="selectedRow.record.zh.suffix" class="kb-suffix">
                  （{{ selectedRow.record.zh.suffix }}）
                </span>
              </div>
              <div class="kb-drawer-subtitle">
                <n-tag size="tiny" type="info">{{ KIND_LABELS[selectedRow.kind] }}</n-tag>
                <span class="kb-mono muted">{{ selectedRow.id }}</span>
                <n-tag v-if="selectedRow.kind === 'material'" size="tiny" :bordered="false">
                  {{ CATEGORY_LABELS[selectedRow.record.category] }}
                </n-tag>
                <n-tag v-else-if="selectedRow.kind === 'glossary'" size="tiny" :bordered="false">
                  {{ DOMAIN_LABELS[selectedRow.record.domain] }}
                </n-tag>
                <n-tag v-else size="tiny" :bordered="false">
                  {{ ENTITY_DOMAIN_LABELS[selectedRow.record.domain] }}
                </n-tag>
                <n-tag
                  v-if="selectedRow.kind === 'material'"
                  size="tiny"
                  :type="selectedRow.record.targets.gt6ce === 'active' ? 'success' : 'default'"
                >
                  GT6CE {{ GT6CE_STATUS_LABELS[selectedRow.record.targets.gt6ce] }}
                </n-tag>
              </div>
            </div>
            <n-space size="small" align="center" class="kb-drawer-nav">
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

        <n-alert v-if="selectedRow.hasUnicodeRisk" type="warning" class="section" title="Unicode 扩展区 / 缺字风险">
          <div v-for="item in selectedRow.unicodeRisks" :key="item.codePoint">
            <strong>{{ item.char }}</strong>
            （
            <span class="kb-mono">{{ item.codePoint }}</span>
            ）· {{ item.block }}：{{ item.reason }}
          </div>
        </n-alert>

        <n-alert
          v-for="(issue, index) in selectedRow.issues"
          :key="index"
          :type="issue.severity === 'error' ? 'error' : 'warning'"
          class="section"
        >
          [{{ issue.code }}] {{ issue.message }}
        </n-alert>

        <div class="section-title">基础信息</div>
        <n-descriptions :column="2" size="small" bordered label-placement="left" class="section">
          <n-descriptions-item label="英文规范名">
            {{ selectedRow.record.en.canonical }}
            <span v-if="selectedRow.record.en.suffix" class="kb-suffix">({{ selectedRow.record.en.suffix }})</span>
          </n-descriptions-item>
          <n-descriptions-item label="现行规范中文">
            {{ selectedRow.record.zh.canonical }}
            <span v-if="selectedRow.record.zh.suffix" class="kb-suffix">（{{ selectedRow.record.zh.suffix }}）</span>
          </n-descriptions-item>
          <n-descriptions-item v-if="selectedRow.record.en.aliases?.length" label="英文别名" :span="2">
            {{ selectedRow.record.en.aliases.join(', ') }}
          </n-descriptions-item>
          <n-descriptions-item v-if="selectedRow.record.zh.aliases?.length" label="中文别名" :span="2">
            {{ selectedRow.record.zh.aliases.join('、') }}
          </n-descriptions-item>

          <template v-if="selectedRow.kind === 'material'">
            <n-descriptions-item label="类别">
              {{ CATEGORY_LABELS[selectedRow.record.category] }}
              <span class="muted">({{ selectedRow.record.category }})</span>
            </n-descriptions-item>
            <n-descriptions-item label="形态">{{ selectedRow.record.states.join(', ') }}</n-descriptions-item>
            <n-descriptions-item v-if="selectedRow.record.composition" label="组成" :span="2">
              <div class="kb-comp-main">
                <span class="kb-strong">{{ selectedRow.record.composition.formula }}</span>
                <n-tag size="tiny" :bordered="false">{{ selectedRow.record.composition.source }}</n-tag>
              </div>
              <div v-if="selectedRow.record.composition.gt6" class="kb-subline muted">
                GT6 记法：
                <span class="kb-mono">{{ selectedRow.record.composition.gt6 }}</span>
              </div>
              <div v-if="selectedRow.record.composition.note" class="kb-subline muted">
                {{ selectedRow.record.composition.note }}
              </div>
            </n-descriptions-item>
            <n-descriptions-item v-if="selectedRow.record.traits?.length" label="特征">
              {{ selectedRow.record.traits.join(', ') }}
            </n-descriptions-item>
          </template>

          <template v-else-if="selectedRow.kind === 'glossary'">
            <n-descriptions-item label="术语域" :span="2">
              {{ DOMAIN_LABELS[selectedRow.record.domain] }}
              <span class="muted">({{ selectedRow.record.domain }})</span>
            </n-descriptions-item>
          </template>

          <template v-else>
            <n-descriptions-item label="对象域" :span="2">
              {{ ENTITY_DOMAIN_LABELS[selectedRow.record.domain] }}
              <span class="muted">({{ selectedRow.record.domain }})</span>
            </n-descriptions-item>
          </template>

          <n-descriptions-item v-if="selectedRow.record.allowSameZhReason" label="允许同名理由" :span="2">
            {{ selectedRow.record.allowSameZhReason }}
          </n-descriptions-item>
        </n-descriptions>

        <template
          v-if="selectedRow.kind === 'material' || selectedRow.record.seeAlso?.length || selectedRow.record.notes"
        >
          <div class="section-title">出处、收录与关联</div>
          <n-descriptions :column="2" size="small" bordered label-placement="left" class="section">
            <template v-if="selectedRow.kind === 'material'">
              <n-descriptions-item label="来源类型">
                {{ ORIGIN_KIND_LABELS[selectedRow.record.origin.kind] }}
              </n-descriptions-item>
              <n-descriptions-item label="证据等级">
                {{ EVIDENCE_LABELS[selectedRow.record.origin.evidence] }}
              </n-descriptions-item>
              <n-descriptions-item label="首创出处">
                {{ selectedRow.record.origin.source }}
              </n-descriptions-item>
              <n-descriptions-item label="GT6CE 收录">
                {{ GT6CE_STATUS_LABELS[selectedRow.record.targets.gt6ce] }}
                <span v-if="selectedRow.record.targets.numericId !== undefined" class="muted">
                  · ID {{ selectedRow.record.targets.numericId }}
                </span>
                <span v-if="selectedRow.record.targets.modTag" class="muted">
                  · {{ selectedRow.record.targets.modTag }}
                </span>
              </n-descriptions-item>
              <n-descriptions-item v-if="selectedRow.record.origin.alsoIn?.length" label="也见于" :span="2">
                {{ selectedRow.record.origin.alsoIn.join('、') }}
              </n-descriptions-item>
              <n-descriptions-item v-if="selectedRow.record.targets.mtRef" label="代码位置" :span="2">
                <a :href="selectedRow.record.targets.mtRef" target="_blank" rel="noopener noreferrer">
                  打开 MT.java 参考
                </a>
              </n-descriptions-item>
              <n-descriptions-item v-if="selectedRow.record.variantOf" label="所属主材料" :span="2">
                <n-tag size="small" type="success" class="preset" @click="jumpToId(selectedRow.record.variantOf)">
                  {{ refLabel(selectedRow.record.variantOf) }} ({{ selectedRow.record.variantOf }})
                </n-tag>
              </n-descriptions-item>
              <n-descriptions-item v-if="selectedRow.childVariantIds.length > 0" label="形态变体" :span="2">
                <div class="kb-tag-wrap">
                  <n-tag
                    v-for="childId in selectedRow.childVariantIds"
                    :key="childId"
                    size="small"
                    type="success"
                    class="preset"
                    @click="jumpToId(childId)"
                  >
                    {{ refLabel(childId) }} ({{ childId }})
                  </n-tag>
                </div>
              </n-descriptions-item>
              <n-descriptions-item v-if="selectedRow.record.origin.urls?.length" label="外部信源" :span="2">
                <div v-for="url in selectedRow.record.origin.urls" :key="url" class="kb-link-line">
                  <a :href="url" target="_blank" rel="noopener noreferrer">{{ url }}</a>
                </div>
              </n-descriptions-item>
            </template>

            <n-descriptions-item v-if="selectedRow.record.seeAlso?.length" label="关联词条" :span="2">
              <div class="kb-tag-wrap">
                <n-tag
                  v-for="refId in selectedRow.record.seeAlso"
                  :key="refId"
                  size="small"
                  type="info"
                  class="preset"
                  @click="jumpToId(refId)"
                >
                  {{ refLabel(refId) }} ({{ refId }})
                </n-tag>
              </div>
            </n-descriptions-item>

            <n-descriptions-item v-if="selectedRow.record.notes" label="备注" :span="2">
              {{ selectedRow.record.notes }}
            </n-descriptions-item>
          </n-descriptions>
        </template>

        <div class="section-title">逐键语料对照</div>
        <n-card size="small" class="section" content-style="padding: 0">
          <div v-if="drawerKeyRows.length === 0" style="padding: 10px 12px" class="muted">无登记语言键</div>
          <table v-else class="kb-detail-table">
            <thead>
              <tr>
                <th>语料</th>
                <th>语言键</th>
                <th>当前译名</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in drawerKeyRows" :key="`${item.target}:${item.key}`">
                <td>
                  <n-tag size="tiny" :type="item.target === 'GT6CE' ? 'info' : 'default'">{{ item.target }}</n-tag>
                </td>
                <td>
                  <span class="kb-mono">{{ item.key }}</span>
                </td>
                <td>{{ item.corpusZh }}</td>
                <td>
                  <n-tag
                    size="tiny"
                    :type="
                      item.status === 'same'
                        ? 'success'
                        : item.status === 'suffix'
                          ? 'info'
                          : item.status === 'legacy'
                            ? 'warning'
                            : item.status === 'diff'
                              ? 'error'
                              : 'default'
                    "
                  >
                    {{ KEY_STATUS_LABELS[item.status] }}
                  </n-tag>
                  <span v-if="item.note" class="muted">· {{ item.note }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </n-card>

        <template v-if="drawerExtraLegacyRows.length > 0">
          <div class="section-title">其他历史 / 候选记录</div>
          <n-card size="small" class="section" content-style="padding: 0">
            <table class="kb-detail-table">
              <thead>
                <tr>
                  <th>来源</th>
                  <th>状态</th>
                  <th>译名</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(entry, index) in drawerExtraLegacyRows" :key="index">
                  <td>{{ entry.sourceLabel }}</td>
                  <td>
                    <n-tag
                      size="tiny"
                      :type="entry.status === 'rejected' ? 'error' : entry.status === 'proposed' ? 'info' : 'default'"
                    >
                      {{ LEGACY_STATUS_LABELS[entry.status] }}
                    </n-tag>
                  </td>
                  <td class="kb-strong">{{ entry.text }}</td>
                  <td class="muted">{{ entry.note || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </n-card>
        </template>

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
