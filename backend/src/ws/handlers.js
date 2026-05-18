// @ts-check
import { z } from 'zod';
import { hub } from './hub.js';
import * as broadcaster from './broadcaster.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../logger.js';
import { sendMessage } from '../services/message.service.js';
import { listMembers, getMembership } from '../services/membership.service.js';
import { isOnline } from '../services/presence.service.js';

const subscribeSchema = z.object({ room_id: z.number().int().positive() });
const unsubscribeSchema = z.object({ room_id: z.number().int().positive() });
const sendSchema = z.object({
  room_id: z.number().int().positive(),
  content: z.string().min(1).max(4000),
  client_msg_id: z.string().max(64).optional(),
});
const typingSchema = z.object({
  room_id: z.number().int().positive(),
  is_typing: z.boolean(),
});

/**
 * 处理一帧客户端 → 服务端消息。
 *
 * @param {import('ws').WebSocket} ws
 * @param {{ id:number, nickname:string, avatar:string }} user
 * @param {unknown} raw  原始消息（string | Buffer）
 */
export function dispatchFrame(ws, user, raw) {
  let frame;
  try {
    frame = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
  } catch {
    return sendError(ws, 'BAD_FRAME', '帧不是合法 JSON');
  }
  if (!frame || typeof frame !== 'object' || typeof frame.type !== 'string') {
    return sendError(ws, 'BAD_FRAME', '缺少 type 字段');
  }

  const id = typeof frame.id === 'string' ? frame.id : undefined;
  const data = frame.data ?? {};

  switch (frame.type) {
    case 'ping':
      return handlePing(ws);
    case 'subscribe':
      return handleSubscribe(ws, user, data, id);
    case 'unsubscribe':
      return handleUnsubscribe(ws, user, data, id);
    case 'send':
      return handleSend(ws, user, data, id);
    case 'typing':
      return handleTyping(ws, user, data);
    default:
      return sendError(ws, 'BAD_FRAME', `未知 type: ${frame.type}`);
  }
}

function handlePing(ws) {
  send(ws, { type: 'pong', data: { server_time: Date.now() } });
}

function handleSubscribe(ws, user, data, id) {
  let body;
  try {
    body = subscribeSchema.parse(data);
  } catch {
    return sendAckError(ws, 'subscribe', id, 'BAD_FRAME', 'subscribe.data 不合法');
  }
  const roomId = body.room_id;
  const m = getMembership(roomId, user.id);
  if (!m) {
    return sendAckError(ws, 'subscribe', id, 'NOT_MEMBER', '你不是该房间成员', {
      room_id: roomId,
    });
  }

  const { firstSubForUid } = hub.subscribe(ws, roomId);

  // 计算 online 用户列表（含 hub.has || presence 窗口内）
  const members = listMembers(roomId);
  const onlineUserIds = members
    .filter((mem) => isOnline(mem.user_id, mem.last_seen_at))
    .map((mem) => mem.user_id);

  send(ws, {
    type: 'subscribe:ack',
    id,
    data: { room_id: roomId, online_user_ids: onlineUserIds },
  });

  // 当前 uid 首次订阅这个房间 → 广播 online（跳过本人这条连接，避免回声）
  if (firstSubForUid) {
    broadcaster.emitPresenceChanged(user.id, true, [roomId], ws);
  }
}

function handleUnsubscribe(ws, user, data, id) {
  let body;
  try {
    body = unsubscribeSchema.parse(data);
  } catch {
    return sendAckError(ws, 'unsubscribe', id, 'BAD_FRAME', 'unsubscribe.data 不合法');
  }
  hub.unsubscribe(ws, body.room_id);
  send(ws, {
    type: 'unsubscribe:ack',
    id,
    data: { room_id: body.room_id },
  });
}

function handleSend(ws, user, data, id) {
  let body;
  try {
    body = sendSchema.parse(data);
  } catch {
    return sendAckError(ws, 'send', id, 'BAD_FRAME', 'send.data 不合法', {
      client_msg_id: data?.client_msg_id,
    });
  }

  try {
    const { message, idempotent } = sendMessage(user.id, body.room_id, {
      content: body.content,
      client_msg_id: body.client_msg_id,
    });
    send(ws, {
      type: 'send:ack',
      id,
      data: {
        client_msg_id: body.client_msg_id ?? null,
        message_id: message.id,
        created_at: message.created_at,
      },
    });
    if (!idempotent) broadcaster.emitMessageCreated(message);
  } catch (e) {
    if (e instanceof AppError) {
      return sendAckError(ws, 'send', id, e.code, e.message, {
        client_msg_id: body.client_msg_id ?? null,
      });
    }
    logger.error({ err: e }, 'ws send 异常');
    return sendAckError(ws, 'send', id, 'INTERNAL', '服务器内部错误', {
      client_msg_id: body.client_msg_id ?? null,
    });
  }
}

/**
 * typing：必须是房间成员；不发 ack，校验失败静默 drop。
 */
function handleTyping(ws, user, data) {
  let body;
  try {
    body = typingSchema.parse(data);
  } catch {
    return; // 静默
  }
  const m = getMembership(body.room_id, user.id);
  if (!m) return; // 静默
  hub.broadcastRoom(
    body.room_id,
    {
      type: 'typing',
      data: { room_id: body.room_id, user_id: user.id, is_typing: body.is_typing },
    },
    ws,
  );
}

function send(ws, frame) {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(frame));
  } catch {
    /* ignore */
  }
}

function sendError(ws, code, message) {
  send(ws, { type: 'error', data: { code, message } });
}

function sendAckError(ws, baseType, id, code, message, extra = {}) {
  send(ws, {
    type: `${baseType}:error`,
    id,
    data: { code, message, ...extra },
  });
}
