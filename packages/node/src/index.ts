import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAppServer } from './http';
import { webDistRoot } from './paths';

/**
 * 本地控制台入口。
 *
 * 服务工厂在 `http.ts`（`createAppServer`），这里只负责环境变量默认值、
 * 启动日志与退出清理，便于单测直接复用工厂而不启动真实进程。
 */
const app = await createAppServer();
const { url, port } = await app.listen();

if (!existsSync(resolve(webDistRoot, 'index.html'))) {
  console.warn('[gt6tg] 未找到 packages/web/dist；页面请求会返回 503，请先运行 npm run dev。');
}

console.log(`[gt6tg] 控制台已启动：${url}`);
console.log('[gt6tg] 会话 token 已注入页面；WebSocket RPC 需要页面同源或携带 ?token=<token>。');
console.log(`[gt6tg] WebSocket RPC：ws://127.0.0.1:${port}/__gt6tg_rpc`);
if (!process.env.GT6TG_ALLOW_ORIGINS) {
  console.log('[gt6tg] Vite dev（127.0.0.1:5173）是跨源页面；如需直连本服务，请设置 GT6TG_ALLOW_ORIGINS。');
}

app.httpServer.on('error', (error) => {
  console.error('[gt6tg] HTTP 服务错误:', error);
  process.exitCode = 1;
});

const shutdown = () => {
  void app.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
