import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb } from './index.js';
import { logger } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

export function migrate() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all().map((r) => r.name),
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const insert = db.prepare('INSERT INTO _migrations (name) VALUES (?)');

  for (const file of files) {
    if (applied.has(file)) {
      logger.debug({ file }, 'migration 已应用，跳过');
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      insert.run(file);
    });
    tx();
    logger.info({ file }, 'migration 已应用');
  }
}

// 直接 node src/db/migrate.js 执行时
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    migrate();
    logger.info('所有 migration 已应用');
  } catch (err) {
    logger.error({ err }, 'migration 失败');
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}
