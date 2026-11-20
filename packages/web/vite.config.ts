import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type Plugin } from 'vite';

const KB_CORPUS_VIRTUAL_ID = 'virtual:gt6tg-kb-corpus';
const KB_CORPUS_RESOLVED_ID = `\0${KB_CORPUS_VIRTUAL_ID}`;

function collectReferencedKeys(jsonlPaths: readonly string[]): { gt6: Set<string>; gt6ce: Set<string> } {
  const gt6 = new Set<string>();
  const gt6ce = new Set<string>();
  for (const filePath of jsonlPaths) {
    if (!existsSync(filePath)) continue;
    for (const line of readFileSync(filePath, 'utf8').split(/\r\n|\n|\r/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const record = JSON.parse(trimmed) as { keys?: { gt6?: string[]; gt6ce?: string[] } };
        for (const key of record.keys?.gt6 ?? []) gt6.add(key);
        for (const key of record.keys?.gt6ce ?? []) gt6ce.add(key);
      } catch {
        // 解析错误由浏览器侧 parseKnowledgeBase 统一展示。
      }
    }
  }
  return { gt6, gt6ce };
}

function extractLegacyZh(langPath: string, wantedKeys: Set<string>): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existsSync(langPath) || wantedKeys.size === 0) return result;
  const content = readFileSync(langPath, 'utf8').replace(/^\uFEFF/, '');
  let started = false;
  for (const line of content.split(/\r\n|\n|\r/)) {
    if (!started) {
      if (line.includes('languagefile')) started = true;
      continue;
    }
    if (line.includes('=')) {
      const eq = line.indexOf('=');
      const rawKey = line.slice(0, eq).trimStart();
      const value = line.slice(eq + 1);
      const cleanKey = rawKey.startsWith('S:') ? rawKey.slice(2) : rawKey;
      if (wantedKeys.has(cleanKey)) result[cleanKey] = value;
      else if (wantedKeys.has(rawKey)) result[rawKey] = value;
    } else if (line.includes('}')) {
      break;
    }
  }
  return result;
}

function extractGt6ceZh(jsonPath: string, wantedKeys: Set<string>): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existsSync(jsonPath) || wantedKeys.size === 0) return result;
  try {
    const parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, unknown>;
    for (const key of wantedKeys) {
      const value = parsed[key];
      if (typeof value === 'string') result[key] = value;
    }
  } catch {
    // 忽略损坏的外部语料文件，界面仍可手动导入。
  }
  return result;
}

/**
 * 构建期/开发期仅提取知识库引用的 GT6 与（可选）GT6CE 现行中文译文，
 * 避免把整份 7 MB legacy .lang 打入前端产物，且在无同级 GT6CE 仓库的 CI 环境下优雅降级。
 */
function kbCorpusPlugin(): Plugin {
  const repoRoot = resolve(import.meta.dirname, '../..');
  const materialsPath = resolve(repoRoot, 'knowledge/materials.jsonl');
  const glossaryPath = resolve(repoRoot, 'knowledge/glossary.jsonl');
  const entitiesPath = resolve(repoRoot, 'knowledge/entities.jsonl');
  const gt6ZhPath = resolve(repoRoot, 'fixtures/legacy-golden/zh/GregTech.lang');
  const gt6ceZhPath = process.env.GT6CE_ZH_LANG
    ? resolve(repoRoot, process.env.GT6CE_ZH_LANG)
    : resolve(repoRoot, '../GregTech6CE/core/src/main/resources/assets/gt6ce/lang/zh_cn.json');

  return {
    name: 'gt6tg-kb-corpus',
    resolveId(id) {
      if (id === KB_CORPUS_VIRTUAL_ID) return KB_CORPUS_RESOLVED_ID;
      return null;
    },
    load(id) {
      if (id !== KB_CORPUS_RESOLVED_ID) return null;
      const wanted = collectReferencedKeys([materialsPath, glossaryPath, entitiesPath]);
      const gt6Available = existsSync(gt6ZhPath);
      const gt6ceAvailable = existsSync(gt6ceZhPath);
      const gt6 = gt6Available ? extractLegacyZh(gt6ZhPath, wanted.gt6) : {};
      const gt6ce = gt6ceAvailable ? extractGt6ceZh(gt6ceZhPath, wanted.gt6ce) : {};
      const snapshot = {
        gt6,
        gt6ce,
        gt6Available,
        gt6ceAvailable,
        gt6Source: gt6Available ? 'fixtures/legacy-golden/zh/GregTech.lang' : null,
        gt6ceSource: gt6ceAvailable ? 'GregTech6CE/core/src/main/resources/assets/gt6ce/lang/zh_cn.json' : null,
      };
      return `export default ${JSON.stringify(snapshot)};\n`;
    },
    configureServer(server) {
      const watchFiles = [materialsPath, glossaryPath, entitiesPath, gt6ZhPath];
      if (existsSync(gt6ceZhPath)) watchFiles.push(gt6ceZhPath);
      server.watcher.add(watchFiles);
      const watchSet = new Set(watchFiles.map((file) => resolve(file).toLowerCase()));
      server.watcher.on('change', (changedPath) => {
        if (!watchSet.has(resolve(changedPath).toLowerCase())) return;
        const mod = server.moduleGraph.getModuleById(KB_CORPUS_RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [vue(), kbCorpusPlugin()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: {
      // 构建期需要读取 packages/node/project.jsonc 作为默认配置。
      allow: [resolve(import.meta.dirname, '../..')],
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    // Naive UI 全量组件会让 main chunk 超过默认 500 kB；本地自测工具不追求拆包。
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      onwarn(warning, warn) {
        // zod v4 的注释位置会触发 Rollup 的 INVALID_ANNOTATION；不影响产物。
        if (warning.code === 'INVALID_ANNOTATION') return;
        warn(warning);
      },
    },
  },
});
