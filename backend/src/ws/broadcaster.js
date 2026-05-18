// @ts-check
/**
 * 业务侧统一广播出口。REST 路由 / WS handler 都从这里发广播。
 *
 * 注意：所有广播必须在 db 事务外触发（事务里调 ws.send 会拖慢事务、放大锁竞争）。
 */
import { hub } from './hub.js';
import { config } from '../config.js';

/**
 * @param {{ id:number, room_id:number, user_id:number, nickname:string, avatar:string,
 *           content:string, type:string, mentioned_user_ids:number[], created_at:string }} message
 */
export function emitMessageCreated(message) {
  hub.broadcastRoom(message.room_id, {
    type: 'message',
    data: {
      room_id: message.room_id,
      message: {
        id: message.id,
        user_id: message.user_id,
        nickname: message.nickname,
        avatar: message.avatar,
        content: message.content,
        type: message.type,
        mentioned_user_ids: message.mentioned_user_ids,
        created_at: message.created_at,
      },
    },
  });
}

/**
 * @param {number} roomId
 * @param {{ id:number, username:string, nickname:string, avatar:string }} user
 */
export function emitMemberJoined(roomId, user) {
  hub.broadcastRoom(roomId, {
    type: 'member_joined',
    data: { room_id: roomId, user },
  });
}

/**
 * @param {number} roomId
 * @param {number} userId
 */
export function emitMemberLeft(roomId, userId) {
  hub.broadcastRoom(roomId, {
    type: 'member_left',
    data: { room_id: roomId, user_id: userId },
  });
  // 离开房间后该 uid 不再需要订阅这个房间；清掉避免后续广播仍打到它
  hub.removeUserFromRoom(userId, roomId);
}

/**
 * 踢人：先广播（包括被踢者自己，让前端 UI 主动跳走），再清订阅。
 * @param {number} roomId
 * @param {number} userId
 * @param {number} byUserId
 */
export function emitMemberKicked(roomId, userId, byUserId) {
  hub.broadcastRoom(roomId, {
    type: 'member_kicked',
    data: { room_id: roomId, user_id: userId, by: byUserId },
  });
  hub.removeUserFromRoom(userId, roomId);
}

/**
 * 删房：先广播给所有订阅者，再清空订阅。
 * @param {number} roomId
 */
export function emitRoomDeleted(roomId) {
  hub.broadcastRoom(roomId, {
    type: 'room_deleted',
    data: { room_id: roomId },
  });
  hub.clearRoom(roomId);
}

/**
 * @param {number} roomId
 * @param {Array<'name'|'password'|'max_members'|'owner'>} changes
 */
export function emitRoomUpdated(roomId, changes) {
  hub.broadcastRoom(roomId, {
    type: 'room_updated',
    data: { room_id: roomId, changes },
  });
}

/**
 * 在 uid 已订阅的所有房间广播 online 变化。
 * @param {number} uid
 * @param {boolean} online
 * @param {number[]} [explicitRooms] 仅广播到指定房间（用于离线 snapshot）
 * @param {import('ws').WebSocket} [exceptWs] 跳过该连接（避免给本人发自己的 presence）
 */
export function emitPresenceChanged(uid, online, explicitRooms, exceptWs) {
  const rooms = explicitRooms ?? collectUserSubscribedRooms(uid);
  for (const rid of rooms) {
    hub.broadcastRoom(
      rid,
      {
        type: 'presence',
        data: { room_id: rid, user_id: uid, online },
      },
      exceptWs,
    );
  }
}

/**
 * 安排"延迟离线"广播。在 offlineDelayMs 内若用户重连则取消。
 * @param {number} uid
 * @param {number[]} rooms snapshot 用户最后一个连接在断时所订阅的房间列表
 */
export function schedulePresenceOffline(uid, rooms) {
  if (!rooms.length) return;
  const existing = hub.offlineTimers.get(uid);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    hub.offlineTimers.delete(uid);
    if (hub.has(uid)) return; // 重连了，跳过
    emitPresenceChanged(uid, false, rooms);
  }, config.presence.offlineDelayMs);
  // Node 下不阻塞退出
  if (typeof t.unref === 'function') t.unref();
  hub.offlineTimers.set(uid, t);
}

/**
 * @param {number} uid
 * @returns {number[]}
 */
function collectUserSubscribedRooms(uid) {
  const conns = hub.userConns.get(uid);
  if (!conns) return [];
  const set = new Set();
  for (const ws of conns) {
    const r = /** @type {any} */ (ws).subscribedRooms;
    if (r) for (const rid of r) set.add(rid);
  }
  return [...set];
}
