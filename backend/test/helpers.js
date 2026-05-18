import request from 'supertest';
import { buildApp } from '../src/server.js';
import { migrate } from '../src/db/migrate.js';
import { getDb, closeDb } from '../src/db/index.js';
import { resetAllLimiters } from '../src/utils/rate-limit.js';

let _app = null;
let _initialized = false;

function ensureInit() {
  if (!_initialized) {
    migrate();
    _app = buildApp();
    _initialized = true;
  }
}

export function app() {
  ensureInit();
  return _app;
}

export function resetDb() {
  ensureInit();
  const db = getDb();
  // 按顺序清表，留 schema
  const tables = [
    'messages',
    'room_bans',
    'join_attempts',
    'room_members',
    'rooms',
    'users',
  ];
  const tx = db.transaction(() => {
    for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
  });
  tx();
  resetAllLimiters();
}

export function teardown() {
  closeDb();
}

export async function registerAndLogin(username, password = 'password123', overrides = {}) {
  const res = await request(app())
    .post('/api/register')
    .send({
      username,
      password,
      nickname: overrides.nickname ?? username,
      avatar: overrides.avatar ?? '🍵',
    })
    .expect(201);
  return { token: res.body.token, user: res.body.user };
}

export function auth(t) {
  return `Bearer ${t}`;
}
