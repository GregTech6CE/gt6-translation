/**
 * 材料与术语知识库（KB）的纯 TypeScript 入口。
 *
 * 数据在 `knowledge/`：`materials.jsonl`、`glossary.jsonl` 与 `material-derivations.json`
 * 是单一事实源；`renderMaterialsMarkdown` 只负责按需导出阅读视图。
 * 本模块不依赖 `node:*`，可直接在浏览器与 worker 中使用。
 */
export * from './loader.ts';
export * from './query.ts';
export * from './reconcile.ts';
export * from './renderMd.ts';
export * from './schema.ts';
export * from './types.ts';
export * from './validate.ts';
