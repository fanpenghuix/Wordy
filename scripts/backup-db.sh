#!/bin/bash
set -e

cd "$(dirname "$0")/.."
BACKUP_DIR="data/backups"
mkdir -p "$BACKUP_DIR"

DATE=$(date +%Y-%m-%d)
BACKUP="$BACKUP_DIR/words-${DATE}.db"

if [ -f "$BACKUP" ]; then
  echo "Backup already exists: $BACKUP"
  exit 0
fi

if [ ! -f "data/words.db" ] || [ ! -s "data/words.db" ]; then
  echo "ERROR: Database file is empty or missing!"
  exit 1
fi

# Force WAL checkpoint before backup
sqlite3 data/words.db "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null || true

cp data/words.db "$BACKUP"
echo "Backup created: $BACKUP ($(du -h "$BACKUP" | cut -f1))"

# Keep only last 30 days of backups
find "$BACKUP_DIR" -name "words-*.db" -mtime +30 -delete 2>/dev/null || true
echo "Cleaned up backups older than 30 days"
