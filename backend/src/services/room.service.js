import { getDb } from '../db/index.js';
import { hashPassword, comparePassword } from '../auth/password.js';
import { config } from '../config.js';
import { err } from '../utils/errors.js';
import { generateUniqueRoomCode } from '../utils/room-code.js';
import {
  getRoomById,
  getRoomByCode,
  getMembership,
  requireRoom,
  requireOwner,
  listMembers,
  countMembers,
  isBanned,
} from './membership.service.js';
import {
  assertNotLocked,
  recordFailure,
  reset as resetAttempts,
} from './join-attempt.service.js';

/**
 * 创建房间。创建者自动成为 owner 成员。
 */
export async function createRoom(ownerId, { name, password, max_members }) {
  const db = getDb();
  const hash = await hashPassword(password);
  const max = max_members ?? config.room.defaultMaxMembers;

  const code = generateUniqueRoomCode((c) => {
    const exists = db.prepare('SELECT 1 FROM rooms WHERE code = ?').get(c);
    return !exists;
  });

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO rooms (code, name, password_hash, owner_id, max_members)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(code, name, hash, ownerId, max);
    const roomId = Number(info.lastInsertRowid);
    db.prepare(
      `INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, 'owner')`,
    ).run(roomId, ownerId);
    return roomId;
  });

  const roomId = tx();
  return shapeRoom(getRoomById(roomId));
}

/**
 * 加入房间。
 * 流程：
 *   1) ROOM_NOT_FOUND
 *   2) 黑名单 → ROOM_BANNED
 *   3) 已是成员 → 直接返回
 *   4) 锁定中 → ROOM_LOCKED
 *   5) 密码错 → recordFailure → INVALID_PASSWORD（或锁定）
 *   6) 人满 → ROOM_FULL
 *   7) 写 members + reset 计数
 */
export async function joinRoom(userId, { code, password }) {
  const room = getRoomByCode(code);
  if (!room) throw err('ROOM_NOT_FOUND', '房间不存在');

  if (isBanned(room.id, userId)) {
    throw err('ROOM_BANNED', '你已被房主移出该房间');
  }

  const existing = getMembership(room.id, userId);
  if (existing) {
    return {
      room: shapeRoom(room),
      members: listMembers(room.id),
      already_member: true,
    };
  }

  assertNotLocked(userId, room.id);

  const ok = await comparePassword(password, room.password_hash);
  if (!ok) {
    const r = recordFailure(userId, room.id);
    if (r.locked_until) {
      throw err('ROOM_LOCKED', `连续输错密码 ${config.room.failThreshold} 次，房间已锁定 ${config.room.lockMinutes} 分钟`, {
        locked_until: r.locked_until,
        remaining_minutes: config.room.lockMinutes,
      });
    }
    throw err('INVALID_PASSWORD', '房间密码错误', {
      remaining_attempts: Math.max(0, config.room.failThreshold - r.fail_count),
    });
  }

  if (countMembers(room.id) >= room.max_members) {
    throw err('ROOM_FULL', '房间人数已满');
  }

  getDb()
    .prepare(
      `INSERT OR IGNORE INTO room_members (room_id, user_id, role) VALUES (?, ?, 'member')`,
    )
    .run(room.id, userId);

  resetAttempts(userId, room.id);

  return {
    room: shapeRoom(room),
    members: listMembers(room.id),
    already_member: false,
  };
}

/**
 * 自愿退出。
 * - 普通成员：直接删 room_members 行
 * - 房主：若仍有其他成员，自动转给最早加入的成员；只剩房主则删除房间
 */
export function leaveRoom(userId, roomId) {
  const db = getDb();
  const room = requireRoom(roomId);
  const membership = getMembership(roomId, userId);
  if (!membership) throw err('NOT_MEMBER', '你不是该房间成员');

  const isOwner = room.owner_id === userId;

  if (!isOwner) {
    db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?').run(
      roomId,
      userId,
    );
    return { ok: true };
  }

  // 房主走人逻辑
  const others = db
    .prepare(
      `SELECT user_id FROM room_members
       WHERE room_id = ? AND user_id != ?
       ORDER BY joined_at ASC, user_id ASC
       LIMIT 1`,
    )
    .get(roomId, userId);

  if (!others) {
    // 只剩房主 → 软删房间
    db.prepare(
      `UPDATE rooms SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(roomId);
    db.prepare('DELETE FROM room_members WHERE room_id = ?').run(roomId);
    return { ok: true, deleted: true };
  }

  const newOwnerId = others.user_id;
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE rooms SET owner_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(newOwnerId, roomId);
    db.prepare(
      `UPDATE room_members SET role = 'owner' WHERE room_id = ? AND user_id = ?`,
    ).run(roomId, newOwnerId);
    db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?').run(
      roomId,
      userId,
    );
  });
  tx();

  return { ok: true, transferred_to: newOwnerId };
}

/**
 * 房主踢人。写 room_bans，删 room_members。
 */
export function kickMember(ownerId, roomId, targetUserId) {
  const db = getDb();
  const room = requireOwner(roomId, ownerId);
  if (targetUserId === ownerId) throw err('INVALID_INPUT', '不能踢自己');

  const m = getMembership(roomId, targetUserId);
  if (!m) throw err('NOT_MEMBER', '该用户不是房间成员');

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?').run(
      roomId,
      targetUserId,
    );
    db.prepare(
      `INSERT OR IGNORE INTO room_bans (room_id, user_id) VALUES (?, ?)`,
    ).run(roomId, targetUserId);
    db.prepare(
      `UPDATE rooms SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(roomId);
  });
  tx();
  return { ok: true, room_id: room.id, user_id: targetUserId };
}

/**
 * 房主软删房间。级联清成员。
 */
export function deleteRoom(ownerId, roomId) {
  const db = getDb();
  requireOwner(roomId, ownerId);
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE rooms SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(roomId);
    db.prepare('DELETE FROM room_members WHERE room_id = ?').run(roomId);
  });
  tx();
  return { ok: true };
}

/**
 * 房主改密码。
 */
export async function updateRoomPassword(ownerId, roomId, newPassword) {
  requireOwner(roomId, ownerId);
  const hash = await hashPassword(newPassword);
  getDb()
    .prepare(
      `UPDATE rooms SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .run(hash, roomId);
  return { ok: true };
}

/**
 * 我的房间列表（加入的、未删的）。
 */
export function listMyRooms(userId) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT r.id, r.code, r.name, r.owner_id, r.max_members, r.created_at, r.updated_at,
              m.role,
              (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) AS member_count,
              (SELECT MAX(created_at) FROM messages WHERE room_id = r.id) AS last_message_at
       FROM rooms r
       JOIN room_members m ON m.room_id = r.id
       WHERE m.user_id = ? AND r.deleted_at IS NULL
       ORDER BY COALESCE(last_message_at, r.created_at) DESC`,
    )
    .all(userId);
  return rows;
}

/**
 * 房间详情 + 成员。要求调用者是成员。
 */
export function getRoomDetail(userId, roomId) {
  const room = requireRoom(roomId);
  const m = getMembership(roomId, userId);
  if (!m) throw err('NOT_MEMBER', '你不是该房间成员');
  return {
    room: shapeRoom(room),
    members: listMembers(roomId),
    my_role: m.role,
  };
}

function shapeRoom(room) {
  if (!room) return null;
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    owner_id: room.owner_id,
    max_members: room.max_members,
    created_at: room.created_at,
    updated_at: room.updated_at,
  };
}
