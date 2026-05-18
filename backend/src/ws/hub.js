// @ts-check
/**
 * WebSocket 连接 + 房间订阅注册表。
 *
 * 注意：本模块只管"谁连着 / 谁订阅了哪个房间"，不维护任何在线判定状态。
 * online 判定一律走 presence.service.isOnline()（hub.has + last_seen_at 窗口）。
 */

class Hub {
  constructor() {
    /** @type {Map<number, Set<import('ws').WebSocket>>} uid → 连接集合 */
    this.userConns = new Map();
    /** @type {Map<number, Set<import('ws').WebSocket>>} room_id → 订阅该房间的连接集合 */
    this.roomSubscribers = new Map();
    /** @type {Map<number, NodeJS.Timeout>} uid → 离线广播延迟定时器 */
    this.offlineTimers = new Map();
  }

  /**
   * 新连接接入。调用方需保证 ws 上还没挂 uid / subscribedRooms。
   * @param {number} uid
   * @param {import('ws').WebSocket} ws
   */
  addConn(uid, ws) {
    /** @type {any} */ (ws).uid = uid;
    /** @type {any} */ (ws).subscribedRooms = new Set();

    // 取消"等待离线"广播
    const t = this.offlineTimers.get(uid);
    if (t) {
      clearTimeout(t);
      this.offlineTimers.delete(uid);
    }

    let set = this.userConns.get(uid);
    if (!set) {
      set = new Set();
      this.userConns.set(uid, set);
    }
    set.add(ws);
  }

  /**
   * 连接关闭。返回 { lastConn, rooms } 供调用方触发延迟离线广播。
   * @param {import('ws').WebSocket} ws
   * @returns {{ uid: number, lastConn: boolean, rooms: number[] }}
   */
  removeConn(ws) {
    const w = /** @type {any} */ (ws);
    const uid = w.uid;
    /** @type {Set<number>} */
    const rooms = w.subscribedRooms ?? new Set();
    const roomsSnapshot = [...rooms];

    // 从每个房间订阅集合移除
    for (const rid of rooms) {
      const subs = this.roomSubscribers.get(rid);
      if (subs) {
        subs.delete(ws);
        if (subs.size === 0) this.roomSubscribers.delete(rid);
      }
    }
    rooms.clear();

    // 从 userConns 移除
    const set = this.userConns.get(uid);
    let lastConn = false;
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        this.userConns.delete(uid);
        lastConn = true;
      }
    }

    return { uid, lastConn, rooms: roomsSnapshot };
  }

  /**
   * 该 uid 是否有任何活跃连接。
   * @param {number} uid
   */
  has(uid) {
    return this.userConns.has(uid);
  }

  /**
   * ws 订阅房间。若该 ws 已订阅则幂等返回 false。
   * @param {import('ws').WebSocket} ws
   * @param {number} roomId
   * @returns {{ added: boolean, firstSubForUid: boolean }}
   */
  subscribe(ws, roomId) {
    const w = /** @type {any} */ (ws);
    if (w.subscribedRooms.has(roomId)) {
      return { added: false, firstSubForUid: false };
    }
    w.subscribedRooms.add(roomId);

    let subs = this.roomSubscribers.get(roomId);
    if (!subs) {
      subs = new Set();
      this.roomSubscribers.set(roomId, subs);
    }
    subs.add(ws);

    // 该 uid 是否首次订阅此房间（其他连接没订阅）
    const conns = this.userConns.get(w.uid) ?? new Set();
    let firstSubForUid = true;
    for (const otherWs of conns) {
      if (otherWs === ws) continue;
      if (/** @type {any} */ (otherWs).subscribedRooms?.has(roomId)) {
        firstSubForUid = false;
        break;
      }
    }
    return { added: true, firstSubForUid };
  }

  /**
   * ws 取消订阅。
   * @param {import('ws').WebSocket} ws
   * @param {number} roomId
   */
  unsubscribe(ws, roomId) {
    const w = /** @type {any} */ (ws);
    if (!w.subscribedRooms.has(roomId)) return { removed: false };
    w.subscribedRooms.delete(roomId);

    const subs = this.roomSubscribers.get(roomId);
    if (subs) {
      subs.delete(ws);
      if (subs.size === 0) this.roomSubscribers.delete(roomId);
    }
    return { removed: true };
  }

  /**
   * 移除 uid 在指定房间的所有订阅（用于踢人 / 删房时清理）。
   * @param {number} uid
   * @param {number} roomId
   */
  removeUserFromRoom(uid, roomId) {
    const conns = this.userConns.get(uid);
    if (!conns) return;
    for (const ws of conns) {
      const w = /** @type {any} */ (ws);
      if (w.subscribedRooms?.has(roomId)) {
        w.subscribedRooms.delete(roomId);
        const subs = this.roomSubscribers.get(roomId);
        if (subs) {
          subs.delete(ws);
          if (subs.size === 0) this.roomSubscribers.delete(roomId);
        }
      }
    }
  }

  /**
   * 清空房间所有订阅（删房时调用）。订阅者列表用于广播前先发 room_deleted。
   * @param {number} roomId
   */
  clearRoom(roomId) {
    const subs = this.roomSubscribers.get(roomId);
    if (!subs) return;
    for (const ws of subs) {
      /** @type {any} */ (ws).subscribedRooms?.delete(roomId);
    }
    this.roomSubscribers.delete(roomId);
  }

  /**
   * 推送给单个用户的所有连接。
   * @param {number} uid
   * @param {object} frame
   */
  sendToUser(uid, frame) {
    const conns = this.userConns.get(uid);
    if (!conns) return;
    const payload = JSON.stringify(frame);
    for (const ws of conns) sendRaw(ws, payload);
  }

  /**
   * 广播给某房间的所有订阅连接。
   * @param {number} roomId
   * @param {object} frame
   * @param {import('ws').WebSocket} [exceptWs]
   */
  broadcastRoom(roomId, frame, exceptWs) {
    const subs = this.roomSubscribers.get(roomId);
    if (!subs) return;
    const payload = JSON.stringify(frame);
    for (const ws of subs) {
      if (ws === exceptWs) continue;
      sendRaw(ws, payload);
    }
  }

  /**
   * 取房间内所有订阅连接的 uid 集合（去重）。
   * @param {number} roomId
   * @returns {Set<number>}
   */
  subscribedUidsInRoom(roomId) {
    const subs = this.roomSubscribers.get(roomId);
    const uids = new Set();
    if (!subs) return uids;
    for (const ws of subs) uids.add(/** @type {any} */ (ws).uid);
    return uids;
  }

  /**
   * 测试 / 关停用：清空所有状态。
   */
  reset() {
    for (const t of this.offlineTimers.values()) clearTimeout(t);
    this.offlineTimers.clear();
    this.userConns.clear();
    this.roomSubscribers.clear();
  }
}

/**
 * @param {import('ws').WebSocket} ws
 * @param {string} payload
 */
function sendRaw(ws, payload) {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(payload);
  } catch {
    /* 单条发送失败不影响其他连接 */
  }
}

export const hub = new Hub();
