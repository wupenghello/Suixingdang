#!/usr/bin/env bash
# 随行档本地开发启动脚本（支持 macOS / Linux / Windows-GitBash）
#   用户端 -> http://localhost:8899
#   管理端 -> http://localhost:8900
set -e

cd "$(dirname "$0")/server"
ROOT_DIR="$(cd .. && pwd)"

# 本地开发：若 server/.env 不存在，用仓库根目录的 .env.test 提供占位配置，
# 否则 uvicorn 会读到 config.py 默认路径（/data/...）而非 /tmp 测试目录。
if [ ! -f .env ] && [ -f "$ROOT_DIR/.env.test" ]; then
  cp "$ROOT_DIR/.env.test" .env
fi

# 选择 Python 解释器：优先项目根目录的 venv（Windows 与 *nix 的解释器路径不同），
# 其次回退到 PATH 中的 python3 / python（用户已激活 venv 或全局安装的情况）。
if [ -x "$ROOT_DIR/.venv/Scripts/python.exe" ]; then
  PY="$ROOT_DIR/.venv/Scripts/python.exe"   # Windows venv
elif [ -x "$ROOT_DIR/.venv/bin/python" ]; then
  PY="$ROOT_DIR/.venv/bin/python"           # macOS / Linux venv
elif command -v python3 >/dev/null 2>&1; then
  PY="python3"
else
  PY="python"
fi

# 依赖自检：uvicorn 不可用时自动安装，避免「忘了 pip install」直接启动报错。
if ! "$PY" -c "import uvicorn" >/dev/null 2>&1; then
  echo "未检测到 uvicorn，正在安装依赖 requirements.txt ..."
  "$PY" -m pip install -r requirements.txt
fi

# 跨平台清理占用端口的旧进程：按「可用工具」分流，而非假设平台。
#   lsof     -> macOS / 大多数 Linux（kill 进程）
#   taskkill -> Windows（GitBash）；netstat -ano 把 PID 放在最后一列
#   fuser    -> 无 lsof 的 Linux（psmisc 提供）
# taskkill 的 //PID //F 用双斜杠是为了阻止 MSYS 把 /PID 当路径转换。
kill_port() {
  local port=$1 pids pid
  if command -v lsof >/dev/null 2>&1; then
    pids=$(lsof -ti:"$port" 2>/dev/null || true)
    [ -n "$pids" ] && kill $pids 2>/dev/null || true
  elif command -v taskkill >/dev/null 2>&1; then
    pids=$(netstat -ano 2>/dev/null | awk -v p=":$port" '$2 ~ p "$" && /LISTENING/ {print $NF}' | sort -u)
    for pid in $pids; do
      taskkill //PID "$pid" //F >/dev/null 2>&1 || true
    done
  elif command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" 2>/dev/null || true
  else
    echo "警告: 未找到 lsof/taskkill/fuser，无法清理端口 $port 上的进程" >&2
  fi
  return 0
}

kill_port 8899 || true
kill_port 8900 || true
sleep 0.5

echo "========================================"
echo "  随行档启动中...  (Python: $PY)"
echo "  用户端: http://localhost:8899"
echo "  管理端: http://localhost:8900"
echo "========================================"

# 后台启动管理端
"$PY" -m uvicorn app.admin_server:app --reload --port 8900 &
ADMIN_PID=$!

# 前台启动用户端（Ctrl+C 退出时同时杀掉管理端）
# 用 EXIT 而非 INT/TERM：这样即使用户端进程异常退出（非信号），也能回收后台管理端。
# kill_port 兜底：--reload 的子进程在 Windows 上可能未被 kill 带走，按端口再清一次。
# 注意 kill 也带 || true：set -e 下 EXIT trap 中某条命令失败会中断整个 trap，
# 会让后面的 kill_port 兜底全部被跳过。
trap 'kill $ADMIN_PID 2>/dev/null || true; kill_port 8899 || true; kill_port 8900 || true' EXIT
"$PY" -m uvicorn app.main:app --reload --port 8899
