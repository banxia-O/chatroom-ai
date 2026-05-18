// @ts-check
/**
 * MCP Streamable HTTP 路由。
 *
 * 模式：stateless（sessionIdGenerator=undefined）。每个 POST 请求构造独立的
 * transport + server，结束时各自清理。匿名 Bearer 缺失对 chat_register / chat_login 也允许 —
 * 鉴权细分到工具内部，路由本身只做"如果 Authorization 存在则解析；解析失败也允许继续，
 * 由工具自己判定 user 是否可用"。
 */
import { Router } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildMcpServer } from './server.js';
import { extractToken } from '../auth/middleware.js';
import { verifyToken } from '../auth/jwt.js';
import { getUserById } from '../services/user.service.js';
import { logger } from '../logger.js';

export function buildMcpRouter() {
  const r = Router();

  r.post('/', async (req, res) => {
    let user = null;
    const token = extractToken(req);
    if (token) {
      try {
        const { uid } = verifyToken(token);
        user = getUserById(uid);
      } catch {
        user = null; // 无效 token 当匿名处理；工具内 requireUser 会拒
      }
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const server = buildMcpServer(user);

    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      logger.error({ err: e }, 'MCP 请求处理失败');
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: '内部错误' },
          id: null,
        });
      }
    }
  });

  // Stateless 模式下 GET / DELETE 一律 405
  const reject = (_req, res) =>
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method Not Allowed (stateless mode)' },
      id: null,
    });
  r.get('/', reject);
  r.delete('/', reject);

  return r;
}
