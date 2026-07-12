#!/usr/bin/env bash
# SQLite 在线备份：利用 .backup 命令在 WAL 模式下安全复制一致性快照，
# 不阻塞读写。产物为时间戳副本，默认保留最近 30 份。
#
# 用法（在服务器主机上，容器名为 suixingdang-server）：
#   DATA_DIR=/data/suixingdang ./scripts/backup.sh
# 或通过 docker exec：
#   docker exec suixingdang-server /app/../scripts/backup.sh   # 若脚本未进容器，见下方说明
#
# 推荐 crontab（每天凌晨 3:17 备份）：
#   17 3 * * *  DATA_DIR=/data/suixingdang /path/to/suixingdang/scripts/backup.sh >> /var/log/sxd-backup.log 2>&1
#
# 注意：备份产物含明文数据库（含加密的 API Key 密文、用户哈希等），务必落到加密卷
# 或用 gpg/restic 二次加密，参见 docs/DEPLOY_SECURITY.md。
set -euo pipefail

DATA_DIR="${DATA_DIR:-/data/suixingdang}"
DB="${DB:-$DATA_DIR/db.sqlite}"
BACKUP_DIR="${BACKUP_DIR:-$DATA_DIR/backups}"
KEEP="${KEEP:-30}"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DB" ]; then
  echo "[backup] 数据库不存在: $DB" >&2
  exit 1
fi

TS=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/db-$TS.sqlite"

# 优先用 sqlite3 在线备份；容器内通常未装 sqlite3，则退回文件拷贝（先 checkpoint）。
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB" ".backup '$OUT'"
else
  # 无人值守环境复制：先触发 WAL checkpoint 尽量把改动落盘，再 cp。
  python3 -c "import sqlite3; sqlite3.connect('$DB').execute('PRAGMA wal_checkpoint(TRUNCATE)').close()" 2>/dev/null || true
  cp "$DB" "$OUT"
  [ -f "$DB-wal" ] && cp "$DB-wal" "$OUT-wal" || true
fi

echo "[backup] 已生成: $OUT ($(du -h "$OUT" | cut -f1))"

# 保留最近 KEEP 份，老的清理
ls -1t "$BACKUP_DIR"/db-*.sqlite 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f "$old" "${old}-wal"
  echo "[backup] 清理旧备份: $old"
done
