import { getDb } from '../db/index.js';
import { hashPassword, comparePassword } from '../auth/password.js';
import { signToken } from '../auth/jwt.js';
import { err } from '../utils/errors.js';

/**
 * @typedef {Object} User
 * @property {number} id
 * @property {string} username
 * @property {string} nickname
 * @property {string} avatar
 * @property {string} created_at
 * @property {string} updated_at
 * @property {string | null} last_seen_at
 */

const USER_COLUMNS = `id, username, nickname, avatar, created_at, updated_at, last_seen_at`;

export function getUserById(id) {
  const db = getDb();
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id) ?? null;
}

export function getUserByUsername(username) {
  const db = getDb();
  return (
    db
      .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE username = ? COLLATE NOCASE`)
      .get(username) ?? null
  );
}

export function getUsersByUsernames(usernames) {
  if (!usernames.length) return [];
  const db = getDb();
  const placeholders = usernames.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT ${USER_COLUMNS} FROM users WHERE username IN (${placeholders}) COLLATE NOCASE`,
    )
    .all(...usernames);
}

/**
 * 注册新用户。
 * @returns {Promise<{ user: User, token: string }>}
 */
export async function registerUser({ username, password, nickname, avatar }) {
  const db = getDb();
  const exists = db
    .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE')
    .get(username);
  if (exists) throw err('USERNAME_TAKEN', '用户名已被占用');

  const hash = await hashPassword(password);
  const info = db
    .prepare(
      `INSERT INTO users (username, password_hash, nickname, avatar)
       VALUES (?, ?, ?, ?)`,
    )
    .run(username, hash, nickname, avatar ?? '😊');

  const user = getUserById(info.lastInsertRowid);
  const token = signToken({ uid: user.id });
  return { user, token };
}

/**
 * 校验登录凭据，返回 token。
 * @returns {Promise<{ user: User, token: string }>}
 */
export async function authenticate({ username, password }) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, password_hash FROM users WHERE username = ? COLLATE NOCASE`,
    )
    .get(username);
  if (!row) throw err('INVALID_CREDENTIALS', '用户名或密码错误');

  const ok = await comparePassword(password, row.password_hash);
  if (!ok) throw err('INVALID_CREDENTIALS', '用户名或密码错误');

  const user = getUserById(row.id);
  const token = signToken({ uid: user.id });
  return { user, token };
}

/**
 * 更新昵称 / 头像。
 */
export function updateProfile(userId, { nickname, avatar }) {
  const db = getDb();
  const fields = [];
  const values = [];
  if (nickname !== undefined) {
    fields.push('nickname = ?');
    values.push(nickname);
  }
  if (avatar !== undefined) {
    fields.push('avatar = ?');
    values.push(avatar);
  }
  if (!fields.length) return getUserById(userId);

  fields.push("updated_at = CURRENT_TIMESTAMP");
  values.push(userId);

  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getUserById(userId);
}
