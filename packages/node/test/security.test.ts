import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { WebSocket, type RawData } from 'ws';
import type { NodeEngineClient } from '../src/engine-client';
import { createAppServer, type AppServer, type AppServerOptions } from '../src/http';
import { ProjectStore } from '../src/projectStore';

const TOKEN = 'test-session-token-0123456789';
const FOREIGN_ORIGIN = 'http://evil.example';

interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/** 直接传原始 path 给 node:http，不做 URL 点段归一化，确保能覆盖目录穿越。 */
function httpCall(
  base: string,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: Buffer } = {},
): Promise<RawResponse> {
  const origin = new URL(base);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: origin.hostname,
        port: origin.port,
        path,
        method: init.method ?? 'GET',
        headers: init.headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }),
        );
      },
    );
    request.on('error', reject);
    if (init.body) request.write(init.body);
    request.end();
  });
}

/** 只保留服务工厂用到的两个方法，避免测试拉起真实 worker。 */
function stubEngine(): NodeEngineClient {
  return { onEvent: () => () => undefined, close: () => undefined } as unknown as NodeEngineClient;
}

async function startServer(overrides: Partial<AppServerOptions> = {}): Promise<{ app: AppServer; base: string }> {
  const app = await createAppServer({
    port: 0,
    host: '127.0.0.1',
    sessionToken: TOKEN,
    store: new ProjectStore(),
    engine: stubEngine(),
    quiet: true,
    ...overrides,
  });
  const { url } = await app.listen();
  return { app, base: url.replace(/\/$/, '') };
}

function connect(url: string, origin?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, origin ? { origin } : {});
    socket.once('open', () => resolve(socket));
    socket.once('unexpected-response', (_request, response) => {
      reject(new Error(`handshake ${response.statusCode}`));
    });
    socket.once('error', reject);
  });
}

function call(socket: WebSocket, payload: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('RPC 超时'));
    }, 5000);
    const onMessage = (data: RawData) => {
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(JSON.parse(data.toString()) as Record<string, unknown>);
    };
    socket.on('message', onMessage);
    socket.send(JSON.stringify(payload));
  });
}

describe('本地服务 Origin 与 token 校验', () => {
  let app: AppServer;
  let base: string;

  before(async () => {
    ({ app, base } = await startServer());
  });

  after(async () => {
    await app.close();
  });

  it('跨站 Origin 调 /api/* 返回 403', async () => {
    const response = await httpCall(base, '/api/files', {
      method: 'POST',
      headers: { Origin: FOREIGN_ORIGIN },
      body: Buffer.from('hello'),
    });
    assert.equal(response.status, 403);
  });

  it('同源 Origin 可以上传并下载文件', async () => {
    const upload = await httpCall(base, '/api/files?name=demo.lang', {
      method: 'POST',
      headers: { Origin: base },
      body: Buffer.from('S:demo=值'),
    });
    assert.equal(upload.status, 200);
    const { id } = JSON.parse(upload.body.toString()) as { id: string };

    const download = await httpCall(base, `/api/files/${id}`, { headers: { Origin: base } });
    assert.equal(download.status, 200);
    assert.equal(download.body.toString(), 'S:demo=值');
  });

  it('无 Origin 且无 X-GT6TG-Token 调 /api/* 返回 403', async () => {
    const response = await httpCall(base, '/api/files', {
      method: 'POST',
      body: Buffer.from('unauthenticated'),
    });
    assert.equal(response.status, 403);
  });

  it('有效 X-GT6TG-Token 可以放行无 Origin 与跨站 Origin，错误 token 仍然 403', async () => {
    const noOriginAllowed = await httpCall(base, '/api/files', {
      method: 'POST',
      headers: { 'X-GT6TG-Token': TOKEN },
      body: Buffer.from('token-no-origin'),
    });
    assert.equal(noOriginAllowed.status, 200);

    const allowed = await httpCall(base, '/api/files', {
      method: 'POST',
      headers: { Origin: FOREIGN_ORIGIN, 'X-GT6TG-Token': TOKEN },
      body: Buffer.from('token'),
    });
    assert.equal(allowed.status, 200);

    const denied = await httpCall(base, '/api/files', {
      method: 'POST',
      headers: { Origin: FOREIGN_ORIGIN, 'X-GT6TG-Token': `${TOKEN}x` },
      body: Buffer.from('token'),
    });
    assert.equal(denied.status, 403);
  });

  it('不再返回 Access-Control-Allow-Origin', async () => {
    const response = await httpCall(base, '/health');
    assert.equal(response.status, 200);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  });

  it('入口页注入会话 token', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'gt6tg-web-'));
    writeFileSync(
      join(webRoot, 'index.html'),
      '<!doctype html><html><head><title>t</title></head><body></body></html>',
    );
    const { app: local, base: localBase } = await startServer({ webRoot });
    try {
      const response = await httpCall(localBase, '/');
      assert.equal(response.status, 200);
      const html = response.body.toString();
      assert.match(html, new RegExp(`<meta name="gt6tg-session-token" content="${TOKEN}">`));
      assert.ok(html.indexOf('gt6tg-session-token') < html.indexOf('</head>'));
    } finally {
      await local.close();
      rmSync(webRoot, { recursive: true, force: true });
    }
  });

  it('静态服务拦截目录穿越并转义下载文件名中的 CRLF', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'gt6tg-sec-'));
    const webRoot = join(rootDir, 'web');
    rmSync(webRoot, { recursive: true, force: true });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(webRoot, { recursive: true });
    writeFileSync(join(rootDir, 'secret.txt'), 'TOP-SECRET');
    writeFileSync(join(webRoot, 'secret.txt'), 'INSIDE');
    writeFileSync(join(webRoot, 'index.html'), '<!doctype html><html><head></head><body>ok</body></html>');

    const { app: local, base: localBase } = await startServer({ webRoot });
    try {
      for (const badPath of [
        '/%2e%2e%2fsecret.txt',
        '/%2e%2e%2f%2e%2e%2fsecret.txt',
        '/foo%2f..%2f..%2fsecret.txt',
        '/..%2f..%2fsecret.txt',
        '/..%5csecret.txt',
      ]) {
        const res = await httpCall(localBase, badPath);
        assert.ok(res.status === 400 || res.status === 404, `${badPath} 期望 400/404，实际 ${res.status}`);
        const text = res.body.toString();
        assert.ok(!text.includes('TOP-SECRET'), `${badPath} 泄漏了目录外文件`);
        assert.ok(!text.includes('INSIDE'), `${badPath} 被错误折叠到了 webRoot 内部文件`);
      }

      for (const foldedPath of ['/../secret.txt', '/sub/../../secret.txt']) {
        const res = await httpCall(localBase, foldedPath);
        assert.equal(res.status, 200, `${foldedPath} 应由 URL 归一化锚定在 webRoot 内部`);
        assert.equal(res.body.toString(), 'INSIDE');
      }

      const nullRes = await httpCall(localBase, '/foo%00bar');
      assert.equal(nullRes.status, 400);

      const upload = await httpCall(localBase, '/api/files?name=evil%0d%0aX-Injected:%201', {
        method: 'POST',
        headers: { 'X-GT6TG-Token': TOKEN },
        body: Buffer.from('crlf-test'),
      });
      assert.equal(upload.status, 200);
      const { id } = JSON.parse(upload.body.toString()) as { id: string };
      const download = await httpCall(localBase, `/api/files/${id}`, {
        headers: { 'X-GT6TG-Token': TOKEN },
      });
      assert.equal(download.status, 200);
      assert.equal(download.headers['x-injected'], undefined);
      assert.ok(!(download.headers['content-disposition'] ?? '').includes('\r'));
      assert.ok(!(download.headers['content-disposition'] ?? '').includes('\n'));
    } finally {
      await local.close();
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

describe('上传文件 TTL 与请求体上限', () => {
  it('超过 TTL 的上传文件会被清理', async () => {
    const { app, base } = await startServer({ fileTtlMs: 30 });
    try {
      const upload = await httpCall(base, '/api/files', {
        method: 'POST',
        headers: { 'X-GT6TG-Token': TOKEN },
        body: Buffer.from('x'),
      });
      assert.equal(upload.status, 200);
      const { id } = JSON.parse(upload.body.toString()) as { id: string };
      await new Promise((resolve) => setTimeout(resolve, 60));
      const download = await httpCall(base, `/api/files/${id}`, {
        headers: { 'X-GT6TG-Token': TOKEN },
      });
      assert.equal(download.status, 404);
    } finally {
      await app.close();
    }
  });

  it('超过上限的请求体返回 413 且不会二次 settle', async () => {
    const { app, base } = await startServer({ maxBodyBytes: 64 });
    try {
      const response = await httpCall(base, '/api/files', {
        method: 'POST',
        headers: { 'X-GT6TG-Token': TOKEN },
        body: Buffer.alloc(4096, 0x61),
      });
      assert.equal(response.status, 413);
      const health = await httpCall(base, '/health');
      assert.equal(health.status, 200);
    } finally {
      await app.close();
    }
  });
});

describe('WebSocket 握手与方法白名单', () => {
  let app: AppServer;
  let base: string;
  let rpcUrl: string;

  before(async () => {
    ({ app, base } = await startServer());
    rpcUrl = `ws://127.0.0.1:${new URL(base).port}/__gt6tg_rpc`;
  });

  after(async () => {
    await app.close();
  });

  it('缺少 token 时拒绝握手', async () => {
    await assert.rejects(connect(rpcUrl, base), /handshake 401/);
  });

  it('跨站 Origin 即使带 token 也拒绝握手', async () => {
    await assert.rejects(connect(`${rpcUrl}?token=${TOKEN}`, FOREIGN_ORIGIN), /handshake 403/);
  });

  it('同源且 token 正确时可以调用白名单方法', async () => {
    const socket = await connect(`${rpcUrl}?token=${TOKEN}`, base);
    try {
      const response = await call(socket, { id: 1, method: 'getProject', params: [] });
      assert.equal(response.id, 1);
      assert.ok(response.result);
    } finally {
      socket.close();
    }
  });

  it('拒绝原型链属性与未声明方法并保留 request.id', async () => {
    const socket = await connect(`${rpcUrl}?token=${TOKEN}`, base);
    try {
      for (const method of ['__proto__', 'constructor', 'toString', 'eval']) {
        const response = await call(socket, { id: 7, method, params: [] });
        assert.equal(response.id, 7);
        const error = response.error as { code: string } | undefined;
        assert.equal(error?.code, 'unknown-method', `${method} 应被拒绝`);
      }
    } finally {
      socket.close();
    }
  });

  it('非法请求体返回 bad-request', async () => {
    const socket = await connect(`${rpcUrl}?token=${TOKEN}`, base);
    try {
      const response = await call(socket, null);
      assert.equal((response.error as { code: string }).code, 'bad-request');
    } finally {
      socket.close();
    }
  });

  it('参数类型与长度不合法时返回 bad-params 且保留 request.id', async () => {
    const socket = await connect(`${rpcUrl}?token=${TOKEN}`, base);
    try {
      const wrongType = await call(socket, { id: 2, method: 'checkIo', params: [42] });
      assert.equal(wrongType.id, 2);
      assert.equal((wrongType.error as { code: string }).code, 'bad-params');

      const tooMany = await call(socket, { id: 3, method: 'getProject', params: ['extra'] });
      assert.equal(tooMany.id, 3);
      assert.equal((tooMany.error as { code: string }).code, 'bad-params');

      const badPatch = await call(socket, {
        id: 4,
        method: 'updateTarget',
        params: ['{}', 'gt6-legacy', { unknownField: 'x' }],
      });
      assert.equal(badPatch.id, 4);
      assert.equal((badPatch.error as { code: string }).code, 'bad-params');

      const longId = await call(socket, { id: 5, method: 'checkIo', params: ['x'.repeat(4096)] });
      assert.equal(longId.id, 5);
      assert.equal((longId.error as { code: string }).code, 'bad-params');
    } finally {
      socket.close();
    }
  });
});
