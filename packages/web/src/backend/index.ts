import { BrowserBackend } from './browser';
import { DevBackend } from './dev';
import type { ConsoleBackend } from './types';

export * from './types';

const RPC_PATH = '/__gt6tg_rpc';
const SESSION_META = 'gt6tg-session-token';

/**
 * 会话 token：node 托管的入口页会注入 `<meta name="gt6tg-session-token">`；
 * 手工调试时也可以用 `?token=` 覆盖。
 */
function readSessionToken(): string | null {
  const fromMeta = document.querySelector(`meta[name="${SESSION_META}"]`)?.getAttribute('content')?.trim();
  if (fromMeta) return fromMeta;
  const fromQuery = new URLSearchParams(location.search).get('token')?.trim();
  return fromQuery ? fromQuery : null;
}

/**
 * node 托管构建（`vite build --mode node`）与 Vite dev 默认走 WebSocket；
 * 纯静态生产构建默认走浏览器 Worker。可用 `?mode=repl` / `?mode=dev` 强制切换。
 */
export function resolveRpcUrl(): string {
  if (import.meta.env.VITE_RPC_URL) return import.meta.env.VITE_RPC_URL;
  const token = readSessionToken();
  const suffix = token ? `?token=${encodeURIComponent(token)}` : '';
  if (import.meta.env.MODE === 'node') {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}${RPC_PATH}${suffix}`;
  }
  return `ws://127.0.0.1:5176${RPC_PATH}${suffix}`;
}

export function createBackend(): ConsoleBackend {
  const queryMode = new URLSearchParams(location.search).get('mode');
  const defaultMode = import.meta.env.DEV || import.meta.env.MODE === 'node' ? 'dev' : 'repl';
  const mode = queryMode === 'repl' || queryMode === 'dev' ? queryMode : defaultMode;
  if (mode === 'repl') return new BrowserBackend();
  return new DevBackend(resolveRpcUrl());
}
