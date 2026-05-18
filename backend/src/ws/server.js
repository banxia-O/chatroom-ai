// @ts-check
import { WebSocketServer } from 'ws';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { extractWsToken } from '../auth/middleware.js';
import { verifyToken } from '../auth/jwt.js';
import { getUserById } from '../services/user.service.js';
import { setHub, touch as touchPresence } from '../services/presence.service.js';
import { hub } from './hub.js';
import { dispatchFrame } from './handlers.js';
import { schedulePresenceOffline } from './broadcaster.js';

let _wss = null;

/**
 * 把 WebSocket 升级监听挂到指定 http server。可重入：同一 server 不会重复挂。
 * @param {import('http').Server} server
 */
export function attachWebSocket(server) {
  if (server.__wsAttached) return _wss;
  server.__wsAttached = true;

  setHub(hub);

  const wss = new WebSocketServer({
    noServer: true,
    // 客户端发 `bearer,<token>`。服务端只能 echo 已知的 subprotocol 名
    // （token 是 secret，不能回写）。所以选 `bearer`。
    handleProtocols: (protocols /** @type {Set<string>} */) => {
      return protocols.has('bearer') ? 'bearer' : false;
    },
  });
  _wss = wss;

  server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    if (!url.startsWith(config.ws.path)) {
      reject401(socket, 'NOT_FOUND');
      return;
    }
    const token = extractWsToken(req);
    if (!token) {
      reject401(socket, 'UNAUTHENTICATED');
      return;
    }
    let uid;
    try {
      ({ uid } = verifyToken(token));
    } catch {
      reject401(socket, 'UNAUTHENTICATED');
      return;
    }
    const user = getUserById(uid);
    if (!user) {
      reject401(socket, 'UNAUTHENTICATED');
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, user);
    });
  });

  wss.on('connection', (ws, _req, user) => {
    setupConnection(ws, user);
  });

  return wss;
}

/**
 * @param {import('ws').WebSocket} ws
 * @param {{ id:number, nickname:string, avatar:string }} user
 */
function setupConnection(ws, user) {
  hub.addConn(user.id, ws);
  try {
    touchPresence(user.id);
  } catch {
    /* ignore */
  }

  // ready 帧
  try {
    ws.send(
      JSON.stringify({
        type: 'ready',
        data: { user_id: user.id, server_time: Date.now() },
      }),
    );
  } catch {
    /* ignore */
  }

  scheduleHeartbeat(ws);

  ws.on('message', (raw) => {
    refreshHeartbeat(ws);
    try {
      dispatchFrame(ws, user, raw);
    } catch (e) {
      logger.error({ err: e, uid: user.id }, 'ws 帧分发异常');
    }
    try {
      touchPresence(user.id);
    } catch {
      /* ignore */
    }
  });

  ws.on('close', () => {
    clearHeartbeat(ws);
    const { uid, lastConn, rooms } = hub.removeConn(ws);
    if (lastConn && rooms.length) {
      schedulePresenceOffline(uid, rooms);
    }
  });

  ws.on('error', (e) => {
    logger.warn({ err: e, uid: user.id }, 'ws 连接错误');
  });
}

function scheduleHeartbeat(ws) {
  refreshHeartbeat(ws);
}

function refreshHeartbeat(ws) {
  const w = /** @type {any} */ (ws);
  if (w.__hbTimer) clearTimeout(w.__hbTimer);
  w.__hbTimer = setTimeout(() => {
    try {
      ws.terminate();
    } catch {
      /* ignore */
    }
  }, config.ws.heartbeatTimeoutMs);
  if (typeof w.__hbTimer.unref === 'function') w.__hbTimer.unref();
}

function clearHeartbeat(ws) {
  const w = /** @type {any} */ (ws);
  if (w.__hbTimer) {
    clearTimeout(w.__hbTimer);
    w.__hbTimer = null;
  }
}

/**
 * @param {import('net').Socket} socket
 * @param {string} reason
 */
function reject401(socket, reason) {
  try {
    socket.write(
      `HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\nX-Reject-Reason: ${reason}\r\n\r\n`,
    );
  } catch {
    /* ignore */
  }
  socket.destroy();
}
