import { getDb } from '../db/index.js';
import { err } from '../utils/errors.js';
import { isOnline } from './presence.service.js';

export function getRoomById(roomId) {
  const db = getDb();
  return (
    db
      .prepare(
        `SELECT id, code, name, password_hash, owner_id, max_members, created_at, updated_at, deleted_at
         FROM rooms WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(roomId) ?? null
  );
}

export function getRoomByCode(code) {
  const db = getDb();
  return (
    db
      .prepare(
        `SELECT id, code, name, password_hash, owner_id, max_members, created_at, updated_at, deleted_at
         FROM rooms WHERE code = ? AND deleted_at IS NULL`,
      )
      .get(code) ?? null
  );
}

export function getMembership(roomId, userId) {
  const db = getDb();
  return (
    db
      .prepare(
        `SELECT room_id, user_id, role, joined_at FROM room_members
         WHERE room_id = ? AND user_id = ?`,
      )
      .get(roomId, userId) ?? null
  );
}

export function requireRoom(roomId) {
  const room = getRoomById(roomId);
  if (!room) throw err('ROOM_NOT_FOUND', '房间不存在');
  return room;
}

export function requireMember(roomId, userId) {
  const m = getMembership(roomId, userId);
  if (!m) throw err('NOT_MEMBER', '你不是该房间成员');
  return m;
}

export function requireOwner(roomId, userId) {
  const room = requireRoom(roomId);
  if (room.owner_id !== userId) throw err('NOT_OWNER', '仅房主可执行此操作');
  return room;
}

/**
 * 房间成员（带在线状态）。
 */
export function listMembers(roomId) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT u.id AS user_id, u.username, u.nickname, u.avatar, u.last_seen_at, m.role, m.joined_at
       FROM room_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.room_id = ?
       ORDER BY m.joined_at ASC`,
    )
    .all(roomId);
  return rows.map((r) => ({
    user_id: r.user_id,
    username: r.username,
    nickname: r.nickname,
    avatar: r.avatar,
    role: r.role,
    online: isOnline(r.user_id, r.last_seen_at),
    last_seen_at: r.last_seen_at,
    joined_at: r.joined_at,
  }));
}

export function countMembers(roomId) {
  const db = getDb();
  const r = db
    .prepare('SELECT COUNT(*) AS c FROM room_members WHERE room_id = ?')
    .get(roomId);
  return r?.c ?? 0;
}

export function isBanned(roomId, userId) {
  const db = getDb();
  return !!db
    .prepare('SELECT 1 FROM room_bans WHERE room_id = ? AND user_id = ?')
    .get(roomId, userId);
}
