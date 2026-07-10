# 随行档 (Suixingdang)

私人文件中枢 Agent — 零痕迹、浏览器访问、AI 驱动。

## 快速部署（服务器端）

> 前置条件：服务器已安装 Docker 与 Docker Compose；域名已解析到服务器 IP（Caddy 会自动签发 HTTPS 证书）。

### 1. 准备环境

```bash
# 克隆或上传项目到服务器
git clone https://github.com/wupenghello/Suixingdang.git suixingdang && cd suixingdang

# 创建配置
cp .env.example .env
```

### 2. 编辑 .env

```ini
DOMAIN=files.yourdomain.com        # 你的域名
SECRET_KEY=用 openssl rand -hex 32 生成
ADMIN_USERNAME=admin
ADMIN_PASSWORD=你的强密码
DEEPSEEK_API_KEY=你的DeepSeek密钥

# 多账户配置
ALLOW_REGISTER=true               # 是否开放用户自助注册（false=仅管理员创建用户）
DEFAULT_QUOTA_MB=100              # 新用户默认存储配额（0=无限）
```

### 3. 创建数据目录

```bash
# 与 .env.example 中 DATA_DIR 一致；Docker 会把该目录挂载到容器 /data
mkdir -p /data/suixingdang
```

### 4. 启动

```bash
docker compose up -d --build
```

完成。打开 `https://files.yourdomain.com` 即可使用。

Caddy 会自动签发 HTTPS 证书。

## 多账户系统（v2.0）

随行档支持多用户，每个用户拥有独立的文件空间。管理员通过独立的后台管理系统进行用户管理。

### 双入口

| 入口 | 地址 | 说明 |
|------|------|------|
| 用户端 | `https://files.yourdomain.com` | 文件管理、AI 对话、同步 |
| 管理后台 | `https://files.yourdomain.com/admin` | 用户管理、系统统计、审计日志 |

管理员和普通用户使用完全独立的认证体系（独立数据表、独立 token），管理员 token 无法访问用户接口，反之亦然。

### 管理员功能

- 创建/禁用/启用/删除用户、重置密码、设置存储配额
- 管理用户访问令牌：为任意用户创建/吊销设备令牌、一键吊销全部令牌（应急下线设备）
- 系统统计：用户数、文件数、磁盘用量、各用户用量明细
- 审计日志：所有登录/上传/删除/管理操作的完整记录

删除用户时会自动清理该用户的全部文件、数据库记录和向量索引。

### 数据隔离

- 存储隔离：文件按 `{STORAGE_DIR}/{user_id}/` 目录隔离
- 数据库隔离：所有文件/聊天/令牌记录带 `owner_id` / `user_id` 过滤
- 索引隔离：每个用户独立的 Chroma 向量集合（`files_{user_id}`）

## 家里电脑：守护进程

守护进程会监听指定文件夹，自动同步到服务器。

### 方式一：直接运行

```bash
cd daemon
pip install -r requirements.txt

# 配置
export SERVER_URL=https://files.yourdomain.com
export DAEMON_TOKEN=在Web设置页创建的令牌
export WATCH_DIR=~/sync-folder

python watcher.py
```

### 方式二：Docker

```bash
cd daemon
docker build -t suixingdang-daemon .
docker run -d --name suixingdang-daemon \
  -e SERVER_URL=https://files.yourdomain.com \
  -e DAEMON_TOKEN=你的令牌 \
  -e WATCH_DIR=/sync \
  -v ~/sync-folder:/sync \
  suixingdang-daemon
```

## 公司电脑：零安装

打开浏览器，访问 `https://files.yourdomain.com`，登录即可上传下载文件。

离职时：在服务器设置页吊销"公司电脑"令牌 → 清一下浏览器记录 → 走人。

## 本地开发（不用 Docker）

仓库自带 `.env.test`（仅含本地测试用占位值，无真实密钥），可在不装 Docker 的情况下跑起服务端：

```bash
cd server
pip install -r requirements.txt
cp ../.env.test .env          # 复制为本地配置（该 .env 已被 gitignore，不会提交）
# 把 .env 里的 DEEPSEEK_API_KEY 换成你自己的密钥后再启动
uvicorn app.main:app --reload --port 8000
```

默认数据写到 `/tmp/suixingdang-test/`（见 `.env.test`），不影响正式部署的数据目录。

## 架构概览

```
家里电脑（守护进程）  ←→  服务器（FastAPI + Chroma + Caddy）  ←→  公司电脑（纯浏览器）
    自动同步                存储中枢 / AI 大脑                     零安装
```

详见 [docs/DESIGN.md](docs/DESIGN.md)。

## 功能清单

- [x] 文件上传/下载/浏览（Web 界面）
- [x] 多账户系统（独立用户空间 + 配额管理）
- [x] 独立管理后台（用户 CRUD / 系统统计 / 审计日志）
- [x] JWT 认证 + TOTP 双因子
- [x] 设备令牌管理（可吊销）
- [x] 家里守护进程（watchdog 实时 + 定时全量同步，支持双向删除同步）
- [x] Guard 敏感文件检测（凭据/隐私/机密，方向感知）
- [x] 文件语义搜索（Chroma 向量库，支持 Word/Excel/PPT 内容解析）
- [x] AI 对话助手（DeepSeek / OpenAI，function-calling，SSE 流式回复）
- [x] 文件内容问答（RAG：检索相关文件后回答）
- [x] 文件内容摘要（LLM 驱动）
- [x] 同步管理（对话中查看状态 / 推送文件）
- [x] 离职清理助手（设备令牌审计 + 敏感文件清单）
- [x] 智能同步建议（基于文件使用习惯）
- [x] 文件传输助手（文字便签 + 文件自动入库，类微信传输助手）
- [x] content_hash 自动去重（相同内容不重复存储）
- [x] 存储统计 + 磁盘监控
- [x] 清理建议（长期未用文件）
- [x] 全文索引重建
- [x] HTTPS 自动证书（Caddy + Let's Encrypt）

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | FastAPI, Python 3.9+, SQLite, Chroma |
| 前端 | 原生 ES Module SPA（无构建步骤） |
| AI | DeepSeek / OpenAI API（function-calling） |
| 守护进程 | Python watchdog, httpx |
| 部署 | Docker Compose, Caddy |
