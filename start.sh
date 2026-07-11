#!/usr/bin/env bash
# 随行档本地开发启动脚本
#   用户端 → http://localhost:8899
#   管理端 → http://localhost:8900
set -e
cd "$(dirname "$0")/server"

# 本地开发：若 server/.env 不存在，用仓库根目录的 .env.test 提供占位配置，
# 否则 uvicorn 会读到 config.py 默认路径（/data/...）而非 /tmp 测试目录。
if [ ! -f .env ] && [ -f ../.env.test ]; then
  cp ../.env.test .env
fi

# 清理可能残留的旧进程
kill $(lsof -ti:8899 2>/dev/null) 2>/dev/null || true
kill $(lsof -ti:8900 2>/dev/null) 2>/dev/null || true
sleep 0.5

echo "========================================"
echo "  随行档启动中..."
echo "  用户端: http://localhost:8899"
echo "  管理端: http://localhost:8900"
echo "========================================"

# 后台启动管理端
uvicorn app.admin_server:app --reload --port 8900 &
ADMIN_PID=$!

# 前台启动用户端（Ctrl+C 退出时同时杀掉管理端）
# 用 EXIT 而非 INT/TERM：这样即使用户端进程异常退出（非信号），也能回收后台管理端
trap 'kill $ADMIN_PID 2>/dev/null' EXIT
uvicorn app.main:app --reload --port 8899
