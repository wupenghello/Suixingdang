# PRD · 内部 app/admin 对齐落地页理想态

> 状态:已确认开工(2026-07-17)
> 决策:**Q1A 品牌色统一 `#3370FF`** · **Q2A 删除旧 `renderLanding()`,统一静态 `landing.html`** · **Q3B 不纳入暗色,先统一亮色**
> 范围:用户端 SPA + 管理端 + 落地页 + 登录页四端,设计系统统一 + UI 组件对齐 + 功能保真度对齐 + bug 修复

## 0. 需求理解与重构

- **理解**:落地页已达可上线产品级;用户端 SPA 与管理端在 UI 样式与功能呈现上有落差。要做**反向对齐**——把内部的视觉语言/组件/功能体验拉升到落地页标杆。
- **JTBD**:从落地页进应用后感觉是同一个产品(同色/同图标/同质感),且落地页承诺的每个能力(档案室侧栏、语义命中、笔记双链、PII 脱敏对比)在应用内真的长那样、真的好用。
- **关键假设**:品牌色统一 `#3370FF`(飞书蓝);样式+功能两层对齐,样式优先;旧 `renderLanding()` 废弃;不引入新框架,复用 CSP `data-action` + `?v=` + 三重隔离。

## 1. 用户与场景

两类用户:普通用户(家里/公司/移动)、管理员(独立后台)。

| 场景 | 触发 | 预期 | 要点 |
|---|---|---|---|
| 落地页→应用衔接 | 点登录 | 色/图标/质感无缝 | 无"两套产品"感 |
| 语义检索 | 输入关键词 | 图标+高亮+相关度+查询相关snippet | snippet 命中查询段落 |
| 笔记双链 | 编辑/看反链 | 编辑器内实时反链 | 边写边看,40字上下文 |
| PII 脱敏感知 | AI回复含敏感 | 中性灰星号+对比证据 | 看见脱敏发生过 |
| Command Palette | Ctrl+K | 与files搜索同保真 | 消除弱化双胞胎 |
| 公司端零痕迹 | 点下载 | 默认disabled灰+授权窗口 | 视觉先验禁用 |
| 语义索引故障 | Chroma不可用 | 回退关键词 | 回退也搜txt/md |
| 无结果查询 | 搜无结果 | 不返回负分垃圾 | 相关度阈值 |

## 2. AI 产品专项

| 维度 | 方案 |
|---|---|
| 模型/降级 | 复用 `llm_service.py` |
| Agent | `brain.py`/`tools.py` 不变;`/api/chat/stream` 改真流式 |
| RAG | 补相关度阈值(score<0.1丢)+ 查询相关snippet |
| 安全 | `guard/mask/sensitive_paths` 不变;修 admin 孤儿向量 |
| 评测 | PROMPTFOO 新增:snippet相关性、脱敏格式、双链解析 |
| 回流 | 埋点 search/unmask/click_through(见§10) |

真流式:`brain.py:132` 工具循环后改 `stream=True` 逐 token yield;前端已按 delta 累加。

## 3. 信息架构与数据模型

- ER/DB:**无 schema 变更**。
- 数据质量:`indexer.py:199 index_all` 补真实 content_hash(当前置空)。
- 三重隔离:完全继承,新组件用 file_id 代理真实路径。

## 4. 功能全景

### P0 设计系统统一(地基)

| 项 | 处理 | 集成点 |
|---|---|---|
| tokens.css 单一真源 | 新建,四端引用 | 新文件 + 四个 HTML |
| 品牌色收口 #3370FF | 六异名→统一 --primary | app.css:994/admin.css:21/auth.css:8,17,54/app.js:1256 |
| 语义色统一 Arco | success#00B42A/warning#FF7D00/danger#F53F3F | admin.css:33,app.css:1137 |
| 灰阶/边框/投影统一 | #1F2329系/#E5E6EB系/rgba(31,35,41) | app.css:989-993,admin.css:14-19,42-45 |
| 圆角 token 化 | --radius-sm/md/lg/pill | landing.css 30处字面量 |
| 图标统一线性 | icons.js 全 stroke1.5/currentColor;landing 21symbol合并 | utils/icons.js:4 |
| 删双落地页 | 废弃 renderLanding() | app.js:627/652/5249 |
| auth.css 版本号统一 | 同文件两端同 ?v= | index.html:18,admin/index.html:13 |
| app.js markdown导出去硬编码 | 改引用token | app.js:1248-1262 |
| wikilink/backlink 不存在token | 改真实token | app.css:1686,1693 |

### P1 UI 组件对齐

| 项 | 集成点 |
|---|---|
| 档案室持久侧栏 | app.js files视图 |
| 药丸文件chip + AI回答来源chip | 新CSS + app.js:3567 |
| metric 指标条 | 新CSS + files.py stats扩展 |
| PII before/after 对比面板 | 复用 landing .sx-compare |
| disabled 下载灰态 | app.js:2432 |
| wikilink 实线 | app.css:1684 |
| 相关度 0.92 格式 | app.js:2725 |
| PII revealed 中性灰 | app.css:1595 |

### P2 功能体验对齐

| 项 | 集成点 |
|---|---|
| 反链进笔记编辑器 | app.js:1044 + loadBacklinks |
| 独立笔记入口/视图 | app.js nav:5133 |
| Palette 搜索统一 | app.js:1727,1763 |
| 语义 snippet 查询相关 | indexer.py:175 |
| 反链上下文 40字 | files.py:923 |
| 真流式 chat | brain.py:132-170 |
| PII 脱敏格式统一(前3+星+后4) | mask.py:88-94 |
| 关键词回退扫 txt/md | files.py:1045 |

### P3 bug 修复

| Bug | 修复 |
|---|---|
| admin 全局回收站孤儿向量(admin.py:231 未import indexer) | 补 import |
| 语义检索无阈值 | score≥0.1 过滤 |
| grant_download 死代码(files.py:625) | 清理 |
| bank_card 被 id_card 先吞(mask.py 正则顺序) | 前置 |
| --teal 死token / --font-serif 残留 | 接入或删 |

## 5. 交互与体验

设计系统:#3370FF + Geist + 圆角6/8/10/12 + 分层投影(rgba(31,35,41)),全经 tokens.css。复古宋体/金印/朱印已否决,清残留。CSP:全用 data-action 委托,改 JS/CSS 必升 ?v=。a11y:信息性视觉补 role=figure+aria-label;响应式≤900降级。

## 6. 技术架构

- 后端:`GET /api/files/search`(snippet查询相关) · `GET /api/files/backlinks`(40字) · `GET /api/files/stats`(扩展metric) · `POST /api/chat/stream`(真流式) · `POST /api/admin/trash/purge`(修)
- core:indexer(阈值+snippet+hash) · mask(格式+正则序) · brain(真流式)
- 前端:tokens.css + icons归一化 + app.js(侧栏/chip/metric/disabled/反链/笔记入口/Palette/相关度) + 删renderLanding
- daemon:无影响

## 7. 安全与隐私

脱敏 mask.py(10类正则)安全无降级,仅展示格式统一;file_id 代理路径不变;guard 不变;审计增 search/unmask;三重隔离继承。越权回归:跨用户 file_id/wiki/backlinks。

## 8. 性能与可扩展

snippet 改造无额外IO;真流式首token提前;icons sprite<20KB;metric 聚合加缓存60s;侧栏分组虚拟滚动(>100)。

## 9. 可观测与运营

监控:搜索无结果率/snippet空率/chat首token延迟/mask触发/孤儿向量数(应0)。灰度:tokens.css 先admin 1天再用户端。回滚:退 ?v=。

## 10. 度量

| 类型 | 指标 | 埋点 |
|---|---|---|
| 北极星 | 落地页→应用7天回访 | 登录带 referrer=landing |
| 核心 | 搜索有效率(score≥0.1占比) | files.py search |
| 核心 | 笔记双链使用率 | 反链面板展开 |
| 核心 | 流式首token P95 | app.js:3746 |
| 护栏 | 孤立hex数 | CI grep |
| 护栏 | disabled下载误触率 | app.js 下载按钮 |

## 11. 风险

| 风险 | 对策 |
|---|---|
| 品牌色切换影响习惯用户 | app壳已是#3370FF,主要影响admin/auth,灰度 |
| icons归一化影响~140引用 | 脚本批量替换+视觉回归 |
| tokens.css上线错乱 | 先admin灰度+强制?v=bump |
| 删renderLanding破坏入口 | 改跳/welcome |
| snippet改造影响召回 | 旧逻辑feature flag可回退 |

## 12. 路线图

完整理想态:四端共用 tokens.css,统一#3370FF+Geist+线性图标+Arco语义色;应用具备落地页全组件;后端保真匹配;双落地页合并。

| 阶段 | 范围 | 验收 |
|---|---|---|
| P0 地基 | tokens+四端收口+图标+删双落地页+auth版本号 | 四端无孤立hex;同色;图标全线性 |
| P1 组件 | 侧栏/chip/metric/PII对比/disabled/wikilink实线/相关度 | 应用组件与落地页同源 |
| P2 功能 | 反链进编辑器/笔记入口/Palette/snippet/反链40字/真流式/PII格式/扫txt-md | 搜尾款得片段;边写边看反链;chat逐字 |
| P3 打磨 | bug+埋点+死token | 孤儿向量0;指标上报 |

每阶段闭环可用。

## 13. 查漏补缺

| 条目 | 处理 | 优先级 |
|---|---|---|
| app.js markdown导出硬编码#2B5FFF | 改token | P0 |
| --font-serif残留 | 删 | P3 |
| --teal死token | 接入青色点缀或删 | P1 |
| wikilink/backlink不存在token | 改真实token | P0 |
| Palette与files搜索双胞胎 | 统一renderSearchResults | P2 |
| 暗色模式 | 本轮不做 | 低 |
| Dashboard统计卡vs metric | 统一metric范式(可选) | P1 |
| token命名规范 | tokens.css顶部写约定 | P0 |
| 视觉回归CI | screenshot对比脚本 | P3 |

## 14. 开放问题(已决策)

- Q1 品牌色:**A #3370FF** ✓
- Q2 双落地页:**A 删除,统一静态 landing.html** ✓
- Q3 暗色:**B 不纳入** ✓
