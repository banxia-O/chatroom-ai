import { getDb } from '../db/index.js';
import { err } from '../utils/errors.js';
import { requireRoom, getMembership } from './membership.service.js';
import { extractMentions } from '../utils/mention.js';
import { getUsersByUsernames } from './user.service.js';

const MESSAGE_COLUMNS = `m.id, m.room_id, m.user_id, m.content, m.type, m.client_msg_id,
  m.mentioned_user_ids, m.created_at, u.nickname, u.avatar`;

function shapeMessage(row) {
  return {
    id: row.id,
    room_id: row.room_id,
    user_id: row.user_id,
    nickname: row.nickname,
    avatar: row.avatar,
    content: row.content,
    type: row.type,
    client_msg_id: row.client_msg_id,
    mentioned_user_ids: row.mentioned_user_ids
      ? JSON.parse(row.mentioned_user_ids)
      : [],
    created_at: row.created_at,
  };
}

/**
 * 发送消息（业务事务内不做广播；广播由调用方在事务外触发）。
 * 幂等：相同 (room_id, user_id, client_msg_id) 返回旧消息。
 */
export function sendMessage(userId, roomId, { content, client_msg_id }) {
  const db = getDb();
  requireRoom(roomId);
  const m = getMembership(roomId, userId);
  if (!m) throw err('NOT_MEMBER', '你不是该房间成员');

  // 提取 mention
  const usernames = extractMentions(content);
  const mentioned = usernames.length ? getUsersByUsernames(usernames) : [];
  const mentionedIds = mentioned.map((u) => u.id);
  const mentionedJson = mentionedIds.length ? JSON.stringify(mentionedIds) : null;

  // 幂等检查
  if (client_msg_id) {
    const existing = db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS}
         FROM messages m JOIN users u ON u.id = m.user_id
         WHERE m.room_id = ? AND m.user_id = ? AND m.client_msg_id = ?`,
      )
      .get(roomId, userId, client_msg_id);
    if (existing) return { message: shapeMessage(existing), idempotent: true };
  }

  const info = db
    .prepare(
      `INSERT INTO messages (room_id, user_id, content, type, client_msg_id, mentioned_user_ids)
       VALUES (?, ?, ?, 'text', ?, ?)`,
    )
    .run(roomId, userId, content, client_msg_id ?? null, mentionedJson);

  const row = db
    .prepare(
      `SELECT ${MESSAGE_COLUMNS}
       FROM messages m JOIN users u ON u.id = m.user_id
       WHERE m.id = ?`,
    )
    .get(info.lastInsertRowid);

  return { message: shapeMessage(row), idempotent: false };
}

/**
 * 历史消息（游标式翻页）。
 * 服务端按 id < before_id ORDER BY id DESC LIMIT，
 * 返回值按 id 升序（旧 → 新），附 has_more。
 */
export function listMessages(userId, roomId, { before_id, limit = 100 }) {
  const db = getDb();
  requireRoom(roomId);
  const m = getMembership(roomId, userId);
  if (!m) throw err('NOT_MEMBER', '你不是该房间成员');

  const params = [roomId];
  let where = 'm.room_id = ?';
  if (before_id) {
    where += ' AND m.id < ?';
    params.push(before_id);
  }
  // 多查 1 条以判定 has_more
  params.push(limit + 1);

  const rows = db
    .prepare(
      `SELECT ${MESSAGE_COLUMNS}
       FROM messages m JOIN users u ON u.id = m.user_id
       WHERE ${where}
       ORDER BY m.id DESC
       LIMIT ?`,
    )
    .all(...params);

  const has_more = rows.length > limit;
  const slice = (has_more ? rows.slice(0, limit) : rows).reverse();
  return { messages: slice.map(shapeMessage), has_more };
}
