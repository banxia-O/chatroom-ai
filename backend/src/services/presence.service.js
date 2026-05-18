import { getDb } from '../db/index.js';

// 写 last_seen_at 的节流窗口（ms）。同一 uid 在窗口内只写一次。
const TOUCH_THROTTLE_MS = 30_000;

// 在线判定：上次 touch 在 N ms 内视为 online（即使没有 WS 连接，也用于 Agent）。
const ONLINE_WINDOW_MS = 90_000;

const lastTouchAt = new Map();

let _hub = null;

/**
 * 由 ws/server.js 启动时注入。
 * @param {{ has: (uid:number) => boolean }} hub
 */
export function setHub(hub) {
  _hub = hub;
}

/**
 * 由 requireAuth / WS 连接 / MCP 调用触发。带节流，避免高频写库。
 */
export function touch(userId) {
  const now = Date.now();
  const last = lastTouchAt.get(userId) ?? 0;
  if (now - last < TOUCH_THROTTLE_MS) return;
  lastTouchAt.set(userId, now);
  getDb()
    .prepare('UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(userId);
}

/**
 * online 判定：WS 在场 OR last_seen_at 在 ONLINE_WINDOW_MS 内。
 */
export function isOnline(userId, lastSeenAt) {
  if (_hub && _hub.has(userId)) return true;
  if (!lastSeenAt) return false;
  const ts = new Date(lastSeenAt + (lastSeenAt.endsWith('Z') ? '' : 'Z')).getTime();
  return Date.now() - ts < ONLINE_WINDOW_MS;
}
