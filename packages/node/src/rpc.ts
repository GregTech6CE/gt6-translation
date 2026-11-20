import type { RpcRequest, RpcResponse, ServerMethodName } from '@gt6tg/core';
import type { WebSocket } from 'ws';
import type { ServerHandlers } from './handlers';

/** 允许通过 WS 调用的方法；与 `ServerMethodMap` 一一对应，禁止任何动态属性名。 */
export const ALLOWED_METHODS: ReadonlySet<ServerMethodName> = new Set<ServerMethodName>([
  'getProject',
  'validateProject',
  'saveProject',
  'updateTarget',
  'checkIo',
  'generate',
  'testEntry',
  'importLegacyConfig',
]);

const MAX_CONFIG_CHARS = 4 * 1024 * 1024;
const MAX_ID_CHARS = 256;
const MAX_KEY_CHARS = 4096;
const MAX_VALUE_CHARS = 1024 * 1024;
const PATCH_FIELDS = new Set(['label', 'workplace', 'source', 'fallback', 'output', 'unknown', 'lineEnding', 'notes']);

type ParamKind = 'config' | 'id' | 'key' | 'value' | 'boolean' | 'patch';

interface ParamSpec {
  kind: ParamKind;
  optional?: boolean;
}

const STRING_LIMITS: Record<Exclude<ParamKind, 'boolean' | 'patch'>, number> = {
  config: MAX_CONFIG_CHARS,
  id: MAX_ID_CHARS,
  key: MAX_KEY_CHARS,
  value: MAX_VALUE_CHARS,
};

/** 每个方法的参数表：顺序、可选性与长度上限都在这里声明。 */
const METHOD_PARAMS: Record<ServerMethodName, readonly ParamSpec[]> = {
  getProject: [],
  validateProject: [{ kind: 'config' }],
  saveProject: [{ kind: 'config' }],
  updateTarget: [{ kind: 'config' }, { kind: 'id' }, { kind: 'patch' }],
  checkIo: [{ kind: 'id' }],
  generate: [{ kind: 'id' }, { kind: 'boolean' }, { kind: 'boolean', optional: true }],
  testEntry: [{ kind: 'id' }, { kind: 'key' }, { kind: 'value', optional: true }],
  importLegacyConfig: [],
};

/** RPC 层错误：`code` 直接回给前端，便于区分方法名与参数问题。 */
export class RpcError extends Error {
  constructor(
    readonly code: 'bad-request' | 'unknown-method' | 'bad-params',
    message: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

function send(ws: WebSocket, response: RpcResponse): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(response));
}

function sendError(ws: WebSocket, id: number, code: string, message: string, details?: unknown): void {
  send(ws, { id, error: { code, message, details } });
}

/** 解析请求体；只接受 `{ id, method, params }` 形状。 */
export function parseRequest(raw: string): RpcRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RpcError('bad-request', 'RPC 请求不是合法 JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new RpcError('bad-request', 'RPC 请求格式错误');
  }
  const candidate = parsed as Partial<RpcRequest>;
  if (typeof candidate.id !== 'number' || typeof candidate.method !== 'string' || !Array.isArray(candidate.params)) {
    throw new RpcError('bad-request', 'RPC 请求格式错误');
  }
  return { id: candidate.id, method: candidate.method, params: candidate.params };
}

/**
 * 校验方法名与参数。
 *
 * 方法名只认 `ALLOWED_METHODS`，因此 `__proto__`、`constructor` 之类的原型链属性
 * 一律按未知方法拒绝；参数按 `METHOD_PARAMS` 做类型与长度校验。
 */
export function validateRequest(request: RpcRequest): ServerMethodName {
  if (!ALLOWED_METHODS.has(request.method as ServerMethodName)) {
    throw new RpcError('unknown-method', `未知方法：${request.method}`);
  }
  const method = request.method as ServerMethodName;
  const specs = METHOD_PARAMS[method];
  const required = specs.filter((spec) => !spec.optional).length;
  if (request.params.length < required || request.params.length > specs.length) {
    throw new RpcError(
      'bad-params',
      `${method} 期望 ${required}~${specs.length} 个参数，实际 ${request.params.length} 个`,
    );
  }
  for (const [index, spec] of specs.entries()) {
    const value = request.params[index];
    if (value === undefined && spec.optional) continue;
    assertParam(method, spec, value, index);
  }
  return method;
}

function assertParam(method: string, spec: ParamSpec, value: unknown, index: number): void {
  const label = `${method} 的参数 ${index}`;
  if (spec.kind === 'boolean') {
    if (typeof value !== 'boolean') throw new RpcError('bad-params', `${label} 必须是布尔值`);
    return;
  }
  if (spec.kind === 'patch') {
    assertPatch(label, value);
    return;
  }
  const limit = STRING_LIMITS[spec.kind];
  if (typeof value !== 'string') throw new RpcError('bad-params', `${label} 必须是字符串`);
  if (value.length > limit) throw new RpcError('bad-params', `${label} 超过 ${limit} 字符上限`);
}

function assertPatch(label: string, value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RpcError('bad-params', `${label} 必须是对象`);
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new RpcError('bad-params', `${label} 必须是普通对象`);
  }
  for (const [key, item] of Object.entries(value)) {
    if (!PATCH_FIELDS.has(key)) throw new RpcError('bad-params', `${label} 含未知字段 ${key}`);
    if (typeof item !== 'string') throw new RpcError('bad-params', `${label}.${key} 必须是字符串`);
    if (item.length > MAX_ID_CHARS) throw new RpcError('bad-params', `${label}.${key} 超过 ${MAX_ID_CHARS} 字符上限`);
  }
}

/** 只从白名单取 handler；`Object.hasOwn` 保证不会命中原型链上的属性。 */
export function resolveHandler(handlers: ServerHandlers, method: ServerMethodName): ServerHandlers[ServerMethodName] {
  if (!Object.hasOwn(handlers, method)) throw new RpcError('unknown-method', `未知方法：${method}`);
  const handler = handlers[method];
  if (typeof handler !== 'function') throw new RpcError('unknown-method', `未知方法：${method}`);
  return handler;
}

/**
 * 极简 JSON-RPC over WebSocket：
 * 请求 { id, method, params }，响应 { id, result } 或 { id, error }。
 * 同一连接上的请求串行执行，避免配置保存和生成同时写文件。
 */
export function attachRpc(ws: WebSocket, handlers: ServerHandlers): void {
  let queue: Promise<void> = Promise.resolve();

  ws.on('message', (data) => {
    queue = queue.then(async () => {
      let request: RpcRequest;
      let method: ServerMethodName;
      let requestId = 0;
      try {
        request = parseRequest(data.toString());
        requestId = request.id;
        method = validateRequest(request);
      } catch (error) {
        const code = error instanceof RpcError ? error.code : 'bad-request';
        sendError(ws, requestId, code, error instanceof Error ? error.message : String(error));
        return;
      }

      try {
        const handler = resolveHandler(handlers, method);
        const result = await handler(...(request.params as never[]));
        send(ws, { id: request.id, result: result ?? null });
      } catch (error) {
        sendError(
          ws,
          request.id,
          error instanceof RpcError ? error.code : 'internal',
          error instanceof Error ? error.message : String(error),
          process.env.GT6TG_DEBUG === '1' && error instanceof Error ? error.stack : undefined,
        );
      }
    });
  });

  ws.on('error', (error) => {
    console.error('[gt6tg] WebSocket 错误:', error);
  });
}
