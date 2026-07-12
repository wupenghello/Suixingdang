#!/bin/sh
set -e

# 同步目录由宿主机挂载，确保非 root 的 appuser 可写后降权执行。
SYNC_DIR="${WATCH_DIR:-/sync}"
if [ -d "$SYNC_DIR" ] && [ "$(stat -c %u "$SYNC_DIR" 2>/dev/null)" != "1000" ]; then
    chown -R appuser:appuser "$SYNC_DIR" 2>/dev/null || true
fi

exec gosu appuser "$@"
