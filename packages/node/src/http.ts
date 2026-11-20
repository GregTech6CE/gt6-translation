import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { RpcNotification } from '@gt6tg/core';
import type { CoreEvent } from '@gt6tg/runtime';
import { WebSocketServer, type WebSocket } from 'ws';
import { NodeEngineClient } from './engine-client';
import { createHandlers } from './handlers';
import { webDistRoot } from './paths';
import { ProjectStore } from './projectStore';
import { attachRpc } from './rpc';

interface StoredFile {
  id: string;
  name: string;
  role: string;
  data: Buffer;
  createdAt: number;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 5176;
const RPC_PATH = '/__gt6tg_rpc';
const TOKEN_HEADER = 'x-gt6tg-token';
const SESSION_META_NAME = 'gt6tg-session-token';
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 16;
/** 上传文件的内存保留时间；超时后由下一次 /api 访问清理。 */
const FILE_TTL_MS = 30 * 60 * 1000;

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export interface AppServerOptions {
  port?: number;
  host?: string;
  /** 会话 token；默认随机生成，也可用 `GT6TG_SESSION_TOKEN` 固定。 */
  sessionToken?: string;
  /** 额外允许的 Origin（默认取 `GT6TG_ALLOW_ORIGINS`，逗号分隔）。 */
  allowOrigins?: readonly string[];
  store?: ProjectStore;
  engine?: NodeEngineClient;
  /** 静态产物目录；默认 `packages/web/dist`，测试可指向临时目录。 */
  webRoot?: string;
  fileTtlMs?: number;
  maxBodyBytes?: number;
  quiet?: boolean;
}

export interface AppServer {
  readonly httpServer: Server;
  readonly wss: WebSocketServer;
  readonly sessionToken: string;
  readonly store: ProjectStore;
  readonly engine: NodeEngineClient;
  listen(): Promise<{ host: string; port: number; url: string }>;
  close(): Promise<void>;
}

interface AppContext {
  sessionToken: string;
  allowOrigins: readonly string[];
  webRoot: string;
  fileTtlMs: number;
  maxBodyBytes: number;
  files: Map<string, StoredFile>;
  /** listen 之后才有真实端口；Origin 校验依赖它。 */
  boundPort: () => number;
}

class BodyTooLargeError extends Error {}

/**
 * Node dev server：同源托管 web 构建产物，并保留 HTTP 文件通道。
 *
 * 控制/进度走挂在这个 server 上的 WS；只绑定 localhost。跨站请求一律拒绝：
 * 浏览器侧靠 Origin 白名单，非浏览器客户端必须带 `X-GT6TG-Token`。
 */
export async function createAppServer(options: AppServerOptions = {}): Promise<AppServer> {
  const host = options.host ?? process.env.GT6TG_HOST ?? DEFAULT_HOST;
  const port = options.port ?? readPortFromEnv();
  const sessionToken = options.sessionToken ?? process.env.GT6TG_SESSION_TOKEN ?? randomBytes(24).toString('hex');
  const allowOrigins = options.allowOrigins ?? parseAllowOrigins(process.env.GT6TG_ALLOW_ORIGINS);
  const webRoot = options.webRoot ?? webDistRoot;
  const fileTtlMs = options.fileTtlMs ?? FILE_TTL_MS;
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const quiet = options.quiet ?? false;

  const store = options.store ?? new ProjectStore();
  if (!options.store) await store.load();
  const engine = options.engine ?? new NodeEngineClient();
  const handlers = createHandlers(store, engine);
  const clients = new Set<WebSocket>();

  let boundPort = port;
  const context: AppContext = {
    sessionToken,
    allowOrigins,
    webRoot,
    fileTtlMs,
    maxBodyBytes,
    files: new Map(),
    boundPort: () => boundPort,
  };

  engine.onEvent((event) => {
    const notification = toNotification(event);
    if (!notification) return;
    const text = JSON.stringify(notification);
    for (const client of clients) {
      if (client.readyState === 1) client.send(text);
    }
  });

  const httpServer = createServer((request, response) => {
    void handleRequest(context, request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      sendJson(response, 500, {
        error: 'internal',
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });

  const wss = new WebSocketServer({
    server: httpServer,
    path: RPC_PATH,
    maxPayload: maxBodyBytes,
    verifyClient: (info, callback) => {
      const origin = info.origin || undefined;
      if (origin !== undefined && !isExplicitAllowedOrigin(origin, boundPort, allowOrigins)) {
        callback(false, 403, 'Forbidden');
        return;
      }
      const token = readTokenFromUrl(info.req.url);
      if (!tokenMatches(token, sessionToken)) {
        callback(false, 401, 'Unauthorized');
        return;
      }
      callback(true);
    },
  });

  wss.on('connection', (socket) => {
    if (!quiet) console.log('[gt6tg] 控制台已连接');
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
    attachRpc(socket, handlers);
  });

  wss.on('error', (error) => {
    if (!quiet) console.error('[gt6tg] WebSocket 服务错误:', error);
  });

  const listen: AppServer['listen'] = () =>
    new Promise((resolvePromise, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(port, host, () => {
        httpServer.off('error', reject);
        const address = httpServer.address();
        boundPort = typeof address === 'object' && address !== null ? address.port : port;
        resolvePromise({ host, port: boundPort, url: `http://${host}:${boundPort}/` });
      });
    });

  const close: AppServer['close'] = async () => {
    for (const client of clients) client.terminate();
    clients.clear();
    await new Promise<void>((resolvePromise) => wss.close(() => resolvePromise()));
    await new Promise<void>((resolvePromise) => {
      httpServer.close(() => resolvePromise());
      httpServer.closeAllConnections();
    });
    if (!options.engine) engine.close();
  };

  return { httpServer, wss, sessionToken, store, engine, listen, close };
}

async function handleRequest(context: AppContext, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');

  if (request.method === 'OPTIONS') {
    if (url.pathname.startsWith('/api/') && !isRequestTrusted(context, request)) {
      sendJson(response, 403, { error: 'forbidden-origin', message: '跨站请求被拒绝' });
      return;
    }
    response.writeHead(204, { Allow: 'GET,HEAD,POST,DELETE,OPTIONS' }).end();
    return;
  }

  if (url.pathname.startsWith('/api/') && !isRequestTrusted(context, request)) {
    sendJson(response, 403, { error: 'forbidden-origin', message: '跨站请求被拒绝' });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    pruneFiles(context);
    sendJson(response, 200, { ok: true, files: context.files.size });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/files') {
    let data: Buffer;
    try {
      data = await readBody(request, context.maxBodyBytes);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        // 先回 413 再断开：直接 destroy 会让客户端读到 ECONNRESET 而不是响应。
        response.setHeader('Connection', 'close');
        sendJson(response, 413, { error: 'payload-too-large', message: error.message });
        return;
      }
      throw error;
    }
    pruneFiles(context);
    const id = randomUUID();
    const file: StoredFile = {
      id,
      name: url.searchParams.get('name') ?? 'upload.bin',
      role: url.searchParams.get('role') ?? 'source',
      data,
      createdAt: Date.now(),
    };
    context.files.set(id, file);
    while (context.files.size > MAX_FILES) {
      const oldest = context.files.keys().next().value;
      if (oldest === undefined) break;
      context.files.delete(oldest);
    }
    sendJson(response, 200, { id, name: file.name, role: file.role, size: data.length });
    return;
  }

  const match = /^\/api\/files\/([A-Za-z0-9-]+)$/.exec(url.pathname);
  if (match) {
    pruneFiles(context);
    const file = context.files.get(match[1]!);
    if (!file) {
      sendJson(response, 404, { error: 'not-found', message: '文件不存在' });
      return;
    }
    if (request.method === 'GET') {
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(file.data.length),
        'Content-Disposition': `attachment; filename="${encodeURIComponent(file.name)}"`,
      });
      response.end(file.data);
      return;
    }
    if (request.method === 'DELETE') {
      context.files.delete(file.id);
      sendJson(response, 200, { ok: true });
      return;
    }
  }

  if (url.pathname.startsWith('/api/')) {
    sendJson(response, 404, { error: 'not-found', message: '未知路径' });
    return;
  }

  await serveStatic(context, url.pathname, request, response);
}

/** 带有效 token 的客户端，或来自同源/白名单 Origin 的浏览器请求才算可信。 */
function isRequestTrusted(context: AppContext, request: IncomingMessage): boolean {
  if (tokenMatches(headerValue(request.headers[TOKEN_HEADER]), context.sessionToken)) return true;
  const origin = headerValue(request.headers.origin);
  if (origin !== undefined) return isExplicitAllowedOrigin(origin, context.boundPort(), context.allowOrigins);
  return false;
}

/**
 * 显式 Origin 校验：仅命中同源或白名单时放行。
 * 不再返回 `Access-Control-Allow-Origin: *`，跨站或缺少可信凭据的请求一律被 403 拦下。
 */
function isExplicitAllowedOrigin(origin: string, port: number, allowOrigins: readonly string[]): boolean {
  if (allowOrigins.includes(origin)) return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function tokenMatches(candidate: string | null | undefined, expected: string): boolean {
  if (!candidate) return false;
  const left = Buffer.from(candidate, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function readTokenFromUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  return new URL(rawUrl, 'http://127.0.0.1').searchParams.get('token');
}

function parseAllowOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

function readPortFromEnv(): number {
  const raw = process.env.GT6TG_PORT ?? process.env.GT6TG_HTTP_PORT;
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_PORT;
}

/** 清理超过 TTL 的上传文件；惰性执行，不额外占用定时器。 */
function pruneFiles(context: AppContext, now = Date.now()): void {
  for (const [id, file] of context.files) {
    if (now - file.createdAt >= context.fileTtlMs) context.files.delete(id);
  }
}

async function serveStatic(
  context: AppContext,
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 405, { error: 'method-not-allowed', message: '只支持 GET/HEAD' });
    return;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendJson(response, 400, { error: 'bad-request', message: '非法 URL' });
    return;
  }
  if (decoded.includes('\0')) {
    sendJson(response, 400, { error: 'bad-request', message: '非法 URL' });
    return;
  }

  const relativePath = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const requestedPath = resolve(context.webRoot, relativePath);
  if (!isInside(context.webRoot, requestedPath)) {
    sendJson(response, 404, { error: 'not-found', message: '静态文件不存在' });
    return;
  }

  const indexPath = resolve(context.webRoot, 'index.html');
  let filePath = requestedPath;
  let data = await readStaticFile(filePath);
  if (!data && extname(relativePath) === '') {
    filePath = indexPath;
    data = await readStaticFile(filePath);
  }

  if (!data) {
    if (!(await readStaticFile(indexPath))) {
      response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('web 产物不存在：请先运行 npm run dev（会构建 packages/web/dist）。\n');
      return;
    }
    sendJson(response, 404, { error: 'not-found', message: '静态文件不存在' });
    return;
  }

  // 入口页注入会话 token，前端据此在 WS URL 上带 ?token=。
  const body =
    filePath === indexPath
      ? Buffer.from(injectSessionToken(data.toString('utf8'), context.sessionToken), 'utf8')
      : data;
  const extension = extname(filePath).toLowerCase();
  response.writeHead(200, {
    'Content-Type': MIME_TYPES[extension] ?? 'application/octet-stream',
    'Content-Length': String(body.length),
    'Cache-Control': relativePath.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (request.method === 'HEAD') response.end();
  else response.end(body);
}

function escapeHtmlAttr(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** 在 `<head>` 后插入会话 token 的 meta；没有 head 时退化为文档开头。 */
function injectSessionToken(html: string, sessionToken: string): string {
  const meta = `<meta name="${SESSION_META_NAME}" content="${escapeHtmlAttr(sessionToken)}">`;
  const head = /<head[^>]*>/i.exec(html);
  if (!head) return `${meta}\n${html}`;
  const insertAt = head.index + head[0].length;
  return `${html.slice(0, insertAt)}\n    ${meta}${html.slice(insertAt)}`;
}

async function readStaticFile(path: string): Promise<Buffer | null> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    return await readFile(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') return null;
    throw error;
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * 读取请求体；超限立即 reject 并暂停读取，由调用方回 413 后关闭连接。
 * `settled` 保证 pause/close 触发的 error/end 不会再次 settle。
 */
function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    const settle = (error: Error | null) => {
      if (settled) return;
      settled = true;
      if (error) {
        request.pause();
        reject(error);
      } else {
        resolvePromise(Buffer.concat(chunks));
      }
    };

    request.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settle(new BodyTooLargeError(`文件超过 ${Math.round(limit / (1024 * 1024))} MB 限制`));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => settle(null));
    request.on('error', (error) => settle(error));
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  response.end(text);
}

function toNotification(event: CoreEvent): RpcNotification | null {
  if (event.event === 'job.progress') {
    return {
      type: 'progress',
      task: 'job',
      message: `${event.payload.phase} ${event.payload.processed}/${event.payload.total}`,
      data: event.payload as unknown as Record<string, unknown>,
    };
  }
  if (event.event === 'job.done') {
    return {
      type: 'progress',
      task: 'job',
      message: 'done',
      data: { jobId: event.payload.jobId, summary: event.payload.summary },
    };
  }
  if (event.event === 'job.error') {
    return {
      type: 'progress',
      task: 'job',
      message: event.payload.message,
      data: { jobId: event.payload.jobId },
    };
  }
  if (event.event === 'engine.compiled') {
    return {
      type: 'progress',
      task: 'engine',
      message: 'compiled',
      data: { compileId: event.payload.compileId, stats: event.payload.stats },
    };
  }
  return null;
}
