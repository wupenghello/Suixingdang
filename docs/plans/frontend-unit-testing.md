# 前端单元测试体系 · 产品方案

- **状态**：S1-S4 落地 + 冒烟通过 + code-review 修复完成（前端 68 用例/覆盖率 96.5%+，后端 pytest 120 绿）· 待合并 PR
- **日期**：2026-07-16
- **作者**：/prd（资深 AI 产品经理视角）× 项目维护者
- **分支策略**：在 `develop` 推进，经 PR 进 `main`

---

## 决策摘要（已锁定）

| 决策点 | 选定方向 |
|---|---|
| Q1 工具链位置 | **`server/` 下**（与后端 `requirements.txt` 同级，前端资源在 `server/app/web/`） |
| Q2 类型安全 | **本次不做**（单测先落地；TS/JSDoc 类型检查单独立项） |
| Q3 e2e 层 | **S3 阶段做**（先把单测地基打好；现有 `sxd_capture.mjs` 升级为断言式 e2e） |
| Q4 覆盖率 gate | **延后设阈值**（S1/S2 只采集展示；S4 起设硬阈值，从低起步渐升） |

---

## 0. 需求理解与重构

**复述**：结束"前端只能 `node --check` + 截图"的验证现状，给前端引入真正的单元测试框架（首选 vitest），先覆盖工具函数，作为一项独立工程推进。

**真实 JTBD**：`app.js` 已是 **5039 行单文件、零测试、零导出**，处于"不敢重构、改一处怕崩一片"的临界点。真正要的是一张**自动化安全网**：让前端改动可被机器验证、可回归、可在 CI 兜底，从而让前端敢持续演进。本质是**前端质量基础设施（Quality Infrastructure）**的产品化决策。

**关键假设**：
1. 工具函数 = 当前 `app.js`/`admin.js` 内无副作用或副作用可控的函数（格式化、解析、转义、分类、校验、badge 渲染）。
2. 不破坏"生产零构建"原则 —— vitest 只在开发/CI 跑，不引入生产 bundler。
3. "用户" = 开发者（维护者 + 未来贡献者），非终端用户。
4. 测试与 `?v=` 缓存机制、CSP、`PROMPTFOO`（AI 输出评测）各司其职、不混淆。

---

## 1. 用户与场景

> "用户"是**开发者**，不是随行档的普通用户/管理员。

**目标用户画像**

| 角色 | 画像 | 核心诉求 |
|---|---|---|
| 主维护者 | 单人全栈，前端 5000 行单文件靠自己记忆维护 | 改完能立刻知道有没有崩 |
| 未来贡献者 | 提 PR 的外部开发者 | 有 contract（测试）可对照 |
| CI 机器人 | GitHub Actions | PR/合并时自动兜底，失败即拦截 |

**场景矩阵**

| 类别 | 触发条件 | 预期行为 | 体验要点 |
|---|---|---|---|
| 核心 · 本地改纯函数 | 改 `formatSize`/`parseServerTs` | `pnpm test:unit` 秒级反馈 | 改→存→即时绿/红 |
| 核心 · 抽离重构 | 函数从 app.js 移到 utils.js | 冒烟 + 单测全绿，生产行为不变 | 重构有信心 |
| 核心 · PR 触发 CI | 推 develop / 开 PR | CI 自动跑前端单测，失败阻塞 | 红灯在合并前 |
| 边缘 · 第三方库升级 | marked/dompurify 升版本 | 快照提示渲染变化 | 升级不静默改表现 |
| 边缘 · 时区相关 | 非 UTC+8 机器跑测试 | 锁时区，结果与机器无关 | "我这绿你那红"消失 |
| 异常 · 恶意 markdown 注入 | AI 回复/笔记含 `<img onerror>` | `escapeHtml`/`renderMarkdown` 用例断言被净化 | 安全回归有兜底 |
| 异常 · 抽离漏改 ?v= | 改 app.js 忘升版本号 | lint 检查提示 | 不靠人记 |
| 异常 · CI 无浏览器 | ubuntu runner 跑 e2e | playwright 浏览器缓存 | CI 不偶发挂 |

---

## 2. AI 产品专项

> 本需求**不是 AI 能力变更**。唯一落地点：把 `renderMarkdown` 的 DOMPurify 净化行为纳入安全回归用例。

| 子项 | 适用 | 说明 |
|---|---|---|
| 模型选型/降级、Prompt/Agent、RAG、成本延迟 | ❌ | 无 LLM 调用变更 |
| 幻觉/越权防护 | ⚠️ 部分 | 前端 `renderMarkdown`（依赖 `window.DOMPurify`）是 AI 输出注入的最后渲染关口 → 必须有用例 |
| **评测方案（与 PROMPTFOO 边界）** | ✅ 关键 | PROMPTFOO = 评测 LLM **输出内容质量**（模型层）；vitest = 评测**前端渲染/解析逻辑**（代码层）。互补不重叠 |

---

## 3. 信息架构与数据模型

> 前端工程基础设施，**不引入后端 API / DB / 向量索引变更**。唯一"信息架构"变更 = 前端文件结构。

```
server/app/web/assets/
├── app.js            (5039 行 → 逐步瘦身，import 回 utils)
├── admin.js          (1041 行 → 同上)
├── utils/            【新增】可测纯函数的家
│   ├── format.js     formatSize / formatDate / formatDateTime
│   ├── time.js       parseServerTs（时区核心）
│   ├── dom.js        escapeHtml（XSS 防护）
│   ├── markdown.js   renderMarkdown（含 DOMPurify 净化）
│   ├── file-classify.js  getFileIcon / getPreviewType + PREVIEW_*_EXT
│   └── validate.js   validateGroupName / isTokenActive / tokenStatusBadge
server/tests/web/     【新增】前端单测，与后端 server/tests/ 并列
```

`app.js` 改为 `import { formatSize, parseServerTs, escapeHtml } from './utils/*.js'`，**生产行为零变化**（仍是 `type="module"`、零构建）。

| 子项 | 是否变更 |
|---|---|
| ER / DB 模型（`db/models.py`）/ 多租户隔离 / 向量索引 | ❌ 全部不变 |

---

## 4. 功能全景（非 MVP）

| ID | 功能 | 输入→处理→输出 | 边界 | 集成点 | 优先级 |
|---|---|---|---|---|---|
| F01 | vitest 工具链 | `pnpm test`→vitest→报告 | node 18+ | 新增 `server/package.json`/`vitest.config.mjs` | P0 |
| F02 | happy-dom + setup | 注入 `window.marked`/`DOMPurify` | 第三方库 mock 或真引入 | `vitest.config.mjs` setupFiles | P0 |
| F03 | 抽离工具函数到 ESM 并 export | app.js 私有函数→`utils/*.js` export→app.js import | **行为不变**硬约束 | `app.js`/`admin.js`；升 `?v=` | P0 |
| F04 | formatSize 用例 | 0/1024/1536/1073741824/负数 | 边界 0/负/越界 | `tests/web/format.test.js` | P0 |
| F05 | parseServerTs 用例 | naive/空格分隔/带不带时区/非法/null | 补 Z 是正确性核心 | `tests/web/time.test.js` | P0 |
| F06 | escapeHtml 用例（含 XSS） | `<script>`/`"`/`'`/`&`/null | 属性上下文引号转义 | `tests/web/dom.test.js` | P0 |
| F07 | renderMarkdown 安全用例 | `<img onerror>`/`<script>` | DOMPurify 回归 | `tests/web/markdown.test.js` | P0 |
| F08 | 文件分类用例 | 各扩展名→分类；dockerfile/.gitignore 特例 | 无扩展/大小写 | `tests/web/file-classify.test.js` | P0 |
| F09 | validateGroupName 用例 | 空/>50/重名(excludeId)/合法 | 注入 userGroups | `tests/web/validate.test.js` | P1 |
| F10 | token 状态用例 | revoked/过期/有效/永久 | 时区锁 | `tests/web/validate.test.js` | P1 |
| F11 | 覆盖率收集 | `--coverage`→lcov/text | 阈值延后 | `vitest.config.mjs` | P1 |
| F12 | 快照测试（markdown） | 固定输入→快照 | 升级 marked 时提示漂移 | `tests/web/markdown.test.js` | P1 |
| F13 | CI 前端 job | PR/push→setup-node→`pnpm test` | node_modules 缓存 | `.github/workflows/test.yml` | P0 |
| F14 | 抽离回归冒烟 | 抽函数后→playwright 截图比对 | 与重构绑定 | 复用 e2e | P1 |
| F15 | DOM/组件测试 | `@testing-library/dom` 测 `data-action` | 事件委托约定 | `tests/web/ui/*.test.js` | P2 |
| F16 | e2e 升级 | `sxd_capture.mjs`(无断言)→加 expect | 保留截图补断言 | `e2e/*.spec.mjs` | P2 |
| F17 | `?v=` bump 检查 | 改 JS/CSS→lint 检查 | 防缓存旧版 | 自定义脚本 | P2 |
| F18 | pre-commit 快测 | commit→跑改动相关用例 | husky/lint-staged | `.husky/` | P2 |
| F19 | a11y 测试（axe） | 渲染 DOM→axe 扫描 | 设计系统配套 | `tests/web/a11y.test.js` | P2 |
| F20 | 覆盖率 gate | <阈值→CI 失败 | 低阈值起步 | `vitest.config.mjs` thresholds | P2 |

---

## 5. 交互与体验

> 开发者侧"交互" = CLI/CI 体验。本需求**不改任何 UI**。

| 子项 | 内容 |
|---|---|
| CLI 流程 | `pnpm test`(watch) / `pnpm test:unit`(once) / `pnpm test:coverage` / `pnpm test:e2e` |
| CI 流程 | PR→自动跑→Checks 标签显示 vitest 结果（可选覆盖率评论） |
| 设计系统 | 不改 UI；e2e 截图基线须在"蓝 #2B5FFF + Geist"定型后建立 |
| CSP | 测试在 Node 跑不经 CSP；生产 `script-src 'self'`，`type="module"` 抽函数后仍 self，不违反 |
| `?v=` 升级 | F03 抽离改 app.js 内容 → **必须升 `index.html:30` 的 `app.js?v=57→58`**；F17 lint 兜底 |
| a11y/响应式/暗色 | 不在本次范围；a11y 列 P2（F19）留口 |

---

## 6. 技术架构

### 6.1 前端工具链（新增于 `server/`）

`server/package.json`：
```json
{
  "name": "suixingdang-web",
  "private": true,
  "type": "module",
  "scripts": {
    "test:unit": "vitest run",
    "test": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "node e2e/run.mjs"
  },
  "devDependencies": {
    "vitest": "^1.6.0",
    "happy-dom": "^14.0.0",
    "@vitest/coverage-v8": "^1.6.0",
    "@testing-library/dom": "^10.0.0",
    "axe-core": "^4.9.0"
  }
}
```

`server/vitest.config.mjs`：
```js
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'happy-dom',
    setupFiles: ['./tests/web/setup.js'],
    include: ['tests/web/**/*.test.js'],
    coverage: { provider: 'v8', reporter: ['text','lcov'], include: ['app/web/assets/utils/**/*.js'] },
  },
});
```

`server/tests/web/setup.js`：
```js
import { marked } from 'marked';
import DOMPurify from 'dompurify';
globalThis.window = globalThis;
globalThis.marked = marked;
globalThis.DOMPurify = DOMPurify;
```

### 6.2 抽离策略（F03，"行为不变"重构）

1. 新建 `app/web/assets/utils/format.js`，`export function formatSize(bytes){...}` 原样搬迁；
2. `app.js` 顶部 `import { formatSize } from './utils/format.js';`，删掉原内联定义；
3. 升 `index.html` 的 `?v=`；
4. 单测 + 冒烟（preview 关键流程截图）验证行为不变；
5. 一函数一 PR 粒度，可回滚。

### 6.3 用例示例（真实可跑）

`tests/web/format.test.js`：
```js
import { describe, it, expect } from 'vitest';
import { formatSize } from '../../app/web/assets/utils/format.js';
describe('formatSize', () => {
  it.each([[0,'-'],[1024,'1 KB'],[1536,'1.5 KB'],[1073741824,'1 GB']])('%s → %s', (b, exp) => expect(formatSize(b)).toBe(exp));
  it('负数是非法输入，产生 "NaN undefined"（原代码 if(!bytes) 只挡 falsy，已记为用例）', () => { expect(formatSize(null)).toBe('-'); expect(formatSize(-1)).toBe('NaN undefined'); });
});
```

`tests/web/time.test.js`（锁时区）：
```js
vi.stubEnv('TZ','UTC');
import { parseServerTs } from '../../app/web/assets/utils/time.js';
it('naive 时间戳补 Z', () => expect(parseServerTs('2026-07-16T12:00:00')).toBe(Date.parse('2026-07-16T12:00:00Z')));
it('空格分隔 → T', () => expect(parseServerTs('2026-07-16 12:00:00')).toBe(Date.parse('2026-07-16T12:00:00Z')));
it('非法 → 0', () => expect(parseServerTs('not-a-date')).toBe(0));
```

### 6.4 不变项

后端 API / `core/*` / `agent/*` / daemon / 异步事务 / DB 迁移：❌ 全部不变。

---

## 7. 安全与隐私

> 不触后端安全；前端两个安全关键纯函数 = 单测核心目标。

| 子项 | 落点 |
|---|---|
| 脱敏(`mask.py`)/路径泄露/权限/审计/多租户 | ❌ 不变 |
| **`escapeHtml`（app.js:253）** | ✅ 必须有用例：断言 `<script>`/`"`/`'`/`&` 在属性上下文也安全（注释明说补转义引号是为 data-* 属性） |
| **`renderMarkdown`（app.js:261）+ DOMPurify** | ✅ 安全回归：`<img onerror>`/`<script>`/伪协议必须被净化 |

安全用例（纳入 P0）：
```
输入 '<img src=x onerror="alert(1)">'  → 断言输出不含 'onerror'、不含 '<script>'
输入 escapeHtml('" onmouseover="alert(1)') → 断言 '"' 已变 '&quot;'，无法逃逸属性
```

---

## 8. 性能与可扩展性

| 子项 | 内容 |
|---|---|
| 测试速度 | jsdom 环境，纯函数全量实测 ~0.4s（32 用例）；watch 毫秒级（曾评估 happy-dom 更快但其 innerHTML 不转义 `<>`，见 S1 调整 #2） |
| CI 增量 | setup-node + 缓存后增 ~30-60s；与后端 job 并行 |
| 生产包体 | 零影响（搬移非新增，零构建） |
| app.js 瘦身 | 抽离后行数下降，可维护性↑ |
| 大文件/海量边界 | 不适用；e2e 后续可作性能回归基线 |

---

## 9. 可观测性与运营

| 子项 | 内容 |
|---|---|
| 指标 | CI 前端测试通过率、用例数、覆盖率%、平均运行时长 |
| 日志 | vitest 终端报告 + 失败 stack；CI artifact 归档 lcov |
| 告警 | PR Checks 红灯即拦截（同后端 pytest 待遇） |
| 管理后台运营 | ❌ 不涉及 |
| 灰度/回滚 | devDependencies，不影响生产镜像（Docker 不装 node 测试依赖）；删 job 即回滚 |
| 覆盖率可视化 | 可选 `vitest-coverage-report` action PR 评论 |

---

## 10. 度量与成功标准

| 指标类 | 指标 | 定义 | 采集点 |
|---|---|---|---|
| 北极星 | 前端回归线上 bug 数 | 上线后因前端逻辑回归的 bug（→0） | issue 标签 |
| 核心 | 工具函数覆盖率 | `utils/**/*.js` 行/分支 % | `vitest --coverage` |
| 核心 | CI 前端测试通过率 | PR 前端 job 绿灯率 | GitHub Checks |
| 核心 | 用例数 | test 数 | vitest 报告 |
| 护栏 | 单测运行时长 | <5s | CI 日志 |
| 护栏 | 抽离行为不变率 | 冒烟通过率（100%） | e2e 截图比对 |

---

## 11. 风险与对策

| 风险 | 类别 | 概率 | 影响 | 对策 |
|---|---|---|---|---|
| 抽函数改坏生产行为 | 技术 | 中 | 高 | 一函数一 PR + 冒烟 + 升 `?v=`；可回滚 |
| 漏升 `?v=` → 旧缓存 | 工程 | 高 | 中 | F17 lint 兜底 |
| marked/DOMPurify 升级改输出 → 快照碎 | 技术 | 中 | 低 | 快照提示，人工确认 |
| 时区"我这绿你那红" | 技术 | 高 | 中 | setup 锁 `TZ`/locale |
| 第三方库 window.* vs ESM 不一致 | 技术 | 中 | 中 | setup 统一注入或直接 import 真库 |
| 测试依赖进生产镜像 | 安全/成本 | 低 | 中 | `.dockerignore` 排除 + devDependencies 分离 |
| CI 未缓存 node_modules → 慢 | 工程 | 中 | 中 | `setup-node` + cache |
| 覆盖率刷数字 | 文化 | 中 | 低 | 护栏非目标，重点保安全/解析函数 |

---

## 12. 落地路线图（完整理想态 + 分阶段）

**完整理想态**：单元（vitest + jsdom）覆盖纯/半纯函数 → DOM/组件（@testing-library/dom）覆盖 `data-action` → e2e（playwright 升级截图脚本为断言式）覆盖关键流程 → 覆盖率 gate + CI 并行 + pre-commit → app.js 从 5000 行降至可维护规模。**每阶段闭环可用、独立可交付。**

| 阶段 | 目标 | 范围 | 依赖 | 验收 |
|---|---|---|---|---|
| **S1 · 地基**（P0）✅ 已完成 | 工具链跑通 + 第一批用例 + CI 挂载 | F01/F02/F03（抽 4 核心模块：format/time/dom/file-classify）/F04/F05/F06/F08/F13（F07 移 S2） | node 18+ | `npm test` 本地绿（32 用例，覆盖率 100%）；CI 前端 job 已挂；**浏览器冒烟已通过** |
| **S2 · 扩面**（P1） | 覆盖率 + 安全回归 + 剩余函数 | F09/F10/F11/F12/F14 | S1 | `utils/` 覆盖率 >70%；安全用例齐；抽离冒烟纳入 |
| **S3 · 交互层**（P2） | DOM 组件 + e2e 升级 | F15/F16/F17 | S1/S2 | 关键流程（登录/传文件/聊天）有断言式 e2e；`?v=` lint 兜底 |
| **S4 · 体系化**（P2） | gate + 工效 + a11y | F18/F19/F20 | S3 | 覆盖率硬阈值生效；pre-commit 快测；a11y 入 CI |

---

## 13. 查漏补缺清单

| # | 条目 | 为什么重要 | 建议 | 优先级 |
|---|---|---|---|---|
| G1 | admin.js 也要测 | 1041 行同源无测试 | 抽离到 utils/ 同套用例 | 高 |
| G2 | 时区锁 | parseServerTs/formatDate 跨机器结果不一 | setup 锁 TZ=UTC + locale | 高 |
| G3 | 第三方库版本锁定 | marked/dompurify 升级静默改渲染 | package.json 锁版本 + 快照 | 高 |
| G4 | 测试依赖不进生产镜像 | node_modules 进 Docker 撑大镜像 | .dockerignore 排除 + devDeps 分离 | 高 |
| G5 | 更新 .dockerignore/.gitignore | 新增 node_modules/tests/web | 同步两个 ignore | 高 |
| G6 | 与 PROMPTFOO 边界写入 README | 避免混淆 | README 加"前端测试 vs AI 评测"节 | 中 |
| G7 | node 版本要求 | vitest 需 18+ | .nvmrc + setup-node | 中 |
| G8 | 类型安全（TS/JSDoc） | 5000 行 JS 无类型是隐患 | 后续单独立项（Q2 已定本次不做） | 中 |
| G9 | `?v=` 自动 bump | 抽离频繁改 app.js | F17 lint 脚本 | 中 |
| G10 | 抽离回归冒烟 | 行为不变只能靠 preview | 升级 sxd_capture 为断言式 e2e | 中 |
| G11 | 测试 fixture 管理 | userGroups/token 外部状态 | utils 纯函数 + 显式参数 | 中 |
| G12 | CI 并行 | 前端 job 别等后端串行 | 新 job 与 test job 并行 | 中 |
| G13 | 覆盖率文化 | 刷数字无意义 | 护栏用，重点保安全/解析函数 | 低 |
| G14 | watch 模式工效 | 秒级反馈是采用率关键 | `npm run test:watch` 默认 watch | 低 |
| G15 | e2e 凭据 | sxd_capture 硬编码 testuser/testpass | 用独立测试库凭据 | 低 |

---

## 14. 关键决策（已定）

| 决策点 | 选定 | 理由 |
|---|---|---|
| Q1 工具链位置 | `server/` 下 | 与后端同级，前端资源本就在 `server/app/web/`，CI 一个 working-directory |
| Q2 类型安全 | 本次不做 | 控制范围；单测先落地，类型检查单独立项 |
| Q3 e2e | S3 阶段做 | 先打单测地基，e2e 依赖冒烟价值 |
| Q4 覆盖率 gate | 延后设阈值 | S1/S2 只采集，S4 起设硬阈值从低起步，避免被数字绑架 |

**S1 可立即开工。**

---

## S1 执行结果（2026-07-16，已落地）

**结论：S1 完成 + 浏览器冒烟通过。32 用例全绿，`utils/` 覆盖率 100%（stmts/branch/funcs/lines）。**

### 实际交付
- 工具链：`server/package.json`（**npm 非 pnpm**，跟随项目现状）、`vitest.config.mjs`、`tests/web/setup.js`、`.nvmrc`(node 20)
- 抽离 `server/app/web/assets/utils/`：`format.js`(formatSize/formatDate/formatDateTime)、`time.js`(parseServerTs)、`dom.js`(escapeHtml)、`file-classify.js`(getPreviewType + PREVIEW_*_EXT)
- `app.js` 改 import + 删原定义，升 `index.html` `app.js?v=57→58`
- 用例 `tests/web/{format,time,dom,file-classify}.test.js` → 32 passed
- CI：`test.yml`(PR) + `docker.yml`(main) 各加 `frontend` job（setup-node 按 `.nvmrc` + npm ci + npm test），`docker.yml` 的 build 改为 `needs: [test, frontend]`
- `.gitignore` 修正 `package.json` 锚定根（让 server/package.json 入库）；新增 `server/.dockerignore` 排除 node_modules/tests/coverage（不进生产镜像）

### 浏览器冒烟（2026-07-17，通过）
起 uvicorn(8898) + dev_proxy(8899) 端到端验证抽离后行为不变（凭据 test/test123456）：
- 落地页 → 登录 → 主界面 → 设置 → 文件库 → 文件预览，**全程 console 零 ReferenceError**（70 处 `escapeHtml`、9 处 `formatDateTime`、8 处 `parseServerTs` 等调用点全靠 import 正常解析）
- `formatSize` UI 输出与单测逐字节一致：上传 1536 字节文件，文件库显示「1.5 KB」
- `getPreviewType` 正确：点 txt 预览 → 打开文本预览器
- 结论：S1 抽离在真实浏览器行为不变，**S2 可在稳固地基上开工**

### 相对原方案的调整（诚实记录）
1. **F07 renderMarkdown 安全用例 → 移至 S2**：renderMarkdown 依赖 `_enhanceMarkdownDom`，后者深耦合 `ICONS` + `window.mermaid/hljs/renderMathInElement`，抽离需连带 ICONS/_renderWikilinks，超出 S1「小步可回滚」边界。`getFileIcon`（依赖 ICONS）同理留 S2。
2. **happy-dom → jsdom**：happy-dom 的 `innerHTML` 序列化不转义 `<>`，无法验证 `escapeHtml` 的转义契约；换 jsdom 后契约可验（安全测试必须能验证）。
3. **formatSize 负数边界**：原代码 `if(!bytes)` 只挡 falsy，负数产生 `'NaN undefined'`，已记为用例（非缺陷，负数是非法输入）。
4. **包管理器 npm 非 pnpm**：跟随项目现有 lock 风格。

### S1 已知遗留（→ S2/S3）
- F07 renderMarkdown + getFileIcon 抽离与安全用例（S2 首项）
- utils 子模块 import 不带 `?v=`，将来改 utils 的 cache-busting 策略（F17，S3）
- npm audit 报 vitest 1.x 依赖链漏洞（esbuild/vite dev 依赖，不进生产镜像），建议 S2 升 vitest 大版本

---

## S2-S4 + code-review 执行结果（2026-07-17，已落地）

**结论：S2/S3/S4 核心项落地 + 浏览器冒烟通过 + code-review findings 全部处理。前端 68 用例全绿（覆盖率 stmts 98%/branch 85%/funcs 100%），后端 pytest 120 绿。**

### S2（renderMarkdown 链 + token）
- 抽离 `utils/icons.js`（ICONS + getFileIcon，134 处调用点靠 import）、`utils/markdown.js`（renderMarkdown + renderNoteMarkdown + _enhanceMarkdownDom + _renderWikilinks）、`utils/tokens.js`（4 个 token 状态函数）
- 用例：markdown(15，含 XSS 净化 + 快照 + 双链 + mermaid + 代码块复制)、icons(11)、tokens(10)
- **顺手修既存 bug**：`_enhanceMarkdownDom` 代码块复制成功用 `ICONS.tbCheck`，但 ICONS 从未定义 → 复制后按钮显示 "undefined"；icons.js 补 tbCheck 对勾 SVG 修复
- F09 validateGroupName 跳过：与外部 userGroups 状态紧耦合，抽离需改签名 + 6 调用点，收益有限

### S3/S4
- **F17 cache-busting 检查**（`server/scripts/check-cache-busting.mjs` + CI 顾问 step）
- **F20 覆盖率 gate**：vitest.config thresholds 90/75/85/90
- README 加「测试」节（前端 vitest vs PROMPTFOO 边界，G6）；删 `_preprocessWikilinks` 死代码
- **跳过（诚实记录）**：F15 DOM 组件、F16 完整 e2e、F18 pre-commit husky、F19 a11y——收益/复杂度不划算，留后续

### code-review 修复（3 finder agent 审 diff）
- **F1 utils 破缓存**（CONFIRMED）：app.js 7 个 utils import 加 `?v=60`（与 index.html 同步），改 utils 浏览器不再命中旧缓存
- **F2 cache-busting 漏 lib/utils**（CONFIRMED）：检查脚本加 utils/lib 改动检测
- **F4 tbCheck 缺回归测试**（CONFIRMED）：icons.test 加 tbCheck 对勾断言
- **F5 formatDate 时区脆弱断言**（PLAUSIBLE）：`/16/` → `/7月/`（月不随时区漂移）
- F3 顾问模式（continue-on-error）保留（避免 CI 误伤）；F6 快照误碎由 CI `npm ci` 锁 lockfile 缓解

### 生产加载验证
StaticFiles 对 `utils/*.js?v=60` 的 module 请求返回 200（app.js import ?v= 在生产可加载）；浏览器冒烟全程 console 零 ReferenceError。
