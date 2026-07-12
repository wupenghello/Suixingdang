#!/bin/sh
set -e

# /data 为主机挂载卷，所有权由宿主机决定。容器以 root 启动，这里确保 /data 可被
# 非 root 的 appuser 写入，再用 gosu 降权执行主进程。
# 仅在归属非 appuser 时递归修正，避免每次健康检查都全量 chown。
if [ -d /data ] && [ "$(stat -c %u /data 2>/dev/null)" != "1000" ]; then
    chown -R appuser:appuser /data 2>/dev/null || true
fi

exec gosu appuser "$@"
