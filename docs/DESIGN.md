# 随行档 (Suixingdang) 设计文档

> 一个长在你自己服务器上、靠浏览器访问、用对话驱动的私人文件中枢。
> 核心价值：公司端零安装、零痕迹，家里端常驻同步，中间用 agent 让你用自然语言管理文件。
>
> 面向维护者。部署运维见 [README](../README.md) 与 [DEPLOY_SECURITY](DEPLOY_SECURITY.md)，换服务器见 [MIGRATION](MIGRATION.md)。

---

## 1. 问题与定位

### 1.1 核心痛点

跨场景文件使用困境：

- 在家学习/工作产生的文件，需要带到公司使用
- 公司的文件和资料，需要带回家使用
- 工作不稳定时，**不想在公司电脑安装任何网盘客户端**，离职清理麻烦

### 1.2 核心矛盾

传统网盘（百度网盘、坚果云、Syncthing 等）解决的是"同步"问题，却制造了最想避免的东西——**痕迹**：客户端安装、配置文件、同步缓存、后台进程，离职时都得清理。

### 1.3 产品定位

**随行档**：一个长在你自己服务器上、靠浏览器访问、用对话驱动的**多账户**私人文件中枢。

### 1.4 三条差异化

| 差异点 | 说明 |
|--------|------|
| 零痕迹 | 公司电脑默认不下载文件，只在线预览（no-store，关页即失）；离职/换机一键吊销令牌即切断访问，文件不落本地 |
| 即问即得 | 不用翻文件夹，用自然语言告诉 agent 意图，它找到文件、传好、通知你 |
| 懂你的文件 | agent 索引过文件名和内容，能分类、能提醒、能建议 |

---

## 2. 系统架构

### 2.1 整体拓扑

```
[家里电脑]                        [你的服务器]                     [公司电脑]
  可以装软件                        域名 + IP                        零安装
  常驻守护进程                      存储中枢                         纯浏览器
  本地 agent                       Web 服务                         登录访问
      │                            AI 大脑 (索引/RAG)                  │
      │         自动双向同步                │                        │
      └──────────────────────────▶ 存储中枢 ◀──────────────────────────┘
                                   Web 服务            HTTPS
                                   AI 大脑
                                   权限/审计
```

### 2.2 三端角色（不对称设计）

这种不对称直接对应约束条件，是整个产品的地基。

**家里电脑（你的地盘）**——可以装软件、完全拥有；轻量守护进程做文件夹监听 + 双向同步，后台自动运行。

**服务器（唯一真正的服务）**——存储中枢（所有文件的中央仓库）、Web 服务（浏览器访问界面）、AI 大脑（文件索引、语义搜索、内容问答）、权限与审计（访问控制、操作日志）。

**公司电脑（零安装）**——只开浏览器，登录域名找文件 / 对话 / 在线预览；默认禁止下载（需临时窗口），没有客户端、配置文件或同步缓存。

### 2.3 离职清理链路

```
设置页「吊销全部」或单条吊销浏览器会话
        │
        ▼
公司那台机器上不存在任何需要删的东西
        │
        ▼
只剩浏览器历史记录
        │
        ▼
清一下浏览器记录即可，干干净净走人
```

agent 还能当"离职助手"，提醒你别漏该清理的东西。

---

## 3. 多账户与双入口

随行档支持多用户，每个用户有独立文件空间；管理员通过独立后台管理系统进行用户管理。普通用户与管理员是**完全独立的两套认证体系**。

### 3.1 入口

生产环境只运行一个 FastAPI 实例 `app.main:app`，同时服务两类入口：

| 入口 | URL | 提供方 |
|------|------|------|
| 用户端 | `https://域名/` | main.py 的 SPA handler + auth/files/chat/sync/transfer 路由 |
| 管理后台 | `https://域名/admin` | 同一 main.py：SPA handler 返回 admin 前端 + include 的 admin 路由 |

管理员与普通用户仍是**独立的两套认证体系**（见 3.2），只是跑在同一个进程里。本地开发时 `start.sh` 另起一个 `app.admin_server:app` 进程在 8900 端口（仅 auth+admin）方便管理后台单独调试——这是开发期便利，生产并不部署它。

### 3.2 双 Token 体系

普通用户与管理员的 JWT 分离，靠 token 中的 `role` 字段区分：

```json
{"sub": "user-uuid",  "role": "user",  "type": "access"}   // 普通用户
{"sub": "admin-uuid", "role": "admin", "type": "access"}   // 管理员
```

后端有两个独立的依赖注入函数做强隔离：

- `get_current_user` —— 只接受 `role=user` 的 token，守用户接口
- `get_current_admin` —— 只接受 `role=admin` 的 token，守管理接口

管理员 token 无法访问用户接口，反之亦然。两类账户分别存在独立的表（`users` / `admins`）。

### 3.3 数据隔离（三重）

| 层 | 隔离方式 |
|------|------|
| 存储隔离 | 文件按 `{STORAGE_DIR}/{user_id}/` 分目录，storage 层所有操作带 `user_id` 前缀 |
| 数据库隔离 | 所有文件 / 聊天 / 令牌记录带 `owner_id` / `user_id`，查询一律过滤 |
| 索引隔离 | Chroma 按用户独立 collection（`files_{user_id}`），搜索只搜自己的 |

### 3.4 管理员能力

- 创建 / 禁用 / 启用 / 删除用户、重置密码、设置存储配额、管理 AI 权限（开通 / 关闭、分配专属大模型）
- 管理用户访问令牌：为任意用户创建 / 吊销设备令牌、一键吊销全部（应急下线设备）
- 系统统计：用户数、文件数、磁盘用量、各用户用量明细、最近 7 天活跃用户
- 系统设置（运行时调整、无需重启）：开放注册、默认配额、站点名称、回收站保留天数（1-90 天）、会话并发上限、会话空闲超时
- 大模型配置：CRUD、设为默认、测试连通性、删除默认自动迁移
- 全局文件浏览、全局分组总览、全局回收站统计与手动清理
- 审计日志：登录 / 文件操作 / 管理操作 / 限流锁定 / 密保重置失败 / 下载授权全量记录（含真实客户端 IP 与可选 GeoIP 地域）
- 管理员自主改密（需原密码）

管理员登录不签发 refresh（401 即重登）；改密走独立接口，不连累用户态会话。删除用户时自动清理其全部文件、数据库记录和向量索引。

---

## 4. Agent 智能层

### 4.1 Agent 定位

把 agent 当成一个有手有眼、能操作文件系统的助手。它不只是聊天，能借助 function-calling 实际执行操作。

### 4.2 Agent 工具集

Agent 通过 function-calling 调用以下工具（定义在 [tools.py](../server/app/agent/tools.py)，共 16 个）：

| 工具 | 功能 |
|--------|------|
| `list_transfer_messages` | 列出文件传输助手的文字便签与已入库文件（按时间倒序，与语义搜索互补） |
| `search_files` | 语义搜索文件和文字便签，返回匹配结果及内容片段 |
| `list_files` | 列出目录文件 |
| `get_file_info` | 获取文件详情 |
| `delete_file` | 删除文件（默认 purge=false 软删除入回收站；purge=true 直接物理清除） |
| `restore_file` | 从回收站恢复文件至原位置（Agent 调用，原路径被占时自动重命名） |
| `trash_cleanup_assistant` | 回收站清理助手：按「即将过期 / 最早进入 / 占用最大」分桶给建议（规则扫描，无 LLM 调用） |
| `check_guard` | 检查文件敏感度（支持方向感知） |
| `summarize_file` | 用 AI 生成文件内容摘要 |
| `qa` | 基于文件内容的问答（RAG 检索相关文件后回答） |
| `sync` | 管理同步：查看状态 / 列出服务器上的文件 / 创建推送请求 |
| `list_sync_events` | 查看同步记录 |
| `cleanup_suggestions` | 清理建议：找出长期未用的文件 |
| `cleanup_assistant` | 离职清理助手：检查设备令牌、敏感文件 |
| `smart_sync_suggestions` | 智能同步建议：基于修改时间和类型给出推送/归档建议 |
| `get_storage_stats` | 存储统计 |

> 文件传输助手（`/api/transfer`）、笔记/分组/标签等是独立 API，不属于 Agent 工具。

### 4.3 Guard 敏感文件检测

Guard 是文件的"安检岗"，核心职责：**在文件被搬运之前，先替你看一眼这个东西该不该动、往这个方向动合不合适。**

设计原则：

- **凭据类硬拦、隐私类告警**：含密钥 / 凭据的文件直接拦截；隐私文件提醒后由用户确认
- **方向感知**：同样的文件，往公司带和往家带，判断标准不同
- **内容级扫描**：文件名 + 内容（含 PDF / Word / Excel / PPT 提取文本）双重检测，不只看扩展名

典型场景：防止误带公司机密回家、防止把个人隐私（简历 / 银行流水 / 体检报告）带去公司、防止 `.env` 等凭据文件被同步出去。

---

## 5. 技术选型

### 5.1 选型总表

| 层 | 选型 | 理由 |
|----|------|------|
| 部署方式 | Docker Compose | 一键起，好迁移好备份 |
| 后端框架 | FastAPI (Python 3.9+) | AI 生态最顺，function-calling 原生支持 |
| 文件存储 | 本地磁盘 | 文档代码量级完全够，量大再上 MinIO |
| 数据库 | SQLite (WAL 模式) | 单服务器场景足够，零运维；WAL 降低高频写入开销 |
| 向量库 | Chroma（嵌入式） | 轻量、无需额外服务进程 |
| 前端 | 原生 ES Module SPA（无构建步骤） | 文件浏览 + 对话窗就够，零工具链 |
| 反向代理 / HTTPS | Caddy | 自动 Let's Encrypt，配置近乎为零 |
| 家里守护进程 | Python watchdog | 文件夹监听 + 自动双向同步 |
| LLM | DeepSeek / OpenAI（均走 OpenAI 兼容协议） | 管理后台动态配置，Fernet 加密入库 |

### 5.2 选型决策依据

**为什么 FastAPI？** Agent 的核心是 LLM 调用与 function-calling，Python 生态（OpenAI SDK、文件处理库）最成熟、迭代最快。单服务器场景下性能不是瓶颈。

**为什么 SQLite 而非 Postgres？** 单服务器场景，SQLite 的零运维优势远大于并发能力；开启 WAL 模式后对聊天限流等高频写入路径友好。数据量上来或需要多服务并发写入时，可经 ORM 层无缝迁移到 Postgres。

**为什么 Chroma 而非 Qdrant/Milvus？** 嵌入式向量库，不需要额外起服务进程，Docker Compose 少一个容器。文件量（数千到数万）完全在其舒适区。

**为什么 Caddy 而非 Nginx？** 自动 HTTPS 是杀手级特性——配置文件里写上域名，自动签发和续期证书，零手动操作。

**为什么原生 ES Module 而非 React/Vue？** 前端就是文件列表 + 对话窗 + 管理后台，引入构建链得不偿失。原生 ES Module + 几个零依赖库（marked、DOMPurify）即可，部署只需静态文件，无构建步骤。

**为什么 LLM 放管理后台而非写死配置？** 不同用户可分配不同模型（DeepSeek 省钱 / OpenAI 强能力），且 API Key 用 Fernet 加密入库、运行时按需解密，比明文环境变量安全。

---

## 6. 项目结构

```
suixingdang/
├── docker-compose.yml          # 容器编排（server + caddy，8000 仅绑定 127.0.0.1）
├── Caddyfile                   # Caddy 反代 + 自动 HTTPS + 安全头 + 500MB 上传限制
├── .env.example                # 环境变量模板
├── install.sh                  # 一键部署脚本（交互式收集域名/密码、生成三把密钥）
├── start.sh                    # 本地开发双端口启动（8899 用户端 / 8900 管理端）
│
├── server/                     # 服务器端
│   ├── Dockerfile              # 非 root 运行（appuser + gosu 降权）
│   ├── requirements.txt
│   ├── requirements-dev.txt
│   ├── .env.test               # 本地测试用占位配置
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
│   │       └── assets/         #   app/admin 的 css/js + lib（marked / dompurify / highlight.js / katex / mermaid）
│   └── tests/                  # 测试（pytest + vitest）
│       ├── web/                # 前端工具函数单测
│       └── *.py                # 后端接口 / 安全 / 回收站 / 限流测试
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
│   ├── DESIGN.md               # 本文件
│   ├── DEPLOY_SECURITY.md      # 部署安全（加密卷 / 密钥 / 安全机制）
│   ├── UPDATE.md               # 日常更新 / 回滚 / 部署流程
│   └── MIGRATION.md            # 换服务器迁移指南
│
└── PROMPTFOO_GUIDE.md          # AI 评测与红队测试手册
```

---

## 7. 数据模型

SQLite，共 13 张表（[db/models.py](../server/app/db/models.py)）。按职责分组：

### 7.1 认证与账户

| 表 | 用途 | 关键字段 |
|------|------|------|
| `users` | 普通用户 | `username` / `password_hash` / `role` / `status` / `quota_mb` / `ai_enabled` / `llm_provider_id` / 密保问答 / `password_version` / `last_login_at` |
| `admins` | 管理员（独立表，与用户彻底分离） | `username` / `password_hash` |
| `access_tokens` | 设备/会话令牌（可吊销） | `user_id` / `kind`(device|session) / `label` / `device_fingerprint` / `ip` / `geo` / `token_hash` / `expires_at` / `revoked` / `last_used_at` / `download_granted_until` / `single_download_path` |
| `login_attempts` | 登录限流 + 通用限流计数（DB 共享，多 worker 生效） | `key`（按 login/adminlogin/reset/chatrl 四套 scope 隔离）/ `fail_count` / `locked_until` |

### 7.2 文件与内容

| 表 | 用途 | 关键字段 |
|------|------|------|
| `files` | 文件元数据 + 笔记增强 | `owner_id` / `path` / `name` / `size` / `content_hash`（去重）/ `mime_type` / `group_id` / `source` / `guard_status` / `indexed` / `tags`(JSON) / `pinned` / `summary` / `ai_tags`(JSON) / `deleted_at` / `locked_at` / `original_dir` |
| `file_groups` | 用户自定义分组 | `owner_id` / `name` |

### 7.3 同步 / AI / 传输 / 系统

| 表 | 用途 | 关键字段 |
|------|------|------|
| `sync_events` | 同步事件 | `user_id` / `file_id` / `direction` / `status` / `detail` |
| `chat_history` | 对话历史 | `user_id` / `role` / `content` / `tool_calls` |
| `llm_providers` | 大模型配置（管理后台维护） | `provider` / `api_key_enc`（Fernet 加密）/ `base_url` / `model` / `is_default` / `sort_order` |
| `system_settings` | 运行时键值设置（管理员可调整注册/配额/站点名/回收站保留/会话策略等） | `key` / `value` / `updated_at` |
| `access_logs` | 审计日志 | `user_id` / `action` / `detail` / `ip` |
| `transfer_messages` | 文件传输助手消息 | `user_id` / `type`（text/file）/ `content` / `file_id` |
| `mask_mappings` | 脱敏映射表：`mask_id` → `real_value`（确定性哈希，解密时校验 user_id 归属） | `mask_id`(16 位 hex) / `user_id` / `real_value` |

> 所有带 `owner_id` / `user_id` 的表在查询时一律按当前用户过滤，实现数据库层隔离。

---

## 8. API 设计

共 6 个路由组（前缀均在 `api/*.py` 顶部声明）。用户端接口需 `user` token，管理接口需 `admin` token。

### 8.1 认证 `/api/auth`

登录 / 注册 / 改密（签发 HttpOnly cookie 中的 access+refresh，响应体不返回令牌）、刷新令牌（读 refresh cookie）、登出（清 cookie + 吊销会话）、密码重置（密保问题）、设备令牌 CRUD、退出其他设备、一键吊销全部令牌、登录历史查询。

浏览器会话令牌存 HttpOnly + Secure + SameSite=Lax cookie；设备令牌仍走 Authorization 头。

### 8.2 文件 `/api/files`

上传 / 列表（支持按 `group_id` 筛选）/ 详情 / 下载（需临时窗口或单次授权）/ 在线预览（no-store，HTML/SVG/XML 禁止预览防存储型 XSS）/ 删除（软删除入回收站）、重命名、笔记创建（`/note`，直接写 `.md`/`.txt`）、笔记内容加载（`/note-content`）、标签设置（`/tags`）、标签云（`/all-tags`）、置顶（`/pin`）、AI 增强（`/ai-enhance`，LLM 生成摘要与建议标签）、分组 CRUD、移动文件到分组、语义搜索（失败时自动回退关键词搜索）、反向链接（`/backlinks`，匹配 `[[wiki link]]`）、维基链接解析（`/resolve-wikilink`）、批量导出 ZIP、索引重建、存储统计。

上传时做 Guard 检测（文件名 + 内容）、配额检查、`content_hash` 去重。

**临时下载授权**：
- `POST /download-grant`：验证密码后开启 5/15/30 分钟窗口
- `POST /download-grant-single`：验证密码后授权单次下载指定文件（下载后立即失效）
- `POST /download-revoke`：手动关闭
- `GET /download-status` / `GET /download-history`：查询状态与本次窗口下载记录

**回收站**：
- `GET /trash` / `GET /trash/stats`：列表与统计（含剩余天数、锁存数、24h 将过期数）
- `POST /trash/restore` / `POST /trash/restore-batch`：恢复（原路径被占时自动重命名）
- `DELETE /trash`（单个物理清除）/ `POST /trash/purge`（机会性清理过期）/ `POST /trash/purge-batch`（批量，已锁存跳过）
- `POST /trash/lock`：锁存/解锁（跳出自动清理，单用户上限 200）
- `GET /trash/preview`：回收站内只读预览
- `DELETE /trash/all` 与 `POST /trash/empty`：清空回收站（需确认词「永久删除」）

### 8.3 对话 `/api/chat`

发送消息（SSE 流式返回）、历史对话、文档摘要、内容问答（RAG）。受聊天限流保护（`chatrl:{user_id}`）。

**PII 揭帖**：`POST /chat/unmask`（限流 `unmaskrl:{user_id}`）—— 前端用 `mask_id` 换回真实值，校验 user_id 归属。

### 8.4 同步 `/api/sync`

同步状态查询、推送文件、同步事件历史、manifest（活跃文件清单，软删除文件已排除）、上传（带 `base_hash` 冲突检测，409 时守护进程写 `.conflict` 副本）、下载、删除。仅接受设备令牌（浏览器 JWT 拒绝），家里守护进程调用。

### 8.5 管理后台 `/api/admin`

管理员登录（独立入口，自主改密需原密码）、用户 CRUD（含 AI 权限：开通/关闭、分配专属大模型）、配额 / 状态管理、设备令牌吊销、系统统计（含磁盘用量、最近活跃）、全局文件浏览、全局分组总览、全局回收站统计与手动清理、审计日志（分页、按 action 过滤、关联用户名）、系统设置（`allow_register` / `default_quota_mb` / `site_name` / `trash_retention_days` / `max_concurrent_sessions` / `session_idle_timeout_minutes`，运行时调整立即生效）、系统信息（Python/平台/大模型摘要）、大模型配置 CRUD（含测试连通性、删除默认自动迁移）。

### 8.6 传输助手 `/api/transfer`

文字便签（`/text`）+ 文件自动入库（`/file`）的统一时间线（类微信文件传输助手）。返回内容经服务端 PII 脱敏，真实文件路径剥离（前端仅用 `file_id` 引用）。删除文件消息时软删除对应文件（进回收站）。

---

## 9. 安全设计

应用层已内置完整安全机制（bcrypt 密码哈希、JWT access/refresh 分离、可吊销设备令牌与浏览器会话、登录限流、聊天限流、敏感文件 Guard、PII 服务端脱敏、全量审计日志、LLM API Key Fernet 加密、路径穿越防护、敏感路径扫描防护、错误信息不泄露、前端缓存破坏检查等）。部署层的静态数据加密（LUKS / dm-crypt 加密卷，一次覆盖文件 + SQLite + Chroma）见 [DEPLOY_SECURITY.md](DEPLOY_SECURITY.md)。

### 9.1 认证与会话

- **双 Token 体系**：普通用户 JWT（`role=user`）与管理员 JWT（`role=admin`）完全隔离，分别存在 `users` / `admins` 两张表；后端 `get_current_user` / `get_current_admin` 两个独立依赖注入守边界。
- **浏览器会话令牌**：access + refresh 写入 HttpOnly + Secure + SameSite=Lax cookie，前端 JS 不可读，从根上消除 XSS 偷令牌重放。JWT 带 `sid`（会话行 id）+ `password_version`，吊销 / 改密即失效。
- **设备令牌**：opaque random（sha256 哈希入库），走 Authorization 头，用于守护进程；浏览器 JWT 拒绝走 `/api/sync`，防绕过临时下载限制。
- **会话策略**（可由管理员运行时调整）：并发上限 `max_concurrent_sessions`（默认 5，超出自动吊销最早活跃会话）；空闲超时 `session_idle_timeout_minutes`（0=不限制）；同设备（UA 指纹）在 `SESSION_REUSE_HOURS`（默认 5h）窗口内重复登录复用既有会话行；新设备登录写审计日志（含 IP / GeoIP 地域 / 浏览器·OS 标签），便于被动发现盗号。
- **密码版本号**：改 / 重置密码时 `password_version` +1，旧 access / refresh 立即失效；`revoke_all_tokens` 同时 bump 版本号，不留 60 分钟窗口。

### 9.2 授权与限流

- **登录限流**：按 `(scope:用户名, IP)` 滑窗失败计数，5 次 / 15 分钟触发 15 分钟锁定；状态落 SQLite（`login_attempts` 表），**多 worker 共享生效**。`login` / `adminlogin` / `reset` 三套独立 scope，互不连累。客户端 IP 取自受信任代理（见下），防伪造。
- **聊天限流**：复用 `login_attempts` 表结构，独立 key 前缀 `chatrl:{user_id}`（60 秒窗口 20 次），超限回 429。揭帖接口独立 `unmaskrl:{user_id}` 限流，防暴力破解 mask_id。
- **密码策略**：最少 8 位 + 弱密码黑名单 + 不得与用户名相同；首次部署管理员密码弱则拒绝创建（`ALLOW_WEAK_ADMIN_PASSWORD` 调试放行）。
- **信任代理（TRUSTED_PROXIES）**：仅当 TCP 直连对端在 `TRUSTED_PROXIES` 集合内（支持 CIDR）时才采用 `X-Forwarded-For` / `X-Real-IP`，否则用 TCP 对端 IP。Caddy 部署必须填 Caddy 容器 IP / 网段，否则：① 审计日志看不到真实客户端 IP；② 登录限流按 Caddy IP 计数，所有用户共享一个配额。**切勿把 8000 端口直接暴露到公网**（`docker-compose.yml` 已默认 `127.0.0.1:8000:8000`，仅本机可访问）。

### 9.3 传输与访问控制

- **临时下载授权**：浏览器默认禁下载；验证密码后可开启 5/15/30 分钟窗口（`download_granted_until`），或授权单次下载（`single_download_path`，下载后立即清除）。两种模式互斥，开启窗口时清除单次授权。
- **下载历史**：本次窗口内的下载记录写入 `access_logs`（`action=file_download`），`download_granted_at` 标记窗口开启时间，可供审计「这个人在窗口期内下载了什么」。
- **零痕迹**：在线预览强制 `no-store`；HTML / SVG / XML 等可执行类型禁止浏览器预览（防存储型 XSS，返回 415）；离职吊销令牌即可切断访问，公司端无任何需清理的本地文件。
- **CORS / CSRF**：前端与 API 同源，不启用 credentials；会话 cookie 走 SameSite=Lax，写操作全 POST / PUT / DELETE 防跨站请求伪造。

### 9.4 敏感数据保护

- **LLM API Key**：Fernet（HKDF-SHA256 派生密钥）加密入库，运行时按需解密。每次启动透明重加密：把任何用历史密钥（兼容 HKDF(SECRET_KEY) 与裸 SHA256(SECRET_KEY) 两段历史）加密的密文自动重加密为当前密钥，避免轮换导致永久不可解。
- **PII 服务端脱敏**（[mask.py](../server/app/core/mask.py)）：AI 回复中的身份证 / 手机号 / 邮箱 / AWS Key / `sk-` API Key / 私钥块 / GitHub·GitLab Token / 数据库连接串 / 银行卡等 PII，一律遮罩为 `[[M:<16-hex>:<display>]]` 令牌，真实值写入 `mask_mappings` 表（确定性哈希，校验 user_id 归属）。前端渲染 DOM 时替换为可交互遮罩元素，按需调 `POST /api/chat/unmask` 揭帖。
- **传输助手脱敏**：文字便签 PII 遮罩；文件消息剥离真实路径（前端仅用 `file_id` UUID 引用），敏感文件名遮罩。
- **密保答案**：bcrypt 哈希（sha256 预哈希，规避 bcrypt 72 字节上限），兼容历史 sha256，重置时自动升级。
- **反枚举**：忘记密码 / 密保重置对所有用户名返回统一提示；对不存在用户 / 旧 sha256 用户补一次等量 bcrypt，消除时序差。

### 9.5 Guard 敏感文件检测

Guard 是文件的「安检岗」，在文件被同步 / 上传前扫描文件名与内容：

- **凭据类硬拦**（blocked）：`.env`、`id_rsa`、`.pem`、`.key`、私钥块、AWS Key、GitHub·GitLab Token、数据库连接串等
- **隐私类告警**（warning）：含身份证 / 护照 / 银行流水 / 体检报告 / 简历 等关键词
- **方向感知**：往公司带重点查个人隐私（防把身份证、体检报告带去公司）；往家里 / 服务器带重点查公司机密（防把客户名单、薪酬、源代码带回家）
- **内容级扫描**：文件名 + PDF / Word / Excel / PPT 提取文本双重检测，不只看扩展名

### 9.6 输入与路径安全

- **路径穿越防护**（[storage.py](../server/app/core/storage.py) `_safe_path`）：所有文件操作经 `_safe_path` 校验，越界（绝对路径 / `..` / 符号链接逃逸）抛 `FileNotFoundError`，使调用方与「文件不存在」不可区分，不泄露目录结构。
- **敏感路径扫描防护**（[sensitive_paths.py](../server/app/core/sensitive_paths.py)）：`/.env`、`/.git/`、`/.aws/` 等扫描器常探路径直接 404，不返回 SPA index.html，避免被当成 200 命中。
- **错误信息不泄露**：内部异常不返回堆栈给客户端；HTTPException 使用中文友好描述，避免泄露表名、路径、密钥结构。
- **文件上传安全**：最大 500MB（Caddy `request_body.max_size`）；`content_hash` 去重；Guard 双重扫描；HTML / SVG 禁止预览。

### 9.7 前端与部署

- **内容安全策略**（Caddy CSP）：`script-src 'self'` 禁止外链脚本；`img-src 'self' data: blob:`; `media-src 'self' blob:`; `object-src 'none'`; `frame-ancestors 'none'` 防点击劫持。
- **缓存破坏**（cache-busting）：静态资源引用带 `?v=<build>` 查询串；CI 检查（`server/scripts/check-cache-busting.mjs`），改静态文件须升版本号，避免用户浏览器缓存旧版。
- **容器以非 root 运行**（Dockerfile `useradd appuser` + `gosu` 降权），限制被攻破后的影响半径。
- **安全头**：HSTS（1 年）/ X-Content-Type-Options / X-Frame-Options / Referrer-Policy（详见 [Caddyfile](../Caddyfile)）。

完整部署层安全（加密卷 / 密钥 / 运维清单）见 [DEPLOY_SECURITY.md](DEPLOY_SECURITY.md)。

---

## 10. 运维与备份

### 10.1 备份

所有持久化数据落在主机 `${DATA_DIR}` 一棵目录下（文件 + SQLite + Chroma），加密卷块级备份即可保持加密态；文件级备份务必对产物再次加密（gpg / restic）。详见 [DEPLOY_SECURITY.md](DEPLOY_SECURITY.md)「备份」一节。

### 10.2 监控

- 容器健康检查（`docker-compose.yml` 已配置 `/api/health` 探针）
- 磁盘空间监控（管理后台有存储统计）
- 同步失败排查：`sync_events` 表 + 审计日志

### 10.3 迁移

换服务器 / 换 VPS 时，整棵 `${DATA_DIR}` + 原样 `.env`（含三把密钥）搬到新机即可，无需导出导入数据库。完整步骤见 [MIGRATION.md](MIGRATION.md)。

### 10.4 升级路径

| 组件 | 当前 | 升级触发条件 | 升级目标 |
|------|------|-------------|---------|
| 数据库 | SQLite (WAL) | 需要多服务并发写入 | PostgreSQL |
| 存储 | 本地磁盘 | 容量接近上限 | MinIO (S3 兼容) |
| 向量库 | Chroma | 索引量超十万级 | Qdrant |
| 嵌入模型 | Chroma 内置 MiniLM | 需要更好语义召回 | OpenAI Embedding API（已内置开关） |
