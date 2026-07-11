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
| 零痕迹 | 公司电脑只开浏览器，不装任何东西。离职时在服务器一键吊销访问权 + 清浏览器记录即可 |
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

**公司电脑（零安装）**——只开浏览器，登录域名找文件 / 对话 / 上传下载，没有客户端、配置文件或同步缓存。

### 2.3 离职清理链路

```
服务器后台点"吊销公司访问"
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

### 3.1 双入口

服务器侧有两个 FastAPI 应用实例，分别服务两类入口：

| 入口 | 应用 | 路由 | 说明 |
|------|------|------|------|
| 用户端 `https://域名/` | `app.main:app` | auth / files / chat / sync / admin / transfer | 文件管理、AI 对话、同步、传输助手 |
| 管理后台 `https://域名/admin` | `app.admin_server:app`（独立实例） | auth / admin | 用户管理、系统统计、审计日志 |

生产部署时两者都经 Caddy 反代到同一个后端（本地开发用 `start.sh` 起 8899/8900 双端口）。

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

- 创建 / 禁用 / 启用 / 删除用户、重置密码、设置存储配额
- 管理用户访问令牌：为任意用户创建 / 吊销设备令牌、一键吊销全部（应急下线设备）
- 系统统计：用户数、文件数、磁盘用量、各用户用量明细
- 审计日志：登录 / 上传 / 删除 / 管理操作的完整记录

删除用户时自动清理其全部文件、数据库记录和向量索引。

---

## 4. Agent 智能层

### 4.1 Agent 定位

把 agent 当成一个有手有眼、能操作文件系统的助手。它不只是聊天，能借助 function-calling 实际执行操作。

### 4.2 Agent 工具集

| 工具名 | 功能 | 说明 |
|--------|------|------|
| `search_files` | 语义 + 关键字找文件 | "上个月那份报价"也能命中 |
| `sync` | 发起同步/推送 | 按自然语言意图执行文件搬运 |
| `summarize` | 文档摘要 | 不打开就能了解内容 |
| `qa` | 内容问答 | RAG 检索，"这份合同的关键条款" |
| `transfer` | 文件传输助手 | 文字便签 + 文件自动入库（类微信传输助手） |
| `cleanup_hint` | 清理建议 | 识别长期不用、该归档、该删的文件 |

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
├── docker-compose.yml          # 容器编排（server + caddy）
├── Caddyfile                   # Caddy 反向代理 + 自动 HTTPS
├── .env.example                # 环境变量模板
├── start.sh                    # 本地开发双端口启动（8899 用户端 / 8900 管理端）
│
├── server/                     # 服务器端
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── app/
│   │   ├── main.py             # 用户端 FastAPI 入口
│   │   ├── admin_server.py     # 管理端 FastAPI 入口（独立实例）
│   │   ├── config.py           # 配置（pydantic Settings，读 env）
│   │   ├── api/                # API 路由（6 组）
│   │   │   ├── auth.py         #   /api/auth     认证 + TOTP + 注册
│   │   │   ├── files.py        #   /api/files    文件 CRUD + 语义搜索
│   │   │   ├── chat.py         #   /api/chat     AI 对话（SSE）+ 摘要 + QA
│   │   │   ├── sync.py         #   /api/sync     同步状态 / 推送 / 事件
│   │   │   ├── admin.py        #   /api/admin    管理后台（用户/统计/审计/令牌）
│   │   │   └── transfer.py     #   /api/transfer 文件传输助手
│   │   ├── core/               # 核心逻辑
│   │   │   ├── storage.py      #   文件存储抽象（user_id 前缀隔离）
│   │   │   ├── indexer.py      #   Chroma 索引 + 语义搜索
│   │   │   ├── llm_service.py  #   LLM 调用 + function-calling 编排
│   │   │   ├── guard.py        #   Guard 敏感文件检测
│   │   │   └── security.py     #   密码哈希 / JWT / TOTP / Fernet 加密
│   │   ├── db/
│   │   │   └── models.py       #   数据模型（12 张表）+ 限流 + 迁移
│   │   └── web/                # 前端静态资源（无构建）
│   │       ├── index.html      #   用户端
│   │       ├── admin/index.html#   管理后台
│   │       └── assets/         #   app/admin 的 css/js + lib（marked、dompurify）
│   └── tests/                  # 测试
│
├── daemon/                     # 家里守护进程
│   ├── watcher.py              #   文件夹监听 + 定时全量同步
│   └── config.py               #   守护进程配置
│
└── docs/                       # 文档
    ├── DESIGN.md               # 本文件
    ├── DEPLOY_SECURITY.md      # 部署安全（加密卷 / 密钥 / 安全机制）
    └── MIGRATION.md            # 换服务器迁移指南
```

---

## 7. 数据模型

SQLite，共 12 张表（`db/models.py`）。按职责分组：

### 7.1 认证与账户

| 表 | 用途 | 关键字段 |
|------|------|------|
| `users` | 普通用户 | `username` / `password_hash` / `totp_*` / `role` / `status` / `quota_mb` / `ai_enabled` / `llm_provider_id` / 密保问答 |
| `admins` | 管理员（独立表，与用户彻底分离） | `username` / `password_hash` / `totp_*` |
| `access_tokens` | 可吊销的设备令牌 | `user_id` / `label` / `token_hash` / `expires_at` / `revoked` / `last_used_at` |
| `login_attempts` | 登录限流 + 聊天限流计数（DB 共享，多 worker 生效） | `key`（按 login/admin/reset 三套 scope 隔离）/ `fail_count` / `locked_until` |

### 7.2 文件

| 表 | 用途 | 关键字段 |
|------|------|------|
| `files` | 文件元数据 | `owner_id` / `path` / `name` / `size` / `content_hash`（去重）/ `group_id` / `source` / `guard_status` / `indexed` |
| `file_groups` | 用户自定义分组 | `owner_id` / `name` |

### 7.3 同步 / AI / 系统

| 表 | 用途 | 关键字段 |
|------|------|------|
| `sync_events` | 同步事件 | `user_id` / `file_id` / `direction` / `status` / `detail` |
| `chat_history` | 对话历史 | `user_id` / `role` / `content` / `tool_calls` |
| `llm_providers` | 大模型配置（管理后台维护） | `provider` / `api_key_enc`（Fernet 加密）/ `base_url` / `model` / `is_default` |
| `system_settings` | 运行时键值设置 | `key` / `value` |
| `access_logs` | 审计日志 | `user_id` / `action` / `detail` / `ip` |
| `transfer_messages` | 文件传输助手消息 | `user_id` / `type`（text/file）/ `content` / `file_id` |

> 所有带 `owner_id` / `user_id` 的表在查询时一律按当前用户过滤，实现数据库层隔离。

---

## 8. API 设计

共 6 个路由组（前缀均在 `api/*.py` 顶部声明）。用户端接口需 `user` token，管理接口需 `admin` token。

### 8.1 认证 `/api/auth`

登录（返回 JWT access + refresh）、刷新令牌、注册（受 `ALLOW_REGISTER` 开关控制）、TOTP 双因子 setup/verify、密码重置（密保问题）。

### 8.2 文件 `/api/files`

上传 / 列表 / 详情 / 下载 / 删除、语义搜索、文件分组管理。上传时做 Guard 检测、配额检查、`content_hash` 去重。

### 8.3 对话 `/api/chat`

发送消息（SSE 流式返回）、历史对话、文档摘要、内容问答（RAG）。受聊天限流保护。

### 8.4 同步 `/api/sync`

同步状态查询、推送文件、同步事件历史。家里守护进程通过设备令牌调用。

### 8.5 管理后台 `/api/admin`

管理员登录（独立入口）、用户 CRUD、配额 / 状态管理、设备令牌吊销、系统统计、审计日志、大模型配置管理。

### 8.6 传输助手 `/api/transfer`

文字便签 + 文件自动入库的统一时间线（类微信文件传输助手）。

---

## 9. 安全设计

应用层已内置完整安全机制（bcrypt 密码哈希、JWT access/refresh 分离、TOTP 双因子、可吊销设备令牌、登录限流、敏感文件 Guard、全量审计日志、LLM API Key Fernet 加密等），详见 [DEPLOY_SECURITY.md](DEPLOY_SECURITY.md)。

部署层的静态数据加密（LUKS / dm-crypt 加密卷，一次覆盖文件 + SQLite + Chroma）同样见该文档。

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
