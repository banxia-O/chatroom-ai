import http from 'node:http';
import express from 'express';
import { config } from './config.js';
import { logger } from './logger.js';
import { migrate } from './db/migrate.js';
import { errorHandler } from './utils/errors.js';
import { buildApiRouter } from './routes/index.js';
import { attachWebSocket } from './ws/server.js';

export function buildApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '64kb' }));

  // CORS
  if (config.cors.origin.length) {
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (origin && config.cors.origin.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Authorization, Content-Type',
        );
        res.setHeader(
          'Access-Control-Allow-Methods',
          'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        );
        if (req.method === 'OPTIONS') return res.sendStatus(204);
      }
      next();
    });
  }

  // 健康检查
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
  });

  app.use('/api', buildApiRouter());

  // 404
  app.use((req, res) => {
    res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: `路径不存在: ${req.path}` } });
  });

  // 错误处理（必须最后）
  app.use(errorHandler(logger));

  return app;
}

/**
 * 构建 HTTP server 并挂上 WebSocket upgrade。供测试 / 生产共用。
 */
export function buildHttpServer() {
  const app = buildApp();
  const server = http.createServer(app);
  attachWebSocket(server);
  return server;
}

async function main() {
  migrate();
  const server = buildHttpServer();
  server.listen(config.port, () => {
    logger.info({ port: config.port }, '半夏茶馆后端已启动');
  });
}

// 直接运行（非测试 import）时启动
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    logger.error({ err: e }, '启动失败');
    process.exit(1);
  });
}
