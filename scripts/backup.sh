#!/usr/bin/env bash
# 随行档全量备份：SQLite 在线快照 + 用户文件 + Chroma 向量库。
#
# 历史上只备份 db.sqlite，用户文件（/data/files）与向量库不在范围内——
# 磁盘故障即永久丢失全部用户文件。本版本三者同备。
#
# 用法（在服务器主机上）：
#   DATA_DIR=/data/suixingdang BACKUP_DIR=/mnt/backup-disk/sxd ./scripts/backup.sh
#
# 推荐 crontab（每天凌晨 3:17 备份）：
#   17 3 * * *  DATA_DIR=/data/suixingdang BACKUP_DIR=/mnt/backup-disk/sxd /path/to/suixingdang/scripts/backup.sh >> /var/log/sxd-backup.log 2>&1
#
# 注意：
#   1. BACKUP_DIR 强烈建议指向异盘/异地（脚本会在同盘时告警）。
#   2. 备份产物含用户文件与数据库（含加密的 API Key 密文、用户哈希等），
#      务必落到加密卷或用 gpg/restic 二次加密，参见 docs/DEPLOY_SECURITY.md。
set -euo pipefail

DATA_DIR="${DATA_DIR:-/data/suixingdang}"
DB="${DB:-$DATA_DIR/db.sqlite}"
FILES_DIR="${FILES_DIR:-$DATA_DIR/files}"
CHROMA_DIR="${CHROMA_DIR:-$DATA_DIR/chroma}"
BACKUP_DIR="${BACKUP_DIR:-$DATA_DIR/backups}"
KEEP="${KEEP:-30}"

mkdir -p "$BACKUP_DIR"

# 同盘告警：备份与主数据同盘时，磁盘故障 = 备份一起丢
case "$BACKUP_DIR" in
  "$DATA_DIR"/*)
    echo "[backup] ⚠️ BACKUP_DIR ($BACKUP_DIR) 位于 DATA_DIR ($DATA_DIR) 内，与主数据同盘。" >&2
    echo "[backup] ⚠️ 强烈建议指向独立磁盘/远程存储（BACKUP_DIR=/mnt/other-disk/sxd）。" >&2
    ;;
esac

TS=$(date +%Y%m%d-%H%M%S)
fail=0

# ---- 1. 数据库在线快照 ----
if [ -f "$DB" ]; then
  OUT="$BACKUP_DIR/db-$TS.sqlite"
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB" ".backup '$OUT'"
  else
    # 无人值守环境复制：先触发 WAL checkpoint 尽量把改动落盘，再 cp。
    python3 -c "import sqlite3; sqlite3.connect('$DB').execute('PRAGMA wal_checkpoint(TRUNCATE)').close()" 2>/dev/null || true
    cp "$DB" "$OUT"
    [ -f "$DB-wal" ] && cp "$DB-wal" "$OUT-wal" || true
  fi
  echo "[backup] 数据库: $OUT ($(du -h "$OUT" | cut -f1))"
else
  echo "[backup] ⚠️ 数据库不存在: $DB（跳过）" >&2
  fail=1
fi

# ---- 2. 用户文件（核心数据，历史版本漏备） ----
if [ -d "$FILES_DIR" ]; then
  FOUT="$BACKUP_DIR/files-$TS.tar.gz"
  tar -czf "$FOUT" -C "$(dirname "$FILES_DIR")" "$(basename "$FILES_DIR")"
  echo "[backup] 用户文件: $FOUT ($(du -h "$FOUT" | cut -f1))"
else
  echo "[backup] ⚠️ 用户文件目录不存在: $FILES_DIR（跳过）" >&2
fi

# ---- 3. Chroma 向量库（可由文件重建，但省一次全量重索引） ----
if [ -d "$CHROMA_DIR" ]; then
  COUT="$BACKUP_DIR/chroma-$TS.tar.gz"
  tar -czf "$COUT" -C "$(dirname "$CHROMA_DIR")" "$(basename "$CHROMA_DIR")"
  echo "[backup] 向量库: $COUT ($(du -h "$COUT" | cut -f1))"
fi

# ---- 保留最近 KEEP 份，老的清理（三类产物各自轮转） ----
for pattern in "db-*.sqlite" "files-*.tar.gz" "chroma-*.tar.gz"; do
  ls -1t "$BACKUP_DIR"/$pattern 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
    rm -f "$old" "${old}-wal"
    echo "[backup] 清理旧备份: $old"
  done
done

exit $fail
