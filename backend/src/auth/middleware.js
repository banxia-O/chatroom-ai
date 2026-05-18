import { verifyToken } from './jwt.js';
import { getUserById } from '../services/user.service.js';
import { err } from '../utils/errors.js';
import { touch as touchPresence } from '../services/presence.service.js';

export function extractToken(req) {
  const h = req.headers?.authorization;
  if (typeof h === 'string' && h.startsWith('Bearer ')) {
    return h.slice('Bearer '.length).trim();
  }
  // fallback：cookie/query 之类暂不支持
  return null;
}

/**
 * Express 中间件：验证 Authorization: Bearer。
 * 成功后将 user 挂在 req.user。
 */
export function requireAuth(req, _res, next) {
  try {
    const token = extractToken(req);
    if (!token) throw err('UNAUTHENTICATED', '缺少 Authorization 头');
    const { uid } = verifyToken(token);
    const user = getUserById(uid);
    if (!user) throw err('UNAUTHENTICATED', '用户不存在');
    req.user = user;
    // touch presence（节流由 service 内部完成）
    try {
      touchPresence(uid);
    } catch {
      /* presence touch 失败不影响请求 */
    }
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * 从 WebSocket Sec-WebSocket-Protocol 头中提取 token。
 * 客户端约定：`Sec-WebSocket-Protocol: bearer,<token>`。
 *
 * 同时为浏览器 fallback 支持 ?token= 查询参数。
 * @returns {string | null}
 */
export function extractWsToken(req) {
  const protoHeader = req.headers?.['sec-websocket-protocol'];
  if (typeof protoHeader === 'string') {
    const parts = protoHeader.split(',').map((s) => s.trim());
    const idx = parts.indexOf('bearer');
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  }
  // fallback
  try {
    const u = new URL(req.url, 'http://localhost');
    const t = u.searchParams.get('token');
    if (t) return t;
  } catch {
    /* ignore */
  }
  return null;
}
