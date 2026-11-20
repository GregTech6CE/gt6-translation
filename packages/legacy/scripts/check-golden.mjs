import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * legacy golden 基线校验。
 *
 * 三份语料以 LF 明文存放在 `fixtures/legacy-golden/`，manifest.json 固化它们的
 * sha256、字节数、行数与词条数。`workplace/zh/GregTech.lang` 与
 * `GregTech.unknown.lang` 是 C++ 工具的产物、不入库，因此干净检出里只校验明文
 * fixture；本地构建出产物时再额外校验产物与基线一致。
 */

const root = resolve(import.meta.dirname, '..');
const repoRoot = resolve(root, '../..');
const fixtureDir = resolve(repoRoot, 'fixtures/legacy-golden');
const manifestPath = resolve(fixtureDir, 'manifest.json');

const ROLES = ['source', 'output', 'unknown'];
const SHA256_RE = /^[0-9a-f]{64}$/;
const METRICS = ['sha256', 'bytes', 'lines', 'entries'];

const failures = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * 语料指纹按 LF 规范化后计算：workplace 的文本文件在 git 里存 LF，检出到 Windows
 * 又是 CRLF，只有规范化后才能在两个平台得到同一份指纹。
 */
function canonical(buffer) {
  return Buffer.from(buffer.toString('utf8').replaceAll('\r\n', '\n'), 'utf8');
}

/** 与 core parseLegacyLang 一致：从 languagefile 行开始，遇到含 } 的行结束。 */
function countEntries(text) {
  let started = false;
  let entries = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!started) {
      if (line.includes('languagefile')) started = true;
      continue;
    }
    if (line.includes('=')) {
      const equals = line.indexOf('=');
      const start = line.search(/[^ ]/);
      if (start < 0 || start >= equals) continue;
      entries++;
      continue;
    }
    if (line.includes('}')) started = false;
  }
  return entries;
}

/** 校验一份语料：规范化后的 sha256、字节数、行数与词条数。 */
function verify(label, buffer, expected) {
  const normalized = canonical(buffer);
  const text = normalized.toString('utf8');
  const actual = {
    sha256: sha256(normalized),
    bytes: normalized.length,
    lines: text.split(/\r?\n/).length,
    entries: countEntries(text),
  };
  for (const key of METRICS) {
    if (actual[key] !== expected[key]) {
      fail(`${label}: ${key} 期望 ${expected[key]}，实际 ${actual[key]}`);
      return false;
    }
  }
  notes.push(
    `${label}: ${actual.entries} 词条 / ${actual.lines} 行 / ${actual.bytes} B / ${actual.sha256.slice(0, 16)}`,
  );
  return true;
}

if (!existsSync(manifestPath)) {
  console.error(`[legacy] 缺少 golden manifest：${manifestPath}`);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (error) {
  console.error(`[legacy] manifest.json 解析失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (manifest.schemaVersion !== 1) fail(`manifest.schemaVersion 期望 1，实际 ${manifest.schemaVersion}`);
if (typeof manifest.sourceBaseline !== 'string' || manifest.sourceBaseline.trim() === '') {
  fail('manifest.sourceBaseline 缺失');
}

for (const role of ROLES) {
  const entry = manifest[role];
  if (!entry || typeof entry !== 'object') {
    fail(`manifest.${role} 缺失`);
    continue;
  }
  if (!SHA256_RE.test(String(entry.sha256))) fail(`manifest.${role}.sha256 不是 sha256`);
  for (const key of ['bytes', 'lines', 'entries']) {
    if (!Number.isInteger(entry[key]) || entry[key] <= 0) fail(`manifest.${role}.${key} 不是正整数`);
  }
  if (typeof entry.fixture !== 'string' || entry.fixture === '') fail(`manifest.${role}.fixture 缺失`);
  if (typeof entry.workplace !== 'string' || entry.workplace === '') fail(`manifest.${role}.workplace 缺失`);

  const fixturePath = resolve(repoRoot, String(entry.fixture));
  if (!existsSync(fixturePath)) {
    fail(`${role}: 缺少明文基线 ${entry.fixture}`);
  } else {
    verify(`${role} (${entry.fixture})`, readFileSync(fixturePath), entry);
  }

  // workplace 产物存在时（本地 C++ 构建后）必须与固化基线一致；缺失时用明文基线。
  const localPath = resolve(repoRoot, String(entry.workplace));
  if (existsSync(localPath)) {
    verify(`${role} (${entry.workplace})`, readFileSync(localPath), entry);
  } else {
    notes.push(`${role}: ${entry.workplace} 不存在，使用明文基线`);
  }
}

for (const note of notes) console.log(`[legacy] ${note}`);
if (failures.length) {
  for (const failure of failures) console.error(`[legacy] ✗ ${failure}`);
  console.error(`[legacy] golden 校验失败：${failures.length} 项不一致`);
  process.exit(1);
}
console.log(
  `[legacy] golden 校验通过（基线 ${manifest.sourceBaseline}）。C++ 构建请在本目录使用 CMake（见 README.md）。`,
);
