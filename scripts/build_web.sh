#!/usr/bin/env bash
# 构建新前端并同步到服务端可服务目录（FastAPI /next/* 挂载点）。
# 用法：./scripts/build_web.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/web"

if [ ! -d "$WEB/node_modules" ]; then
  echo "[build_web] 安装前端依赖…"
  (cd "$WEB" && npm ci --no-audit --no-fund)
fi

echo "[build_web] 运行前端单测…"
(cd "$WEB" && npx vitest run)

echo "[build_web] 构建生产产物…"
(cd "$WEB" && npm run build)

echo "[build_web] 完成：$WEB/dist（FastAPI 以 /next/* 提供，base=/next/）"
ls -la "$WEB/dist"
