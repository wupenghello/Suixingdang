#!/usr/bin/env bash
# 随行档一键部署脚本
#   ./install.sh                                  交互式(问域名 + 管理员密码)
#   DOMAIN=files.example.com ./install.sh         非交互(仅问密码)
#   DOMAIN=x ADMIN_PASSWORD=y ./install.sh        完全非交互
#
# 行为:
#   - 无 .env:交互收集域名/密码,自动生成三项密钥,写 .env(权限 600),启动容器
#   - 有 .env:复用现有配置直接启动(重新配置请直接编辑 .env,勿重复生成以免重置密钥)
set -euo pipefail

B='\033[1m'; G='\033[32m'; Y='\033[33m'; R='\033[31m'; N='\033[0m'
say()  { printf "${B}随行档${N} %s\n" "$*"; }
ok()   { printf "${G}✓${N} %s\n" "$*"; }
warn() { printf "${Y}⚠${N} %s\n" "$*"; }
die()  { printf "${R}✗${N} %s\n" "$*" >&2; exit 1; }

# ---------- 依赖检查 ----------
command -v openssl >/dev/null || die "缺少 openssl,请先安装"
command -v curl    >/dev/null || die "缺少 curl,请先安装"
command -v docker  >/dev/null || die "缺少 docker,请先安装 Docker"
if docker compose version >/dev/null 2>&1; then DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then DC="docker-compose"
else die "缺少 docker compose,请先安装 Docker Compose"; fi

cd "$(dirname "$0")"

# 不 clone 也能部署:当前目录缺 compose/Caddyfile 时,从仓库 raw 下载
RAW="https://raw.githubusercontent.com/wupenghello/Suixingdang/main"
[ -f docker-compose.yml ] || curl -fsSL -o docker-compose.yml "$RAW/docker-compose.yml" \
  || die "下载 docker-compose.yml 失败;请检查网络,或改用 git clone 后 ./install.sh"
[ -f Caddyfile ] || curl -fsSL -o Caddyfile "$RAW/Caddyfile" \
  || die "下载 Caddyfile 失败"

# ---------- 生成 .env ----------
gen_env() {
  say "首次部署,需要两个信息(Ctrl+C 取消)"

  local domain="${DOMAIN:-}"
  if [ -z "$domain" ]; then
    while true; do
      read -rp "请输入你的域名(如 files.example.com): " domain </dev/tty
      if [[ "$domain" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ ]]; then break; fi
      warn "域名格式不正确,请重新输入"
    done
  fi

  local admin_pw="${ADMIN_PASSWORD:-}"
  local pw_auto=0
  if [ -z "$admin_pw" ]; then
    read -s -rp "请输入管理员密码(≥8 位,直接回车则随机生成): " admin_pw </dev/tty; echo
    if [ -z "$admin_pw" ]; then
      admin_pw="$(openssl rand -hex 16)"; pw_auto=1
    elif [ "${#admin_pw}" -lt 8 ]; then
      die "密码至少 8 位,请重新运行"
    fi
  fi

  local sk jwt dek
  sk="$(openssl rand -hex 32)"
  jwt="$(openssl rand -hex 32)"
  dek="$(openssl rand -hex 32)"

  cat > .env <<EOF
# 随行档生产配置 - 由 install.sh 生成于 $(date '+%Y-%m-%d %H:%M:%S')
# 本文件已 gitignore,不会入库。修改配置请直接编辑本文件后重跑 ./install.sh。
# 注意:SECRET_KEY/JWT_SECRET/DATA_ENCRYPTION_KEY 切勿随意更换
#   - 换 JWT_SECRET 会使所有已签发 token 立即失效
#   - 换 DATA_ENCRYPTION_KEY 会使已加密的 LLM API Key 无法解密(需重新配置)

ENV=production
DOMAIN=$domain
ENABLE_API_DOCS=false

SECRET_KEY=$sk
JWT_SECRET=$jwt
DATA_ENCRYPTION_KEY=$dek

# 受信任反向代理 CIDR(Caddy 容器网段);若审计日志 IP 全相同,用 docker network inspect 核对后调整
TRUSTED_PROXIES=172.18.0.0/16

ADMIN_USERNAME=admin
ADMIN_PASSWORD=$admin_pw
ALLOW_WEAK_ADMIN_PASSWORD=false

# 多账户:是否开放自助注册(false=仅管理员创建用户,更安全;后台可随时改)
ALLOW_REGISTER=false
DEFAULT_QUOTA_MB=0

# 存储(docker-compose 把主机 \$DATA_DIR 挂载到容器 /data)
DATA_DIR=/data/suixingdang
STORAGE_DIR=/data/files
DATABASE_PATH=/data/db.sqlite

EMBEDDING_PROVIDER=default
EOF
  chmod 600 .env
  ok "配置已写入 .env(权限 600)"
  printf "  域名:        %s\n" "$domain"
  if [ "$pw_auto" = 1 ]; then
    printf "  管理员密码:  %s  ← 随机生成,请立即记录\n" "$admin_pw"
  else
    printf "  管理员密码:  (你输入的)\n"
  fi
  printf "  三项密钥:    已随机生成\n"
}

if [ -f .env ]; then
  say "检测到已有 .env,复用配置直接启动(重新配置请编辑 .env,勿删后重跑以免重置密钥)"
else
  gen_env
fi

# ---------- 启动 ----------
if [ -d server ]; then
  # 有源码(clone 部署):从本地构建,不依赖镜像是否已发布
  say "从源码构建并启动..."
  $DC up -d --build
else
  # 无源码(curl|bash 部署):拉已发布镜像
  say "拉取镜像并启动(首次需 GitHub Actions 已发布镜像,约 5-10 分钟)..."
  $DC pull 2>/dev/null || warn "镜像拉取失败--若刚推送,请等 Actions 构建完成后重试"
  $DC up -d || die "启动失败;若镜像尚未发布,可 git clone 后 ./install.sh 从源码构建"
fi

# ---------- 健康检查 ----------
say "等待服务就绪..."
ready=0
if command -v curl >/dev/null 2>&1; then
  for i in $(seq 1 30); do
    if curl -sf http://localhost:8000/api/health >/dev/null 2>&1; then ready=1; break; fi
    sleep 2
  done
fi
[ "$ready" = 1 ] && ok "服务已就绪" || warn "未在 60s 内确认就绪,请用 '$DC logs' 排查"

# ---------- 收尾 ----------
domain_val="$(grep -E '^DOMAIN=' .env | head -1 | cut -d= -f2-)"
echo
say "部署完成!"
printf "  用户端:    ${B}https://%s${N}\n" "$domain_val"
printf "  管理后台:  ${B}https://%s/admin${N}\n" "$domain_val"
printf "  管理员:    admin(密码见 .env)\n"
echo
warn "Caddy 首次签发 HTTPS 证书约需 1-2 分钟,期间访问可能提示证书错误,稍候即可"
warn "登录管理后台后:① 修改管理员密码 ② 在「大模型配置」页添加 AI API Key 并分配给用户"
warn "开放注册:编辑 .env 设 ALLOW_REGISTER=true 后重跑 ./install.sh"
