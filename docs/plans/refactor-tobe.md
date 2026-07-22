# 随行档 · 终局重构 PRD（To-Be 一步到位版）

> 范围界定：**重构本身一步到位**（前端、后端、Agent 平台、daemon、数据层、基建）；**未来产品功能只做展位**（接口/表/路由/模块骨架预留，不实现）。品牌色经核实为 `--primary: #3370FF`（`server/app/web/assets/tokens.css:36`，飞书蓝），本 PRD 以此为准。

---

## 0. 需求理解与重构

**需求**：假设重构成本不是约束，把随行档从"7067 行单文件 + 胖路由 + 手写 agent 循环"一次性重构成"可承载 MCP/Skills/知识库/客服/数据中心/第三方连接器的平台架构"；MCP 等新功能本期只占接口位、不写实现。

**真实 JTBD**：
- 对**维护者**：让"加一个功能 = 改一个文件"成为现实，架构从负债变成资产
- 对**终端用户**：重构全程无感（数据不丢、会话不断、daemon 不停），重构后体验质变（真流式、可用的语义搜索）

**关键假设**：

| # | 假设 | 依据 |
|---|---|---|
| A1 | 自托管形态不变，允许 compose 多加 1 个 Postgres 容器 | 终局含多 worker + 后台摄入 + 在线 RAG，SQLite 单写是硬顶 |
| A2 | 多租户自带 LLM key（DeepSeek 等 OpenAI 兼容）仍是核心卖点 | `server/app/core/llm_service.py` 的 per-user provider 是刻意设计 |
| A3 | daemon 可出 v2 并要求升级（给兼容窗口）| daemon 带两个数据丢失级 bug，必须重建 |
| A4 | 前端终局选 React 生态 | 生态深度 + agent UI 现成方案 |
| A5 | 重构期间生产不停服，数据零迁移损失 | 已上线产品 |

---

## 1. 用户与场景

### 用户画像

| 画像 | 特征 | 对重构的核心诉求 |
|---|---|---|
| 普通用户 | 自托管者本人 + 少量多账户成员；公司/家里双端 | 重构无感；聊天秒级流式；长文档深处可检索 |
| 管理员 | 同一人或受委托人 | 后台可看 token 成本/trace；迁移可灰度可回滚 |
| 开发者 | 单人维护 + 学习中 | 加功能只动一个层；agent 架构可作学习范本 |

### 场景矩阵（重构期特有）

| 类型 | 触发 | 预期行为 |
|---|---|---|
| 核心 | 新版上线，用户刷新 | 新 SPA 加载，cookie 会话仍有效，零重新登录 |
| 核心 | 新前端调 `/api/v1/*` | 全类型化响应，错误有统一 `code` 字段 |
| 边缘 | 旧 daemon（v1）连新后端 | `/api/sync/*` 兼容层继续服务，后台提示待升级 |
| 边缘 | 存量 Chroma 索引 | 迁移 worker 后台分块重建，双读降级，完成后退役 |
| 异常 | 迁移中途崩溃 | Alembic 事务回滚；数据文件只读挂载不受影响 |
| 异常 | LLM provider 挂起 | 网关 60s 超时 + 前端可取消 + trace 记录 |

---

## 2. AI 产品专项

### 2.1 模型选型与降级

所有 LLM 调用收敛到 `server/app/agent_platform/llm/gateway.py`（现 `core/llm_service.py` 的 `chat_complete` 是雏形）：

| 调用类型 | 策略 | 参数 |
|---|---|---|
| agent 主循环 | 用户指定 provider（OpenAI 兼容 base_url 或 Anthropic）| timeout=60s, retries=0, 流式 |
| 轻量任务 | 每 provider 可配"便宜路由"模型（Claude 用户用 `claude-haiku-4-5`）| 非流式 |
| embedding | 默认本地 `bge-m3`（中文强），备选 OpenAI `text-embedding-3-small` | 批处理 |
| 降级链 | 连续失败 3 次 → 熔断 5 分钟 → 提示备用通道 | 熔断器模式 |

**Pydantic AI 作为循环引擎**：`OpenAIModel(base_url=...)` 吃任意 OpenAI 兼容端点，`AnthropicModel` 覆盖 Claude 用户——per-tenant provider 架构完整保留。

### 2.2 Agent 设计（`agent/brain.py` + `tools.py` → `agent_platform/`）

```
agent_platform/
├── runtime/      loop · context · events · policy     # 循环/上下文/事件协议/HITL
├── llm/          gateway · providers/ · budget · prompts/
├── tools/        base(Protocol) · registry · native/(16个迁入) · mcp/(展位)
├── skills/       base · registry · builtin/           # 展位：SkillSpec + 注册接口
├── memory/       conversation · compaction · profile(展位)
├── rag/          pipeline · chunking · embedding · store · retrieve · connectors/(展位)
├── observability/tracing · evals/
└── api.py        chat 端点消费 runtime
```

**Tool Protocol（全平台第一抽象）**——`tools/base.py`：

```python
class Tool(Protocol):
    name: str; description: str; schema: type[BaseModel]
    permission: Literal["read", "write", "destructive"]
    async def run(self, ctx: RunContext, args: BaseModel) -> ToolResult: ...
```

本地工具、MCP 远程工具（`tools/mcp/` 适配器包装）、Skill 附带工具**同一接口**；`destructive` 级（`delete_file(purge=True)` 等）强制走 `confirm_request` 事件 → 前端确认 → 恢复循环。

**事件协议**（`runtime/events.py`，取代假流式 `brain.py:118-193`）：

| 事件 | 载荷 | 消费方 |
|---|---|---|
| `delta` | token 文本增量 | chat UI 流式渲染 |
| `tool_start/tool_end` | 工具名+脱敏参数 / 摘要 | "正在搜索文件…" 状态 |
| `confirm_request` | 工具+参数+风险说明 | step-up 确认对话框 |
| `citation` | 文件引用（file_id）| 答案下方引用卡 |
| `done/error` | 完整结果 / 错误码 | 收尾 |

### 2.3 RAG 召回—排序（`core/indexer.py` 重建为 `rag/`）

| 环节 | 现状 | To-Be |
|---|---|---|
| 分块 | 整文件单文档（`indexer.py:122,146`）| 512 token 滑窗 + 64 重叠，按标题/段落边界；PDF 按页元数据 |
| embedding | 默认英文 MiniLM | 默认 `bge-m3`，1024d 入 **pgvector**（HNSW, cosine）|
| 检索 | 文件级 top-k | 块级 top-30 → RRF 融合 BM25 → rerank → top-5 |
| 注入 | 字符截断（`tools.py:276-279`）| token 预算内注入 + `citation` 事件回传 file_id |
| 隔离 | Chroma 按用户 collection | `kb_chunks.owner_id` 行级过滤，仓库层统一 |

### 2.4 幻觉/越权/安全

- `guard.py` 方向感知 DLP 保持，移入 `tools/` 前置中间件：write/destructive 工具过 guard
- `mask.py` 保持架构，补：`MaskMapping.real_value` 改 Fernet 加密存储（复用 `core/security.py` HKDF 派生）
- agent 输出引用文件只回 file_id（`_resolve_file_path` 体系，`api/files.py:722`）
- prompt 注入防线：工具结果文本以 `<untrusted_content>` 包裹；`sensitive_paths.py` 保持

### 2.5 成本/延迟目标

| 指标 | 现状 | To-Be |
|---|---|---|
| 首 token 延迟 | 全量等待（假流式）| < 1.5s（真流式 + 前缀缓存）|
| 单轮 agent | 无上限（SDK 默认 600s）| p95 < 20s，硬超时 60s |
| 长文档深处召回 | ~0 | 人工评测 ≥ 80% |
| token 记账 | 无 | 每轮 usage 落 `agent_traces` |

### 2.6 评测（对接 `PROMPTFOO_GUIDE.md`）

| 评测集 | To-Be |
|---|---|
| note-enhance | 保留 4 例 + 进 CI（agent diff 触发）|
| 工具选择 | 20+ 例：意图→期望工具（含"不该调工具"负例）|
| qa 忠实度 | 答案每句可溯源到引用块，否则 fail |
| mask 红队 | 10+ 例含身份证/密钥的回复，断言无明文泄露 |
| 反幻觉 | 空结果场景 5 例，断言回复含"没有找到" |

### 2.7 数据回流飞轮

- 本期：`events` 表写入——对话轮次、工具调用、confirm 拒绝率、引用点击、"没有找到"后用户行为
- 展位：数据中心看板；低引用点击率 query → 检索调优清单

---

## 3. 信息架构与数据模型

### 3.1 ER 变化

```
users ─┬─ files ─── file_groups          (现有，保持)
       ├─ access_tokens / access_logs    (现有，保持)
       ├─ chat_messages                  (改：+tool_results/trace_id/session_id)
       ├─ llm_providers                  (现有，保持)
       ├─ mask_mappings                  (改：real_value 加密)
       ├─ agent_traces        【新增】
       ├─ jobs                【新增：任务队列】
       ├─ events              【新增：行为事件流，按月分区】
       ├─ kb_chunks(pgvector) 【新增：本期 RAG 实际使用】
       ├─ kb_collections / kb_documents 【展位】
       ├─ mcp_servers         【展位】
       ├─ skills_config       【展位】
       └─ bots                【展位：客服 bot 配置】
```

### 3.2 表改动（`server/app/db/models.py` → 拆为 `db/models/`）

| 表 | 动作 | 字段 |
|---|---|---|
| `chat_messages` | 改 | + `tool_results JSON`（修复多轮丢工具结果）+ `trace_id` + `session_id` |
| `mask_mappings` | 改 | `real_value` → `real_value_enc`（Fernet）|
| `users` | 清理 | 删 `totp_*` 死列 |
| `agent_traces` | 新增 | `id, user_id, session_id, skill, rounds, tokens_in, tokens_out, cost_usd, duration_ms, status, tool_calls JSON, created_at` |
| `jobs` | 新增 | `id, kind, payload JSON, status, attempts, run_after, locked_at, locked_by, result JSON, created_at`；worker 用 `FOR UPDATE SKIP LOCKED` |
| `events` | 新增 | `id, user_id, kind, props JSON, session_id, created_at` |
| `kb_chunks` | 新增 | `id, owner_id, file_id, ord, content, embedding vector(1024), tokens, meta JSON`；HNSW |
| `kb_collections/documents`、`mcp_servers`、`skills_config`、`bots` | 展位建表 | 字段冻结、不写业务逻辑 |

### 3.3 多租户三重隔离（继承强化）

| 层 | To-Be |
|---|---|
| 存储目录 | `{STORAGE_DIR}/{user_id}/` 不变；`_safe_path` 保持 |
| DB 行级 | **仓库层强制**：`Repository.for_user(uid)` 预绑定过滤，handler 拿不到无主查询 |
| 向量 | `kb_chunks.owner_id` 行级 + 仓库层统一 WHERE；可按 group 授权检索 |

### 3.4 向量索引迁移

存量整块坏数据 → worker 按用户 `reindex` 任务 → 分块重嵌入写 `kb_chunks` → 双读期（新表优先、空回落 Chroma）→ 完成后 Chroma 退役。

---

## 4. 功能全景（非 MVP）

### P0 — 重构骨架

| 功能 | 要点 | 集成点 |
|---|---|---|
| API 契约化 | 105 端点全 `response_model`；统一错误体 `{code,message,detail?}`；`/api/v1` 前缀 | 新建 `api/v1/` |
| 服务层 | `ingest_file()` 收敛 4 份管道；`trash` 收敛 3 份 purge | 新建 `services/`、`repositories/` |
| 迁移体系 | Alembic baseline=现结构；删 `_migrate_columns` try/except:pass（`models.py:452-555`）| 新建 `alembic/` |
| Postgres+pgvector | compose 加 PG 容器；迁移工具 + 校验报告 | `docker-compose.yml`、`db/engine.py` |
| Agent 平台一期 | 真流式；超时/预算；工具错误真回传；json.loads 进 try | `agent_platform/` 替 `agent/brain.py` |
| RAG 重建 | 分块 + bge-m3 + pgvector + 混合检索；存量重建 worker | `agent_platform/rag/` 替 `core/indexer.py` |
| 新前端 | OpenAPI → TS 客户端 → React SPA 全视图 | 新建 `web/` |
| Daemon v2 | 本机 SQLite 状态库 + hash 检测 + 原子写 + 退避队列；v1 兼容层 | 重写 `daemon/` |
| 可观测性 | structlog；`/api/health` 实探；日志轮转 | `core/logging.py`、`observability/` |

### P1 — 平台化前置

| 功能 | 集成点 |
|---|---|
| Tool 注册台（管理端）| `api/v1/admin/tools`；`tools/registry.py` |
| Prompt 版本化 | `llm/prompts/`；eval 引用同一份 |
| HITL 全量覆盖 | destructive 工具全走 confirm 事件 |
| E2E 测试 | Playwright；CI 门禁 |
| eval 进 CI | agent diff 触发 |
| 部署门禁 | 冒烟失败回滚上一镜像 |
| 功能开关 | `core/flags.py` + 管理端 UI |

### P2 — 功能展位（仅骨架，路由返 501）

| 展位 | 预留物 |
|---|---|
| MCP server | `agent_platform/mcp_server.py` 骨架；`/api/v1/mcp` 501 |
| MCP client | `tools/mcp/adapter.py` Protocol；`mcp_servers` 表 |
| Skills | `skills/base.py` SkillSpec + registry 接口 |
| 知识库产品化 | `kb_*` 表；`rag/connectors/base.py` Protocol；`/api/v1/kb/*` 501 |
| 智能客服 | `ChannelAdapter` Protocol；`bots` 表；widget 占位路由 |
| 数据中心 | `events` 写入已实现；`/api/v1/analytics/*` 501 |
| Notion/飞书 | `connectors/notion.py`、`feishu.py` 骨架；OAuth 回调 501 |

---

## 5. 交互与体验

### 5.1 对话流程（变化最大）

```
发送 → POST /api/v1/chat/sessions/{id}/messages (SSE)
  → [tool_start] "🔍 正在语义搜索…"（可展开脱敏参数）
  → [confirm_request]? destructive 弹确认卡 → 确认/拒绝
  → [delta]* 逐 token 渲染（rAF 合并，完成后 hljs/KaTeX/mermaid）
  → [citation] 引用卡（点击开预览）
  → [done] 落库（含 tool_results），trace 记录
  异常：[error] 统一错误体；AbortController 随时可停
```

### 5.2 设计系统

| 要素 | 规范 |
|---|---|
| 色彩 | tokens.css 移植为 Tailwind v4 `@theme`：`--primary: #3370FF`、`--primary-hover: #2860E8`；暗色走变量覆盖（tokens.css:115-157）|
| 字体 | Geist 无衬线 |
| 圆角/投影 | 7/10/12 + 分层投影，按 `docs/UI_SPEC.md` |
| 组件库 | shadcn/ui（吃我们的 token）；**复古宋体/金印/朱印已否决，不回头** |

### 5.3 CSP 与缓存

| 现状痛点 | 终局 |
|---|---|
| 30+ 手动 `?v=` + CI grep | Vite 内容 hash 文件名，`?v=` 机制整体删除 |
| 4 种事件绑定、19 个 `window.*` | React 合成事件；CSP `script-src 'self'` 天然达成 |
| CSP 只在 Caddy、dev 裸奔 | dev 同策略 CSP |

### 5.4 a11y/响应式/暗色

键盘全可达；焦点环 `--primary-ring`；对话流 `aria-live="polite"`；3 断点响应式；暗色 `data-theme` 跟随系统可选。

---

## 6. 技术架构

### 6.1 后端 API（`server/app/api/v1/`）

统一约定：前缀 `/api/v1`；错误体 `{"code":"TRASH_FILE_NOT_FOUND","message":"…","detail":{…}?}`（消灭 `files.py:1333` 中文字符串匹配判状态码）；全部 `response_model`；datetime 统一 ISO8601。

核心端点示例：

| Method + Path | 替代 |
|---|---|
| `POST /api/v1/files:batchUpload` | `files.py:171-257` |
| `POST /api/v1/files/{file_id}:move` | move-to-group |
| `POST /api/v1/trash/{file_id}:restore`（409 冲突带 suggestion）| `files.py:1329-1340` |
| `POST /api/v1/chat/sessions/{sid}/messages`（SSE）| `chat.py:78` + `brain.py:118` |
| `POST /api/v1/chat/sessions/{sid}/messages/{mid}:confirm` | 新增（HITL）|
| `GET /api/v1/traces` | 新增 |
| `POST /api/v1/sync/manifest`（v2 daemon）| `sync.py:108` |
| `/api/sync/*` 兼容层 | 旧 daemon 一个版本 |

路由拆分（`files.py` 1617 行）：`v1/files.py` `v1/notes.py` `v1/downloads.py` `v1/groups.py` `v1/search.py` `v1/trash.py`，每个 < 200 行。

### 6.2 服务层与仓库层

```
services/
├── ingest.py        # 唯一入库管道（收敛 4 份：files.py:171-257/:260-396、sync.py:15-94、transfer.py:78-155）
├── trash.py         # 收敛 3 份 purge（main.py:31-60、files.py:1250-1274、admin.py:225-246）
├── note_ai.py       # 收纳 files.py:539-636 编排
├── search.py        # 关键词+语义统一入口
├── session_grants.py# 下载授权（files.py:776-868）
└── auth_service.py  # auth.py 下划线函数转正为公开 ABI
repositories/
├── base.py          # for_user(uid) 强制行级过滤
└── *.py             # 消灭 30 处内联 db.query
```

### 6.3 Agent 平台（框架决策锁定：Pydantic AI）

| 候选 | 裁决 |
|---|---|
| Claude Agent SDK | ❌ 仅 Anthropic——杀死多租户自带 key 卖点 |
| LangChain/LangGraph | ❌ 抽象过厚、版本颠簸 |
| OpenAI Agents SDK | ⚠️ 强候选，但 tracing 默认回传 OpenAI |
| **Pydantic AI** | ✅ 多 provider 原生（OpenAI 兼容 base_url + Anthropic）；Pydantic v2 结构化输出一等公民；MCP client 内置；依赖注入承载 RunContext；源码可读 |
| 纯手写 | ✅ 兜底：Tool/事件协议在框架之下，Pydantic AI 只是 `runtime/loop.py` 内部实现，可换 |

`brain.py` 的 `chat`/`chat_stream` 两份重复 → 一份 `run_agent`；SYSTEM_PROMPT → `llm/prompts/file-assistant.v3.md`（版本化，补全 16 工具清单，修 14/16 漂移）。

### 6.4 前端（`web/`，终局栈锁定）

| 层 | 选型 |
|---|---|
| 框架 | React 19 + TypeScript + Vite 6 |
| 样式 | Tailwind v4（`@theme` 吃 tokens）+ shadcn/ui |
| 路由/数据 | TanStack Router + TanStack Query（替代 3 套 hash 路由、83 处手写 fetch）|
| 状态 | Zustand（替代 ~60 个全局变量）|
| API 客户端 | `@hey-api/openapi-ts` 生成；SSE 用 `eventsource-parser` |
| 测试 | Vitest + Testing Library + Playwright E2E |

绞杀者迁移：Caddy 同时托管新旧（`/next` 灰度）→ chat→files→notes→settings→trash → 删 `app.js`/`admin.js`。

### 6.5 Daemon v2

| 模块 | 设计 |
|---|---|
| 状态库 | 本机 SQLite 替 JSON，原子事务 |
| 变更检测 | 内容 hash 为准；full_sync 保留 hash；键名统一 |
| 冲突 | base_hash 全程有效 → 409 → `.conflict`；`.conflict` 加排除清单 |
| 删除 | 离线删除写 tombstone；空 manifest 熔断（变更 > 50% 拒绝+告警）|
| 传输 | 流式哈希+流式上传；下载 tmp+rename+校验；退避重试队列 |
| 安全 | 服务器下发路径客户端校验；强制 https |
| 引擎 | 单 asyncio loop |

### 6.6 异步任务/事务/迁移

- 任务队列：`jobs` 表 + worker 进程 `FOR UPDATE SKIP LOCKED`；`TaskQueue` 接口可换 Redis/arq
- 事务边界：DB 单事务，磁盘写在事务前（失败补偿），索引入队（最终一致）
- 迁移：Alembic baseline → 新表 → mask 加密；SQLite→PG 用 pgloader + 校验脚本

---

## 7. 安全与隐私

| 维度 | To-Be |
|---|---|
| 脱敏（`mask.py`）| 架构保持；`real_value` 改 Fernet 加密；覆盖新增 citation 事件与 trace |
| 路径泄露 | file_id 代理保持；response model 编译期杜绝 path 字段外泄 |
| 权限 | Depends 保持；补越权方向测试（普通用户打 admin 端点必 403）；补 JWT 篡改/过期测试 |
| 限流 | 迁出 models.py → `core/rate_limit.py`；补登录爆破锁定端到端测试 |
| 密钥 | `SECRET_KEY`/`ADMIN_PASSWORD` 默认值启动即 fail（修 `config.py:149-150`）；JWT/DEK 不回退 SECRET_KEY（修 :85-92）；`bcrypt`/`cryptography` 写入 requirements.txt |
| CSP | `script-src 'self'` 保持；构建产物 hash 化 |

---

## 8. 性能与可扩展性

| 场景 | 对策 |
|---|---|
| 海量文件列表 | 游标分页；复合索引 |
| 大文件上传 | 流式保持；worker 异步索引 |
| 大文件同步 | daemon v2 流式；断点续传 P2 展位 |
| 长会话 | compaction 摘要；session_id 归档 |
| 并发写 | Postgres 消灭单写瓶颈；worker/web 分进程 |
| 向量检索 | pgvector HNSW；owner_id 前置过滤 |
| 缓存 | TanStack Query；设置缓存保持；LLM 前缀缓存 |

---

## 9. 可观测性与运营

| 能力 | 设计 |
|---|---|
| 日志 | structlog JSON；trace_id 贯穿；compose 日志轮转 |
| 健康检查 | 实探 DB + 存储可写 + 向量库 + worker 心跳 |
| 指标 | `/metrics` Prometheus 格式 |
| Agent trace | `agent_traces` + 管理端瀑布图；OTel 可选导出 Langfuse |
| 灰度/开关 | `core/flags.py`；按用户灰度 |
| 回滚 | 镜像 tag；冒烟失败自动回退；Alembic downgrade |

---

## 10. 度量与成功标准

| 层级 | 指标 | 定义 |
|---|---|---|
| 北极星 | 周活跃对话轮次 | 7 天内 agent 轮次会话数 × 平均轮次 |
| 核心 | 首 token 延迟 p95 | 首个 delta - 请求时间 |
| 核心 | 检索命中率 | 有引用回答 / 总回答 |
| 核心 | 同步成功率 | daemon 成功操作 / 总操作 |
| 护栏 | 数据丢失事故 | = 0 |
| 护栏 | 越权漏洞 | 对抗测试套件 100% |
| 重构专用 | 迁移完整性 | 行数一致 ∧ 抽样 hash 100% |

---

## 11. 风险与对策

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| 迁移丢数据 | 低 | 极高 | 快照+双写验证+一键回切 |
| 新前端回归 | 中 | 高 | 绞杀者灰度 + E2E + 旧 SPA 保留一版 |
| 框架与多 provider 行为差异 | 中 | 中 | 网关一致性测试；协议在下可换 |
| embedding 资源占用 | 中 | 中 | worker 隔离；批大小自适应 |
| daemon 升级覆盖率 | 中 | 中 | 兼容层两版本窗口 + 版本告警 |
| 范围膨胀烂尾 | 高 | 高 | 阶段量化门禁；展位严格 501 |

---

## 12. 落地路线图

| 阶段 | 目标 | 验收标准 |
|---|---|---|
| **S0 止血**（1 周）| 消灭数据丢失 | daemon 回归测试全绿；生产发布 |
| **S1 地基**（2-3 周）| 后端终局分层 | 全端点走 v1 契约；ingest 单测覆盖 4 场景；兼容层在线 |
| **S2 Agent 平台**（3 周）| agent 终局 | 长文档深处检索命中；首 token p95<1.5s；HITL 全覆盖；eval 绿 |
| **S3 前端终局**（4 周）| 新 SPA 上线 | E2E 全绿；灰度 100%；旧 SPA 删除 |
| **S4 Daemon v2**（2 周）| 同步终局 | 断网恢复同步正确率 100%；冒烟门禁生效 |
| **S5 展位固化**（1 周）| 接口冻结 | 每展位有冻结 Protocol + 文档 + 501 |

每阶段独立可发布。

---

## 13. 查漏补缺清单

| # | 条目 | 处理方式 | 优先级 |
|---|---|---|---|
| 1 | 数据迁移回滚预案 | 快照+双写验证+回切 | P0 |
| 2 | daemon 强制升级策略 | 两版本窗口 + 版本告警 | P0 |
| 3 | 越权方向测试 | 每 admin 端点补 403 用例 | P0 |
| 4 | 备份中脱敏一致性 | 备份含 mask_mappings | P0 |
| 5 | prompt 注入 | untrusted 包裹 + 红队 eval | P0 |
| 6 | 前端错误边界 | ErrorBoundary + 离线横幅 | P1 |
| 7 | i18n 预留 | code 字段即翻译键 | P1 |
| 8 | API 弃用策略 | Deprecation/Sunset 头 | P1 |
| 9 | worker 幂等 | idempotency_key | P1 |
| 10 | embedding 换模型重索引 | meta.model 记录 | P1 |
| 11 | 管理端误操作 | 二次确认 + 审计 | P1 |
| 12 | trace 隐私 | 过 mask；30 天保留 | P1 |
| 13 | 依赖审计 | pip-audit 硬门禁 + SBOM | P2 |
| 14 | 文档同步 | 每阶段文档门禁 | P1 |

---

## 14. 开放问题

| # | 问题 | 倾向 |
|---|---|---|
| Q1 | 前端框架 | **React 19 + TS + shadcn/ui**（Vue 3 + Arco 为等价备选）|
| Q2 | 数据库终局 | **Postgres+pgvector** |
| Q3 | daemon v1 兼容窗口 | **两个发布版本** |
