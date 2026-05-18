import { getDb } from '../db/index.js';
import { config } from '../config.js';
import { err } from '../utils/errors.js';

/**
 * 检查 (user, room) 是否被锁定；锁定中则抛 ROOM_LOCKED。
 */
export function assertNotLocked(userId, roomId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT fail_count, locked_until FROM join_attempts
       WHERE user_id = ? AND room_id = ?`,
    )
    .get(userId, roomId);
  if (!row?.locked_until) return;

  // 注意 SQLite CURRENT_TIMESTAMP 不带时区，按 UTC 处理
  const until = new Date(
    row.locked_until + (row.locked_until.endsWith('Z') ? '' : 'Z'),
  );
  const now = new Date();
  if (until > now) {
    const remainingMin = Math.ceil((until.getTime() - now.getTime()) / 60_000);
    throw err('ROOM_LOCKED', `房间已锁定，剩余 ${remainingMin} 分钟`, {
      locked_until: until.toISOString(),
      remaining_minutes: remainingMin,
    });
  }
}

/**
 * 记录一次失败。达到阈值则置 locked_until = now + ROOM_LOCK_MINUTES。
 * 解锁时间到达后下一次失败重新计数。
 */
export function recordFailure(userId, roomId) {
  const db = getDb();
  const tx = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT fail_count, locked_until FROM join_attempts
         WHERE user_id = ? AND room_id = ?`,
      )
      .get(userId, roomId);

    let nextCount = (row?.fail_count ?? 0) + 1;
    let lockedUntil = null;

    // 若已过解锁时间，则重置计数后再 +1
    if (row?.locked_until) {
      const until = new Date(
        row.locked_until + (row.locked_until.endsWith('Z') ? '' : 'Z'),
      );
      if (until <= new Date()) nextCount = 1;
    }

    if (nextCount >= config.room.failThreshold) {
      const until = new Date(Date.now() + config.room.lockMinutes * 60_000);
      lockedUntil = until.toISOString().slice(0, 19).replace('T', ' ');
    }

    db.prepare(
      `INSERT INTO join_attempts (user_id, room_id, fail_count, locked_until, last_attempt)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, room_id) DO UPDATE SET
         fail_count = excluded.fail_count,
         locked_until = excluded.locked_until,
         last_attempt = CURRENT_TIMESTAMP`,
    ).run(userId, roomId, nextCount, lockedUntil);

    return { fail_count: nextCount, locked_until: lockedUntil };
  });
  return tx();
}

/**
 * 加入成功后调用，清零计数。
 */
export function reset(userId, roomId) {
  getDb()
    .prepare(`DELETE FROM join_attempts WHERE user_id = ? AND room_id = ?`)
    .run(userId, roomId);
}
