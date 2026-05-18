#!/usr/bin/env bash
#
# SQLite 在线热备份。用 `sqlite3 .backup` 命令而不是 cp —— 后者在 WAL 模式下
# 可能拿到不一致的快照。`.backup` 走 SQLite 自己的 backup API，对在线读写安全。
#
# 用法：
#   bash deploy/backup-sqlite.sh
#
# Cron（每天凌晨 3:15）：
#   15 3 * * * /srv/banxia/deploy/backup-sqlite.sh >> /srv/banxia/logs/backup.log 2>&1

set -euo pipefail

DB="${DB_PATH:-/srv/banxia/backend/data/chatroom.db}"
DEST="${BACKUP_DIR:-/srv/banxia/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

mkdir -p "$DEST"

if [ ! -f "$DB" ]; then
  echo "ERR: 数据库不存在: $DB" >&2
  exit 1
fi

TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$DEST/chatroom-${TS}.db"

# 在线热备份
sqlite3 "$DB" ".backup '$OUT'"

# 校验完整性
INTEGRITY=$(sqlite3 "$OUT" "PRAGMA integrity_check;")
if [ "$INTEGRITY" != "ok" ]; then
  echo "ERR: 备份完整性校验失败：$INTEGRITY" >&2
  rm -f "$OUT"
  exit 2
fi

# 压缩
gzip -f "$OUT"
SIZE=$(stat -c%s "$OUT.gz" 2>/dev/null || stat -f%z "$OUT.gz")
echo "[$(date -u +%FT%TZ)] backup ok: $OUT.gz (${SIZE} bytes)"

# 清理过期备份
find "$DEST" -name "chatroom-*.db.gz" -mtime "+${KEEP_DAYS}" -print -delete
