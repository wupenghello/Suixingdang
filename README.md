# 随行档 (Suixingdang) `v2.0.0`

私人文件中枢 Agent — 零痕迹、浏览器访问、AI 驱动、多账户、自托管。

> 公司端零安装、零痕迹（默认只在线预览、不下载，离职一键吊销令牌即切断访问）；家里端常驻守护进程自动双向同步；中间用 Agent 让你用自然语言管理文件。

---

## 快速部署（服务器端）

> 前置条件：服务器已安装 Docker 与 Docker Compose；域名已解析到服务器 IP（Caddy 会自动签发 HTTPS 证书）。

### 方式一：一键脚本（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/wupenghello/Suixingdang/main/install.sh | bash
```

脚本自动下载 `docker-compose.yml`/`Caddyfile`、交互式收集域名与密码、生成三把独立密钥（`SECRET_KEY` / `JWT_SECRET` / `DATA_ENCRYPTION_KEY`）、写 `.env`（权限 600）、拉镜像启动，**无需 clone 源码**。也可 `git clone` 后 `./install.sh`（从源码构建镜像，不依赖镜像是否已发布）。

> 首次部署前请等 [GitHub Actions](.github/workflows/docker.yml) 把镜像构建发布到 GHCR（约 5-10 分钟），并在 [包设置页](https://github.com/users/wupenghello/packages/container/suixingdang/settings) 将镜像设为 public，否则服务器需 `docker login ghcr.io` 才能拉取。

### 方式二：手动逐步

#### 1. 准备环境

```bash
git clone https://github.com/wupenghello/Suixingdang.git suixingdang && cd suixingdang
cp .env.example .env
```

#### 2. 编辑 .env

```ini
ENV=production                     # 生产环境（启动时强制强密钥校验、禁用 API 文档）
DOMAIN=files.yourdomain.com        # 你的域名
ENABLE_API_DOCS=false              # 生产保持 false，不暴露 /docs /openapi.json
# 三把独立密钥（轮换互不影响，详见 docs/DEPLOY_SECURITY.md）
SECRET_KEY=用 openssl rand -hex 32 生成
JWT_SECRET=用 openssl rand -hex 32 生成
DATA_ENCRYPTION_KEY=用 openssl rand -hex 32 生成
# 受信任反向代理（Caddy 容器网段）；生产必须填，否则登录限流按 Caddy IP 计数、审计日志看不到真实客户端 IP
TRUSTED_PROXIES=172.18.0.0/16

ADMIN_USERNAME=admin
ADMIN_PASSWORD=你的强密码（至少 8 位，否则首次启动拒绝创建）

# 多账户配置
ALLOW_REGISTER=false              # 是否开放用户自助注册（false=仅管理员创建用户；可在管理后台运行时调整）
DEFAULT_QUOTA_MB=0                # 新用户默认存储配额（0=无限）

# 嵌入模型（语义搜索用）：default=ChromaDB 内置 all-MiniLM-L6-v2 / openai=OpenAI Embedding API
EMBEDDING_PROVIDER=default

# 大模型配置在管理后台「大模型配置」页面维护，无需写在 .env 中。
# 首次启动后，登录管理后台添加 DeepSeek/OpenAI 等大模型并分配给用户。
```

#### 3. 创建数据目录

```bash
# 与 .env.example 中 DATA_DIR 一致；Docker 会把该目录挂载到容器 /data
mkdir -p /data/suixingdang
```

> 安全建议：将 `/data` 置于 LUKS/dm-crypt 加密卷上，一次覆盖文件 + SQLite + ChromaDB，
> 防磁盘失窃与备份泄露。操作步骤见 [docs/DEPLOY_SECURITY.md](docs/DEPLOY_SECURITY.md)。

#### 4. 启动

```bash
docker compose up -d --build
```

完成。打开 `https://files.yourdomain.com` 即可使用。

Caddy 会自动签发 HTTPS 证书，并配置全套安全头（HSTS / CSP / X-Frame-Options / X-Content-Type-Options 等，详见 [`Caddyfile`](../Caddyfile)）。

> 日后更换服务器时，账户与文件数据的迁移步骤见 [docs/MIGRATION.md](docs/MIGRATION.md)。

---

## 日常更新

代码改动后的上线流程（改代码 → push → CI 构建镜像 → CI 自动 SSH 部署到服务器）、改配置、回滚、迁移新服务器，详见 [docs/UPDATE.md](docs/UPDATE.md)。

---

## 多账户系统

随行档支持多用户，每个用户拥有独立的文件空间。管理员通过独立的后台管理系统进行用户管理。

### 双入口

| 入口 | 地址 | 说明 |
|------|------|------|
| 用户端 | `https://files.yourdomain.com` | 文件管理、笔记、AI 对话、同步、传输助手 |
| 管理后台 | `https://files.yourdomain.com/admin` | 用户管理、系统统计、审计日志、大模型配置、系统设置 |

管理员和普通用户使用完全独立的认证体系（独立数据表、独立 token），管理员 token 无法访问用户接口，反之亦然。

### 管理员功能

- 创建/禁用/启用/删除用户、重置密码、设置存储配额、管理 AI 权限（开通/关闭、分配专属大模型）
- 管理用户访问令牌：为任意用户创建/吊销设备令牌、一键吊销全部令牌（应急下线设备）
- 系统统计：用户数、文件数、磁盘用量、各用户用量明细、最近活跃
- 系统设置：开放注册、默认配额、站点名称、回收站保留天数（1-90 天）、会话并发上限、会话空闲超时（均可运行时调整、无需重启）
- 大模型配置：CRUD、设为默认、测试连通性、删除默认自动迁移
- 全局文件浏览、全局分组总览、全局回收站统计与手动清理
- 审计日志：所有登录/上传/删除/管理操作的完整记录（含真实客户端 IP、GeoIP 地域）
- 管理员自主改密（需原密码）

删除用户时会自动清理该用户的全部文件、数据库记录和向量索引。

### 数据隔离

每个用户拥有独立空间，三重隔离：存储分目录（`{STORAGE_DIR}/{user_id}/`）、数据库按 `owner_id` 过滤、Chroma 独立向量集合（`files_{user_id}`）。详见 [docs/DESIGN.md](docs/DESIGN.md)。

---

## 家里电脑：守护进程

守护进程会监听指定文件夹，自动双向同步到服务器。

### 同步模式

| 模式 | 说明 |
|------|------|
| `one_way` | 仅本地 → 服务器（本地删除不同步到服务器） |
| `two_way` | 双向同步（本地 ↔ 服务器，含双向删除同步） |

### 冲突检测

守护进程上传时携带 `base_hash`（上次同步时的文件 SHA256）。若服务器端文件已被修改（`content_hash` 不一致），返回 409 冲突，本地版本另存为 `.conflict` 副本，避免静默覆盖。

### 排除模式

默认排除以 `.` 开头的文件/目录；可在 [`daemon/config.py`](../daemon/config.py) 的 `EXCLUDE_PATTERNS` 追加自定义模式。

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

---

## 公司电脑：零安装

打开浏览器，访问 `https://files.yourdomain.com`，登录即可浏览文件、写笔记、与 AI 对话、在线预览。

- **默认禁止下载**（文件不落公司电脑）：浏览器端默认禁下载
- **临时下载窗口**：到设置页验证密码后开启 5/15/30 分钟窗口，到期自动关闭
- **单次下载授权**：验证密码后仅允许下载指定文件一次，下载后立即失效
- **在线预览带 `no-store`**：关页即失，不进磁盘缓存；HTML/SVG/XML 等可执行类型禁止浏览器预览（防存储型 XSS）
- **新设备登录告警**：首次从某设备登录会写入审计日志（含 IP、GeoIP 地域、浏览器/OS 标签），便于被动发现异地/陌生设备盗号

离职时：在设置页吊销该浏览器会话（或一键吊销全部令牌），服务端即刻切断访问，已签发凭证立即失效、不留 60 分钟窗口。

---

## 本地开发（不用 Docker）

仓库自带 `.env.test`（仅含本地测试用占位值，无真实密钥），可在不装 Docker 的情况下跑起服务端。服务有**双入口**，用项目根目录的 `start.sh` 一键起两个进程：

```bash
cd server
pip install -r requirements.txt
pip install -r requirements-dev.txt
cd ..
./start.sh
```

- 用户端 → http://localhost:8899
- 管理端 → http://localhost:8900

默认数据写到 `/tmp/suixingdang-test/`（见 `.env.test`），不影响正式部署的数据目录。
启动后登录管理后台（`http://localhost:8900/admin`），在「大模型配置」页面添加你的 DeepSeek/OpenAI API Key。

---

## 架构概览

```
家里电脑（守护进程 v2）  ←→  服务器（FastAPI + worker + Caddy）  ←→  公司电脑（纯浏览器）
   SQLite 状态库/重试队列         存储中枢 / AI 平台                 零安装 · 只看不留
   单事件循环双向同步      浏览器会话令牌走 HttpOnly Cookie
```

```
┌─ 前端（web/，React 19 + TS + Vite + Tailwind v4）────────────┐
│  根路径 / 直接服务（正式版；旧 SPA 已下线，/next 301 过渡）     │
│  契约：OpenAPI → @hey-api/openapi-ts 生成类型                  │
├─ API 层（api/ 薄路由 + api/v1 类型化契约，统一错误体）─────────┤
├─ 服务层（services/ 入库管道收敛 + 回收站收敛）────────────────┤
├─ 仓库层（repositories/ 强制租户行级隔离）─────────────────────┤
├─ Agent 平台（agent_platform/：运行时事件协议 / 工具注册表 /    │
│  技能驱动 / 块级 RAG / 流式脱敏 / HITL 确认 / 运行追踪）───────┤
├─ 数据层（SQLite 默认，DATABASE_URL 切 PostgreSQL+pgvector；    │
│  Alembic 迁移，存量库自动 stamp 接管）────────────────────────┤
└─ 基建（jobs 任务表 + worker 进程 / structlog / Caddy TLS+CSP）┘
```

详见 [docs/DESIGN.md](docs/DESIGN.md) 与重构蓝图 [docs/plans/refactor-tobe.md](docs/plans/refactor-tobe.md)。

---

## v2.1 架构重构（S0–S5）

| 波次 | 内容 |
|---|---|
| S0 止血 | daemon 数据丢失修复（冲突检测失效/离线删除撤销/空 manifest 熔断）；agent 循环健壮性（坏 JSON 回喂/异常类名回喂/60s 超时）；密钥校验 fail-fast；备份覆盖用户文件 |
| S1 地基 | 服务层/仓库层；Alembic 迁移体系；`/api/v1` 类型化契约 + 统一错误体 `{code,message,detail}`；jobs 任务队列 + worker；PostgreSQL+pgvector 支持（SQLite 默认） |
| S2 Agent 平台 | `agent_platform/`：真 token 流式 + 事件协议；工具注册表（权限分级）；技能驱动 prompt/工具集；块级 RAG（分块嵌入，长文档深处可检索）；HITL 破坏性操作确认；`agent_traces` 追踪 |
| S3 前端终局 | `web/` 新 SPA（React 19 + TS + Tailwind v4），七视图全量；内容 hash 构建（手动 `?v=` 退场）；根路径 `/` 正式版（旧 SPA 已下线，`/next/*` 301 过渡）；Playwright 冒烟 |
| S4 Daemon v2 | SQLite 状态库（原子/并发安全）+ 失败退避重试队列 + 单事件循环；服务端 `/api/sync/*` 协议不变（v1 客户端兼容） |
| S5 展位 | 知识库 / MCP / 智能客服 / 数据中心：表结构 + 接口协议 + 501 占位路由冻结；技能体系真接入 |

**升级注意**：
- 迁移自动执行：启动时 Alembic 升级到 head；存量库（无 alembic_version）自动 stamp 后接管，无需手工操作
- compose 新增 `worker` 服务（与 server 同镜像）；`db`（PostgreSQL+pgvector）在 `pg` profile 下可选启用
- 前端构建：`./scripts/build_web.sh`（CI 自动执行并打进镜像），产物由 FastAPI 在根路径 `/` 提供

---

## 测试

| 层 | 命令 | 范围 |
|---|---|---|
| 后端 | `cd server && pytest -v` | FastAPI 接口 / 安全 / 多租户隔离 / 回收站 / 限流 / daemon v2 同步引擎 / Agent 平台（[`server/tests/`](../server/tests/)） |
| 旧前端工具 | `cd server && npm test` | 旧 SPA 工具函数单测，vitest + jsdom（[`server/tests/web/`](../server/tests/web/)） |
| 新前端 | `cd web && npx vitest run && npm run build` | API 客户端/SSE/格式化单测 + tsc 类型检查 + 生产构建（[`web/`](../web/)） |
| E2E | `cd web && npm run e2e` | Playwright 冒烟（注册→上传→回收站→登出，需本地起后端） |
| AI 评测 | 见 [PROMPTFOO_GUIDE.md](PROMPTFOO_GUIDE.md) | 笔记整理质量 + 工具选择 + 反幻觉回归（`promptfooconfig.yaml`，system prompt file:// 引用版本化提示词） |

**前端单测 vs AI 评测，各司其职**：vitest 测前端代码逻辑（渲染 / 解析 / 转义 / 分类）；PROMPTFOO 测大模型输出内容质量。改前端工具函数跑 `npm test`，调 prompt / 换模型跑 PROMPTFOO，两者不混。

CI（[.github/workflows/test.yml](../.github/workflows/test.yml)）在 PR 与 push develop/main 时自动跑后端 pytest + 旧前端 vitest + 新前端（vitest + tsc + build）+ pip-audit 依赖漏洞扫描 + 前端 cache-busting 检查。

---

## 功能清单

### 文件与内容

- [x] 文件上传（最大 500MB）/ 在线预览（no-store）/ 浏览 / 重命名 / 删除
- [x] 笔记功能：直接在 Web 写 `.md` / `.txt` 笔记（无需上传），支持编辑、重命名
- [x] 文件分组：用户自定义分组（创建/重命名/删除）、按分组浏览、移动文件入/出分组
- [x] 标签系统：人工标签 + AI 建议标签、标签云聚合、按标签筛选
- [x] 置顶/收藏文件
- [x] 文件内容语义搜索（Chroma 向量库，支持 PDF/Word/Excel/PPT 内容提取）；语义搜索失败时自动回退关键词搜索（匹配文件名 + 笔记正文）
- [x] 笔记双向链接：`[[wiki link]]` 语法、反向链接、链接解析
- [x] AI 增强：对单个笔记调用 LLM 生成摘要与建议标签，结果落库
- [x] 批量导出为 ZIP（按分组或全部）
- [x] 存储统计 + 磁盘监控
- [x] content_hash 自动去重（相同内容不重复存储）
- [x] 索引重建（一键全量重建语义索引）

### 回收站

- [x] 软删除 + 可配置保留期（1-90 天，管理后台运行时调整）
- [x] 恢复（原路径被占用时自动重命名）/ 彻底删除
- [x] 锁存：手动保护文件跳出自动清理（单用户上限 200）
- [x] 批量恢复 / 批量删除（已锁存自动跳过）
- [x] 清空回收站（需输入确认词「永久删除」防误操作）
- [x] 回收站内只读预览（图片/视频/音频/PDF/文本）
- [x] 过期自动清理（启动时 + 机会性清理）
- [x] 管理后台全局回收站统计与手动清理

### AI 助手

- [x] AI 对话助手（DeepSeek / OpenAI，function-calling，SSE 流式回复）
- [x] 文件内容问答（RAG：检索相关文件后回答）
- [x] 文件内容摘要（LLM 驱动，失败时退回内容预览）
- [x] 传输助手：文字便签 + 文件自动入库，统一时间线（类微信文件传输助手）
- [x] 智能同步建议（基于文件使用习惯）
- [x] 离职清理助手（设备令牌审计 + 敏感文件清单）
- [x] 清理建议（长期未用文件）
- [x] 服务端敏感信息脱敏：AI 回复中的身份证 / 手机号 / 邮箱 / API Key / 银行卡 / 私钥等 PII 自动遮罩为 `[[M:<mask_id>:<display>]]`，前端按需点击揭帖（`POST /api/chat/unmask`）
- [x] 传输助手内容脱敏 + 真实文件路径剥离（前端仅用 file_id 引用文件）

### 同步

- [x] 家里守护进程（watchdog 实时 + 定时全量同步，支持双向同步、双向删除同步）
- [x] 同步冲突检测（base_hash + 409 + `.conflict` 副本）
- [x] 同步通道限设备令牌（浏览器 JWT 无法走 `/api/sync` 绕过下载限制）
- [x] 同步管理（对话中查看状态 / 推送文件 / 查看同步事件）
- [x] 排除模式（以 `.` 开头默认排除，可自定义）

### 安全与认证

- [x] JWT 认证（access/refresh 分离，refresh 有效期 1 天）
- [x] 浏览器会话令牌存 HttpOnly + Secure + SameSite=Lax Cookie（前端 JS 不可读，防 XSS 偷令牌）
- [x] 设备令牌（opaque，走 Authorization 头，用于守护进程）
- [x] 会话管理：并发上限（默认 5）、空闲超时、同设备会话复用去分、新设备登录告警
- [x] 令牌吊销：单条吊销 / 退出其他设备 / 一键吊销全部（紧急下线不留 60 分钟窗口）
- [x] 密码版本号：改/重置密码时 bump，旧 access/refresh 立即失效
- [x] 密保问答（bcrypt 哈希，兼容旧 sha256，重置时自动升级）
- [x] 临时下载授权（5/15/30 分钟窗口）+ 单次下载授权（下载一次即失效）
- [x] 下载历史审计（本次窗口内下载了哪些文件）
- [x] 登录限流：按 `(scope:用户名, IP)` 滑窗失败计数，5 次/15 分钟触发 15 分钟锁定；`login` / `adminlogin` / `reset` / `chatrl` 四套独立 scope
- [x] 信任代理感知（TRUSTED_PROXIES）：仅当直连对端在信任集合内才采用 X-Forwarded-For，防伪造 XFF 绕过限流
- [x] 密码策略：最少 8 位 + 弱密码黑名单 + 不得与用户名相同
- [x] Guard 敏感文件检测：凭据类硬拦（blocked）、隐私类告警（warning），方向感知（往公司带 vs 往家带判断标准不同），文件名 + 内容（含 PDF/Word/Excel/PPT 提取文本）双重扫描
- [x] 全量审计日志（登录/文件操作/管理操作/限流锁定/密保重置失败/下载授权，含真实客户端 IP 与可选 GeoIP 地域）
- [x] LLM API Key Fernet 加密入库（HKDF 派生），运行时按需解密，启动时透明重加密历史密文
- [x] 反枚举：忘记密码 / 密保重置对所有用户名返回统一提示，对不存在用户补一次等量 bcrypt 消除时序差
- [x] 敏感路径扫描防护（`/.env`、`/.git/` 等直接 404，不返回 SPA index.html）
- [x] 错误信息不泄露（内部异常不返回堆栈给客户端）
- [x] HTML/SVG/XML 禁止浏览器预览（防存储型 XSS）
- [x] 路径穿越防护（storage 层 `_safe_path` 校验，越界视作「文件不存在」）
- [x] 容器以非 root 运行（Dockerfile 内 `useradd appuser` + `gosu` 降权）
- [x] Caddy 安全头：HSTS / CSP / X-Content-Type-Options / X-Frame-Options / Referrer-Policy
- [x] 8000 端口仅绑定 `127.0.0.1`（公网无法直连，公网入口只走 Caddy 80/443）
- [x] HTTPS 自动证书（Caddy + Let's Encrypt）

### 管理后台

- [x] 用户 CRUD、配额 / 状态管理、AI 权限（开通/关闭、分配专属大模型）
- [x] 设备令牌管理（创建/吊销/一键吊销全部）
- [x] 系统统计（用户数、文件数、磁盘用量、各用户用量明细、最近活跃）
- [x] 系统设置（开放注册、默认配额、站点名称、回收站保留天数、会话并发上限、会话空闲超时，运行时调整立即生效）
- [x] 大模型配置（CRUD、设为默认、测试连通性、删除默认自动迁移）
- [x] 全局文件浏览、全局分组总览、全局回收站统计与手动清理
- [x] 审计日志（分页、按 action 过滤、关联用户名）
- [x] 管理员自主改密（需原密码）
- [x] 系统信息（Python 版本、平台、大模型配置摘要）

---

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | FastAPI, Python 3.9+, SQLAlchemy, SQLite (WAL 模式), Chroma |
| 前端 | 原生 ES Module SPA（无构建步骤）+ marked + DOMPurify + highlight.js + KaTeX + Mermaid |
| AI | DeepSeek / OpenAI API（均走 OpenAI 兼容协议，function-calling） |
| 守护进程 | Python watchdog, httpx, asyncio |
| 部署 | Docker Compose, Caddy (自动 HTTPS + 安全头) |
| 安全 | bcrypt, PyJWT, Fernet (HKDF 派生), 服务端 PII 脱敏引擎 |
| 测试 | pytest + vitest + promptfoo + pip-audit |

---

## 项目结构

```
suixingdang/
├── docker-compose.yml          # 容器编排（server + caddy，8000 仅绑定 127.0.0.1）
├── Caddyfile                   # Caddy 反代 + 自动 HTTPS + 安全头 + 500MB 上传限制
├── .env.example                # 环境变量模板
├── install.sh                  # 一键部署脚本（交互式收集域名/密码、生成三把密钥）
├── start.sh                    # 本地开发双端口启动（8899 用户端 / 8900 管理端）
│
├── server/                     # 服务器端
│   ├── Dockerfile              # 非 root 运行（appuser + gosu）
│   ├── requirements.txt
│   ├── app/
│   │   ├── main.py             # FastAPI 入口（生产唯一实例，/admin 管理后台也在此）
│   │   ├── admin_server.py     # 管理后台独立入口（仅本地 start.sh 双端口开发用）
│   │   ├── config.py           # 配置（pydantic Settings，读 env）
│   │   ├── api/                # API 路由（6 组）
│   │   │   ├── auth.py         #   /api/auth     认证 + 注册 + 会话管理
│   │   │   ├── files.py        #   /api/files    文件 CRUD + 笔记 + 分组 + 标签 + 搜索 + 回收站
│   │   │   ├── chat.py         #   /api/chat     AI 对话（SSE）+ 摘要 + QA + 脱敏揭帖
│   │   │   ├── sync.py         #   /api/sync     同步状态 / 推送 / 事件 / 冲突检测
│   │   │   ├── admin.py        #   /api/admin    管理后台（用户/统计/审计/设置/LLM）
│   │   │   └── transfer.py     #   /api/transfer 文件传输助手（文字+文件统一时间线）
│   │   ├── core/               # 核心逻辑
│   │   │   ├── storage.py      #   文件存储抽象（user_id 前缀隔离 + 路径穿越防护）
│   │   │   ├── indexer.py      #   Chroma 索引 + 语义搜索 + 关键词回退
│   │   │   ├── llm_service.py  #   LLM 配置解析（按用户分配，Fernet 解密）
│   │   │   ├── guard.py        #   Guard 敏感文件检测（方向感知）
│   │   │   ├── security.py     #   密码哈希 / JWT / Fernet 加密
│   │   │   ├── mask.py         #   服务端 PII 脱敏引擎
│   │   │   └── sensitive_paths.py # 敏感路径扫描防护
│   │   ├── agent/              # Agent 智能层
│   │   │   ├── tools.py        #   function-calling 工具定义（16 个）
│   │   │   └── brain.py        #   LLM 调用 + 工具编排 + 流式输出
│   │   ├── db/
│   │   │   └── models.py       #   数据模型（13 张表）+ 限流 + 迁移
│   │   └── web/                # 前端静态资源（无构建）
│   │       ├── index.html      #   用户端
│   │       ├── admin/index.html#   管理后台
│   │       └── assets/         #   app/admin 的 css/js + lib
│   └── tests/                  # 测试（pytest + vitest）
│
├── daemon/                     # 家里守护进程
│   ├── watcher.py              #   watchdog 监听 + 定时全量同步
│   ├── sync.py                 #   同步引擎：差异比对 / 上传 / 下载 / 删除 / 冲突检测
│   └── config.py               #   守护进程配置（含排除模式）
│
├── scripts/
│   └── backup.sh               # SQLite 在线备份（WAL 模式 .backup，保留 30 份）
│
├── .github/workflows/
│   ├── test.yml                # PR 测试（pytest + vitest + pip-audit + cache-busting）
│   └── docker.yml              # push 到 main 时构建镜像 + 自动 SSH 部署
│
├── docs/                       # 文档
│   ├── DESIGN.md               # 产品设计 / 架构 / 数据模型 / API / 安全
│   ├── DEPLOY_SECURITY.md      # 部署安全（加密卷 / 密钥 / 应用层安全机制）
│   ├── UPDATE.md               # 日常更新 / 回滚 / 部署流程
│   └── MIGRATION.md            # 换服务器迁移指南
│
└── PROMPTFOO_GUIDE.md          # AI 评测与红队测试手册
```

---

## 文档索引

| 文档 | 内容 |
|------|------|
| [docs/DESIGN.md](docs/DESIGN.md) | 产品设计、架构拓扑、三端不对称设计、多账户与双入口、Agent 工具集、技术选型、数据模型、API 设计、安全设计 |
| [docs/DEPLOY_SECURITY.md](docs/DEPLOY_SECURITY.md) | 威胁模型、LUKS/dm-crypt 加密卷、三把密钥管理、应用层安全机制清单、运维检查清单、SQLite 定时备份 |
| [docs/UPDATE.md](docs/UPDATE.md) | 改代码 / 改配置 / 回滚 / 部署到新服务器的标准操作 |
| [docs/MIGRATION.md](docs/MIGRATION.md) | 换服务器时迁移账户、文件、向量索引的完整步骤 |
| [PROMPTFOO_GUIDE.md](PROMPTFOO_GUIDE.md) | LLM 评测 / 红队测试完整手册（安装、配置、断言、CI/CD） |

---

## 安全 DNA

随行档把「零痕迹」当作产品 DNA，而非附加功能。核心原则：

1. **公司端只看不留**：默认禁止下载、在线预览 no-store、HTML/SVG 禁止预览
2. **离职即清除**：一键吊销全部令牌 + bump 密码版本号，已签发凭证立即失效、不留 60 分钟窗口
3. **三重隔离**：存储分目录 / DB owner_id 过滤 / Chroma 独立 collection
4. **PII 服务端脱敏**：AI 回复中的身份证 / 手机号 / 邮箱 / API Key / 银行卡等自动遮罩，真实值不落前端
5. **纵深防御**：bcrypt + JWT + 登录限流 + Guard + 审计日志 + Fernet 加密 + 加密卷 + Caddy 安全头

完整安全设计详见 [docs/DESIGN.md §9](docs/DESIGN.md) 与 [docs/DEPLOY_SECURITY.md](docs/DEPLOY_SECURITY.md)。

---

## 备份

所有持久化数据落在主机 `${DATA_DIR}` 一棵目录下（文件 + SQLite + Chroma），加密卷块级备份即可保持加密态；文件级备份务必对产物再次加密（gpg / restic）。

仓库自带 [`scripts/backup.sh`](../scripts/backup.sh)，用 `sqlite3 .backup` 在 WAL 模式下生成一致性快照（不阻塞读写），默认保留最近 30 份。在服务器主机上加 crontab：

```bash
# 每天 03:17 备份
17 3 * * *  DATA_DIR=/data/suixingdang /path/to/suixingdang/scripts/backup.sh >> /var/log/sxd-backup.log 2>&1
```

> 备份产物是明文数据库副本（API Key 为密文、密码为哈希，但仍属敏感），务必落到加密卷或用 `gpg -c` / `restic` 二次加密，切勿明文上传到对象存储。

详见 [docs/DEPLOY_SECURITY.md](docs/DEPLOY_SECURITY.md)「备份」一节。

---

## 许可证与贡献

本项目为开源项目，欢迎提交 Issue 与 PR。部署安全问题请私下联系维护者，勿开公开 Issue。
