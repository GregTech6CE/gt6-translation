import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * 仓库根目录：优先 `GT6TG_REPO_ROOT`，否则从当前模块向上查找 `rush.json`。
 *
 * 向上查找让 CLI、worker 与测试无论从哪个包目录启动都能拿到同一个根，
 * 不再依赖 `src` 的相对层级。
 */
export function resolveRepoRoot(startDir: string = import.meta.dirname): string {
  const fromEnv = process.env.GT6TG_REPO_ROOT;
  if (fromEnv) return resolve(fromEnv);

  let current = resolve(startDir);
  for (;;) {
    if (existsSync(join(current, 'rush.json'))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`无法从 ${startDir} 向上找到 rush.json；请设置 GT6TG_REPO_ROOT`);
    current = parent;
  }
}

export const repoRoot = resolveRepoRoot();
export const projectFilePath = resolve(repoRoot, 'packages/node/project.jsonc');
/** legacy 目录只允许 legacy 自身（C++ 工具）写入。 */
export const legacyRoot = resolve(repoRoot, 'packages/legacy');
/** 固化后的 legacy golden 基线；LF 明文存放，供 CI 与缺失 workplace 产物时使用。 */
export const legacyGoldenRoot = resolve(repoRoot, 'fixtures/legacy-golden');
/** Node 生成物只能写到这里。 */
export const artifactRoot = resolve(repoRoot, 'packages/node/dist');
/** web 构建产物；由 node 的 dev 任务构建并托管。 */
export const webDistRoot = resolve(repoRoot, 'packages/web/dist');

/** 把仓库相对路径解析成绝对路径，并禁止越界。 */
export function resolveInsideRepo(path: string): string {
  const absolute = isAbsolute(path) ? resolve(path) : resolve(repoRoot, path);
  const relativePath = relative(repoRoot, absolute);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`路径越出仓库根目录：${path}`);
  }
  return absolute;
}

export function repoRelative(absolute: string): string {
  return relative(repoRoot, absolute).replaceAll('\\', '/');
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * 语料路径解析：`fixtures/` 开头的按仓库根解析，其余按 target 的 workplace 解析。
 *
 * 仓库级语料（如 `fixtures/legacy-golden` 下的明文基线）不属于任何 workplace，
 * 必须能脱离 workplace 引用。
 */
export function resolveCorpusPath(workplace: string, path: string): string {
  return resolveInsideRepo(path.startsWith('fixtures/') ? path : join(workplace, path));
}

/**
 * golden 路径：workplace 下的产物优先，缺失时回退到 `fixtures/legacy-golden/<路径>`。
 *
 * 明文基线按 workplace 内的相对路径镜像存放（`en/GregTech.lang`、`zh/GregTech.lang`、
 * `zh/GregTech.unknown.lang`），因此 `workplace/zh/GregTech.lang` 与
 * `GregTech.unknown.lang` 这类不入库的 C++ 产物，在干净的 CI 检出里会自然落到同名
 * 明文 fixture 上。
 */
export function resolveGoldenFile(workplace: string, path: string): string {
  const local = resolveCorpusPath(workplace, path);
  if (existsSync(local)) return local;
  const fixture = resolveInsideRepo(join('fixtures/legacy-golden', path));
  return existsSync(fixture) ? fixture : local;
}

/**
 * 迁移期的硬性写入边界：
 * - legacy 文件只能由 legacy 内置工具修改，node 一律拒绝；
 * - Node 的产物只能落在 packages/node/dist。
 */
export function assertArtifactWritable(path: string): void {
  const absolute = resolve(path);
  if (isInside(legacyRoot, absolute)) {
    throw new Error(`迁移期禁止写入 legacy：${repoRelative(absolute)}；legacy 文件只能由 legacy 内置工具修改`);
  }
  if (!isInside(artifactRoot, absolute)) {
    throw new Error(`生成物只能写入 packages/node/dist：${repoRelative(absolute)}`);
  }
}

/** 写生成物：不生成 `.bak`，dist 可以随时重建。 */
export async function writeArtifact(path: string, content: string): Promise<void> {
  assertArtifactWritable(path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

export async function readBufferIfExists(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** 读取语料文本（UTF-8 明文）；文件缺失时返回 null。 */
export async function readTextIfExists(path: string): Promise<string | null> {
  const buffer = await readBufferIfExists(path);
  return buffer === null ? null : buffer.toString('utf8');
}

/** 同步读取语料文本（UTF-8 明文）；文件缺失时抛出 ENOENT。 */
export function readLangTextSync(path: string): string {
  return readFileSync(path, 'utf8');
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function backupSuffix(): string {
  // 保留毫秒，避免同一秒内两次保存互相覆盖备份。
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

/**
 * 写文件前保留一份同目录备份，再用临时文件 + rename 原子替换。
 * 返回备份路径；备份本身在目标文件已存在时创建。
 */
export async function writeWithBackup(path: string, content: string): Promise<string | undefined> {
  await mkdir(dirname(path), { recursive: true });
  let backupPath: string | undefined;
  if (await pathExists(path)) {
    backupPath = `${path}.bak-${backupSuffix()}`;
    await copyFile(path, backupPath);
  }

  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await writeFile(tempPath, content, 'utf8');
    await rename(tempPath, path);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
  return backupPath;
}
