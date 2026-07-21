# 随行档 · 侧栏折叠 / 快捷操作命名 / 平台化快捷键 — 产品方案

> 状态：**已全量实施并验证**（P0+P1+P2，2026-07-20）
> 验证记录：后端 pytest 188/188 ✅ · 前端 vitest 244/244 ✅ · 8898 真实页 Playwright 33/33 ✅（Mac/Windows 双平台渲染、折叠按钮定位、tooltip、分组面板、`>`/`#`/`?` 前缀、偏好章节、云同步端点越权用例）
> 最终版本：`app.js?v=100` · `app.css?v=84` · `settings-search.js?v=96` · `platform.js?v=1` · `admin.js?v=22` · `admin.css?v=23`
> 分支：develop → PR 进 main
> 关联代码：`server/app/web/assets/app.js`、`app.css`、`index.html`、`server/app/api/auth.py`、`server/app/db/models.py`、`admin.js`

---

## 0. 需求理解与重构

**原始需求**：① 左侧主菜单要能收起/展开；② 侧栏里标着"搜索"的入口改名"快捷操作"是否更合适；③ 快捷键提示要按操作系统区分，Mac 上不该显示 Ctrl。

**探查后的关键发现**：

| # | 发现 | 代码位置 | 结论 |
|---|------|---------|------|
| 1 | 折叠功能**已存在**（`sidebarCollapsed` 偏好 + `.sidebar.collapsed` 64px 图标栏 + `#sidebar-toggle` 按钮），但按钮 `position: absolute; right: -12px` 而 `.sidebar` / `.app-layout` / `body` **均无定位祖先** → 按钮实际钉在**视口右下角、半枚出了屏幕**，用户看不见 | `app.css:204`、`app.css:35`、`app.js:6290` | 诉求①本质是**修 bug + 可发现性**，不是从零做功能 |
| 2 | 侧栏"搜索"触发器打开的是 `openCommandPalette()`：**空态默认列出快捷操作**（新建笔记/上传/AI 对话/导出/设置子页…），输入后才走 `/api/files/search` 语义搜索。且"搜索"一词在系统里有**三处撞名**（侧栏触发器、文件库工具栏 `files-search`、设置页内搜索） | `app.js:1932-2050`、`app.js:1004`、`app.js:6259` | 用户直觉正确：叫"搜索"低估默认态、与另两处混淆。飞书 ⌘K 面板即叫「快捷操作」，命名有设计系统合法性 |
| 3 | 运行时绑定 `mod = e.metaKey \|\| e.ctrlKey` 本身**兼容 Mac**，但展示层硬编码 `<kbd>Ctrl K</kbd>`，帮助弹窗全写 `Ctrl/Cmd + K`；全仓**零平台检测代码** | `app.js:6262`、`app.js:2317-2334` | 诉求③是纯展示层问题 |

**真实 JTBD**：小屏/专注场景把界面让位给内容；不离开键盘到达任何功能；跨设备（公司 Mac / 家里 Windows）提示都说"本地语言"。

**关键假设**：

| 假设 | 依据 |
|------|------|
| 折叠状态默认**设备本地**持久化（localStorage），服务端同步为可选开关（默认开、用户可关） | 与"零痕迹"兼容：偏好无 PII；多设备用户确实需要一致 |
| 触发器改名**"快捷操作"**，图标保留放大镜 | 用户提议 + 飞书对标；搜索仍是面板一半能力 |
| "依据登录系统区分" = 按**客户端 OS** 区分 | 快捷键由浏览器事件驱动 |
| 主修饰键运行时**继续双接受** ⌘/Ctrl，只改**展示** | VS Code / Figma 通行做法 |

---

## 1. 用户与场景

**场景矩阵（核心）**

| 触发条件 | 预期行为 | 体验要点 |
|---------|---------|---------|
| 点击折叠按钮 / ⌘B(Ctrl+B)（焦点不在输入框） | 侧栏 256px ⇄ 64px 平滑过渡，偏好持久化 | 过渡 0.2s；reduced-motion 直切 |
| 折叠态 hover/focus 导航图标 | 显示文字 tooltip | 设计系统样式，键盘可达 |
| 折叠态点击快捷操作图标按钮 | 照常打开命令面板 | 图标 + ⌘K 角标 |
| Mac 打开快捷操作 | 面板内提示键为 ⌘；Windows/Linux 为 Ctrl | 触发器/帮助弹窗/面板 hint 三处一致 |
| 空态面板 | 按"常用/导航/设置"分组的动作列表 | 输入后无缝切换"文件 · 语义搜索"分组 |
| `>` 前缀 | 仅显示动作；`#` 前缀按标签过滤文件 | Notion/VS Code 式进阶语法 |
| localStorage 不可用 | 静默降级，仅本次会话有效 | 不弹错 |
| ⌘B 在笔记编辑器内 | 只加粗，不折叠侧栏 | 全局处理器 inInput 守卫 |
| 旧缓存 | `?v=` 升级强制刷新 | CSP 铁律 |

**边缘**：iPad 伪装 Mac → ⌘ 渲染正确（外接键盘确有 Cmd）；折叠态回收站角标保留为小红点；打印时侧栏整体隐藏（现状保持）；切换视图时折叠态不闪。

---

## 2. AI 产品专项

| 维度 | 结论 |
|------|------|
| 模型/RAG | **不涉及**。搜索仍走 `/api/files/search` → `indexer.semantic_search`（Chroma），异常回落 `_keyword_search`（现状） |
| Prompt/Agent | 不改 `brain.py`/`tools.py`。面板新增"AI 助手 · 带问题对话"动作仅为**前端路由**（预填 chat 输入），无 prompt 变更 → 按 `PROMPTFOO_GUIDE.md` 不需新评测 |
| 越权防护 | 搜索隔离已验证：`semantic_search(user.id,…)` + `get_current_user`；本需求不新增数据面 |
| 数据回流 | 动作点击频次仅**设备本地**聚合（`sxd_cmdActionUse`），绝不上传 |

---

## 3. 信息架构与数据模型

| 项 | 结论 |
|----|------|
| P0/P1 | 零 DB 变更，偏好走 `loadPref/savePref`（`sxd_` 前缀） |
| P2 | `User` 表增 `prefs = Column(Text, default="{}")`（JSON 串，≤4KB，key 白名单）；迁移走 `Base.metadata.create_all` + 幂等 ALTER（见 `db/models.py` 既有 `_ensure_columns` 模式） |
| 多租户隔离 | 零影响；prefs 严格按 `owner`（当前会话用户）读写 |

**prefs 白名单 schema**：

```json
{
  "sidebarCollapsed": false,      // bool
  "modKeyHint": "auto",           // "auto" | "mac" | "win"
  "cmdActionUse": {"新建笔记": 3} // 动作使用计数（本地镜像，上限 64 key）
}
```

---

## 4. 功能全景

**P0（一个 PR 闭环）**

| # | 功能 | 落点 |
|---|------|------|
| F1 | 修折叠按钮定位：`.sidebar{position:relative}` + 按钮脱离 `overflow:hidden` 裁剪（挪到 `.app-layout` 层渲染，贴侧栏右缘） | `app.css:35,204`、`app.js:renderLayout` |
| F2 | 折叠态可用性：nav 图标 `title`+`aria-label`；快捷操作保留为图标按钮；回收站角标小红点；toggle title 动态（收起/展开）+ `aria-expanded`；清理死类 `.sidebar-collapse-icon` | `app.js:6244-6291`、`app.css` |
| F3 | ⌘B/Ctrl+B 全局切换侧栏（`!inInput && !hasModal` 守卫，避免与编辑器加粗冲突） | `setupGlobalShortcuts` |
| F4 | 触发器改名「快捷操作」，kbd 动态渲染 | `app.js:6259` |
| F5 | 面板分组化：空态"常用/导航/设置"三组 + 组头；输入态"文件 · 语义搜索"组头；placeholder 改"执行操作或搜索文件、笔记…"；补齐缺失动作（笔记、回收站）；底部提示"输入即搜索" | `openCommandPalette` |
| F6 | 平台化：`isMacOS()` 三级检测（`userAgentData.platform` → `navigator.platform` → UA）+ `modKeyHint` 偏好覆盖 + `fmtKey()`；替换全部硬编码 kbd 文案 | `app.js` 新增 utils + `6262`、`2317-2334` |
| F7 | `app.js?v=98→100`、`app.css?v=83→84`（实施中因 Caps Lock 健壮性修复续升至 100） | `index.html` |

**P1**

| # | 功能 | 落点 |
|---|------|------|
| F8 | 设置页新增「偏好设置」章节：修饰键显示（自动/Mac/Windows 三态单选）、侧栏默认状态、折叠提示开关 | 设置 section 注册 + `normalizeSectionId` |
| F9 | 折叠过渡分层动画 + `prefers-reduced-motion` 显式直切 | `app.css` |
| F10 | 动作使用频次本地计数 → "常用"组按频次重排（同频按原序） | `openCommandPalette` |
| F11 | 首次使用引导：折叠按钮一次性脉冲提示（pref 记已见） | `app.css/app.js` |
| F12 | 设计系统 tooltip 组件（替代原生 title，hover/focus 触发，`--shadow`/`--radius`） | 新增 CSS + JS |

**P2**

| # | 功能 | 落点 |
|---|------|------|
| F13 | 偏好云同步：`GET/PUT /api/auth/prefs`（owner 隔离、白名单校验、≤4KB）；登录后与本地合并（云端优先写入项）；设置页开关 | `api/auth.py`、`db/models.py`、前端 |
| F14 | 面板 `>` 前缀仅动作、`#` 前缀标签过滤（复用 `/api/files/all-tags`） | `openCommandPalette` |
| F15 | 面板 AI 动作："AI 助手 · 带问题对话"（预填 chat 输入并聚焦，走既有 `chat.py`，无 prompt 变更） | `openCommandPalette` |
| F16 | 管理端 `admin-sidebar` 折叠一致性（同 64px 图标栏 + 按钮 + 持久化） | `admin.js`、`admin.css` |

---

## 5. 交互与体验

**折叠按钮（方案 A · 边缘悬浮圆钮，修复现有设计）**：24px 圆钮骑在侧栏右缘边框上，展开/收起均可见，箭头方向随状态旋转；`.sidebar` 加 `position: relative`，按钮从 `.sidebar` 内挪出到 `.app-layout` 直属（避开 `overflow: hidden` 裁剪）。

**命令面板状态流转**：

```
[快捷操作 ⌘K] ──click/⌘K──▶ 空态（常用/导航/设置 三组，↑↓ Enter）
  输入≥1字符 ──▶ 搜索态（组头"文件 · 语义搜索"，200ms debounce）
  前缀 > ──▶ 仅动作（含输入过滤）；前缀 # ──▶ 标签选择→该标签文件
  ESC/点遮罩 ──▶ 关闭（还原 body 滚动，现状保持）
```

**设计系统**：只用 `tokens.css` 变量（飞书蓝 `#3370FF`/暗色 `#4D82FF`、Geist、圆角 6/8/10、分层投影）；CSP：零内联事件、`data-action` 委托；改 JS/CSS 必升 `?v=`；暗色零额外工作；reduced-motion 直切。

---

## 6. 技术架构

**后端（P2）**

| Method + Path | Payload | 响应 |
|---|---|---|
| `GET /api/auth/prefs` | — | `{"prefs": {…}}` |
| `PUT /api/auth/prefs` | `{"prefs": {…}}` | `{"ok": true}` / 400（非 JSON、超 4KB、非法 key） |

位置：`api/auth.py`，复用 `get_current_user`；白名单 key + 类型校验；写 `User.prefs`。

**前端**：新增平台检测/`fmtKey` utils；`renderLayout` 重构折叠按钮层级与动态文案；`setupGlobalShortcuts` 加 ⌘B；`openCommandPalette` 分组/前缀/AI 动作；设置页偏好章节；`admin.js` 折叠。

**daemon**：不涉及。**迁移**：`User.prefs` 可空列，幂等补列，无事务风险。

---

## 7. 安全与隐私

| 维度 | 对策 |
|------|------|
| 路径泄露 | 面板项仍走 `file_id` 代理，物理路径不出服务端 |
| 权限 | prefs 端点 owner-scoped；管理端 token 调用返回 401/403（两套认证体系天然隔离） |
| 注入 | prefs 白名单 + 4KB 上限 + 类型校验；渲染全 `escapeHtml` |
| localStorage | 仅布局/计数偏好，无令牌无 PII（令牌在 HttpOnly cookie） |
| 遥测 | **明确不做**前端上报（零痕迹承诺）；动作频次仅本地 |
| 越权测试 | ① A 的 prefs 不被 B 读到 ② admin token 调 prefs 401 ③ 超长/非 JSON/非法 key 被 400 |

---

## 8-10. 性能 / 可观测 / 度量

- 性能：折叠仅 width transition；面板 top-15 与文件总量解耦；唯一风险是浏览器缓存 → `?v=` 验收硬项。
- 可观测：不新增埋点；`/api/files/search` 访问日志间接观察面板使用。
- 度量（全部本地采集，不上传）：折叠使用率（北极星）、⌘K 键盘/点击比、帮助弹窗停留时长；护栏：缓存事故 = 0、折叠/偏好操作零新增服务端请求（P0/P1）。

---

## 11. 风险与对策

| 风险 | 对策 |
|------|------|
| 折叠定位重构牵动打印样式/账户弹层锚点 | 改动限定清单；验收全页扫描含 `@media print` |
| ⌘B 与浏览器扩展冲突 | 仅 `!inInput && !hasModal` 生效；偏好可关 |
| iPad 平台误判 | 三级回落检测 + 设置页手动覆盖 |
| 改名后用户不知能搜索 | placeholder 明示 + 空态底部"输入即搜索"提示 |
| 漏升 `?v=` | PR checklist 硬项 + 无痕窗口验证 |

---

## 12. 落地路线图

完整理想态：侧栏 64px/256px 平滑切换且入口处处可见；"快捷操作"面板是所有功能的单一键盘入口（分组 + 语义搜索 + `>`/`#` 前缀 + AI 入口）；按键提示随平台渲染、可覆盖；偏好可跨设备同步；管理端同构。

| 阶段 | 范围 | 验收 |
|------|------|------|
| 一（P0） | F1–F7 | 真实页：按钮可见可点、tooltip 全、palette 入口保留；Mac 渲染 ⌘K / Windows Ctrl+K（UA 双验）；`node --check`；无痕验缓存；⌘B 编辑器内只加粗 |
| 二（P1） | F8–F12 | 偏好章节可切修饰键显示并全站生效；tooltip 键盘可达；reduce-motion 无动画 |
| 三（P2） | F13–F16 | prefs 三条越权用例过 pytest；admin 折叠独立验收 |

每阶段均为闭环可用交付。

---

## 13. 查漏补缺清单（节选已纳入）

折叠按钮定位 bug ✅F1 · 折叠态 palette 入口 ✅F2 · nav tooltip ✅F2/F12 · toggle aria/title ✅F2 · 死代码清理 ✅F1 · 面板/Alt 号段漏"笔记/回收站" ✅F5 · macOS Ctrl+K 劫持 Emacs 杀行（帮助文档注明，绑定不改）✅ · 设置页缺偏好章节 ✅F8 · 偏好跨设备 ✅F13 · 管理端割裂 ✅F16 · 缓存破坏 ✅F7 · 隐私红线不遥测 ✅ · 打印样式 ✅验收 · 暗色 ✅验收

**实施中新增发现（验证驱动）**：自动化合成事件暴露出真实浏览器同样存在的隐蔽 bug——**Caps Lock 开启时 `e.key` 上报大写字母**，导致全站 ⌘ 组合键静默失灵（含既有的 ⌘K/⌘N/⌘E）。已在全局与编辑器处理器统一 `e.key.toLowerCase()` 归一化，并修正 `?` 帮助快捷键对 `shift+/` 上报差异的兼容（`app.js` setupGlobalShortcuts / 编辑器 keydown）。

## 14. 已拍板决策

1. 折叠按钮形态 = **A 边缘悬浮圆钮**（修好现有设计）+ F11 引导。
2. 触发器图标 = **保留放大镜**（搜索仍是面板一半能力 + 位置记忆）。
3. 偏好存储 = **本地为主 + P2 可选云同步**（默认开、可关， prefs 无 PII 与零痕迹不冲突）。
