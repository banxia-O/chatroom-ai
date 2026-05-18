import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import { logger } from '../logger.js';

let _db = null;

export function getDb() {
  if (_db) return _db;

  const dbPath = path.resolve(config.db.path);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');

  _db = db;
  logger.info({ path: dbPath }, 'SQLite 已打开');
  return db;
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
