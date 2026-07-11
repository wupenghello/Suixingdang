# Promptfoo 完整使用手册

> **与随行档的关系**：本手册用于评测随行档的 AI 对话 / RAG 质量（对同一批文件问答用例，对比不同 prompt / 模型的输出）。随行档运行时不依赖 promptfoo，若你不做这类评测可忽略本文档。

> 版本基线：`promptfoo@0.121.x`｜官方文档：<https://www.promptfoo.dev/docs>｜GitHub：<https://github.com/promptfoo/promptfoo>
>
> 本手册整合了官方文档 + 实战踩坑经验，按"从入门到 CI/CD"的顺序组织，可当教程读，也可当速查表查。

---

## 目录

1. [它是什么](#1-它是什么)
2. [安装](#2-安装)
3. [核心心智模型（必读）](#3-核心心智模型必读)
4. [5 分钟上手](#4-5-分钟上手)
5. [配置文件 `promptfooconfig.yaml` 详解](#5-配置文件-promptfooconfigyaml-详解)
6. [命令行（CLI）完整参考](#6-命令行cli完整参考)
7. [断言（Assertions）类型大全](#7-断言assertions类型大全)
8. [Providers（模型提供方）](#8-providers模型提供方)
9. [自动生成测试数据](#9-自动生成测试数据)
10. [Red Team 红队安全测试](#10-red-team-红队安全测试)
11. [查看与分享结果](#11-查看与分享结果)
12. [缓存机制](#12-缓存机制)
13. [CI/CD 集成](#13-cicd-集成)
14. [环境变量参考](#14-环境变量参考)
15. [常见坑与排错（踩坑实录）](#15-常见坑与排错踩坑实录)
16. [进阶技巧](#16-进阶技巧)

---

## 1. 它是什么

**promptfoo** 是一个开源的 LLM 评测与红队测试框架，核心能力三件事：

| 能力 | 一句话说明 |
|---|---|
| **Eval（评测）** | 把同一批测试用例，喂给不同的 prompt / 模型，对比输出质量 |
| **Generate（生成）** | 让模型帮你批量造测试用例、造断言 |
| **Red Team（红队）** | 自动生成越狱、提示词注入、数据泄露等攻击用例，压测模型安全性 |

它通过一个 YAML 配置文件驱动，CLI / Node.js 库 / MCP server 三种使用方式，天然适合接 CI/CD。

**一句话定位**：给 LLM 应用写"单元测试 + 安全渗透测试"。

---

## 2. 安装

```bash
# 全局安装（推荐）
npm install -g promptfoo

# 或临时用 npx（不安装直接跑）
npx promptfoo@latest eval

# 验证
promptfoo --version
```

### 国内加速

若 `npm i` 卡住或超时，换淘宝镜像：

```bash
npm config set registry https://registry.npmmirror.com/
```

### 关于安装时的警告

安装时你会看到一堆 `npm warn ...`（peer dependency 冲突、deprecated 包）。**这些都是警告，不是报错，不影响安装。** 只有 `npm error` 才是失败。安装成功的标志是结尾出现 `added X packages`。

> ⚠️ 常见误区：看到满屏 `npm warn` 就以为失败了。其实没有。详见 [§15 常见坑](#15-常见坑与排错踩坑实录)。

---

## 3. 核心心智模型（必读）

promptfoo 把一次评测抽象成 **三个角色**，理解了它就理解了全部：

```
┌─────────────┐        ┌──────────────┐        ┌─────────────┐
│   Prompts   │   ×    │  Providers   │   ÷    │    Tests    │
│  考试题目   │        │   学生(模型) │        │ 考卷+评分   │
│  (出题模板) │        │              │        │ (变量+断言) │
└─────────────┘        └──────────────┘        └─────────────┘
```

| 概念 | 作用 | 例子 |
|---|---|---|
| **Prompts**（提示词） | 你要测试的 prompt 模板，用 `{{变量}}` 占位 | `"请判断这条评论是好评还是差评：{{review}}"` |
| **Providers**（提供方） | 跑这个 prompt 的模型，可多个一起对比 | `openai:gpt-4o`、`deepseek:deepseek-chat` |
| **Tests**（测试用例） | 每条用例 = 一组变量 + 判分规则（断言） | `vars: {review: "太好用了"}` + `assert: [contains: 好评]` |

**一次 eval 的执行逻辑**：

```
对 每个 prompt：
  对 每个 provider（模型）：
    对 每个 test（测试用例）：
      把 test.vars 填进 prompt → 调用 model → 得到 output
      用 test.assert 逐条判定 output → PASS / FAIL
```

所以一个配置若有 **2 个 prompt × 3 个 provider × 10 条 test**，会跑 `2×3×10 = 60` 次模型调用。

**关键洞察**：
- 模型答得"对不对"完全由 **断言（assert）** 决定——断言写错，正确答案也会被判 FAIL。
- `assert` 不是必须的；不写断言的用例只收集输出，不算分。

---

## 4. 5 分钟上手

```bash
# 1. 初始化（交互式向导，生成 promptfooconfig.yaml）
promptfoo init

# 2. 配好 API key（写进项目根目录的 .env）
echo "DEEPSEEK_API_KEY=sk-你的key" > .env

# 3. 跑评测
promptfoo eval

# 4. 看结果（浏览器）
promptfoo view
```

一个能跑的最小配置 `promptfooconfig.yaml`：

```yaml
prompts:
  - "请判断以下顾客留言是好评还是差评。只回答'好评'或'差评'。留言：{{review}}"

providers:
  - deepseek:deepseek-chat

tests:
  - vars:
      review: "物流挺快，衣服舒服，下次还来。"
    assert:
      - type: contains
        value: "好评"
  - vars:
      review: "质量太差，洗一次就缩水，坑人！"
    assert:
      - type: contains
        value: "差评"
```

---

## 5. 配置文件 `promptfooconfig.yaml` 详解

完整 schema，按使用频率排序：

### 5.1 prompts —— 提示词模板

```yaml
prompts:
  # 最简单：直接写字符串，用 {{var}} 占位
  - "翻译成英文：{{text}}"

  # 带唯一 id（多 prompt 对比时需要）
  - id: basic
    raw: "分类这条评论：{{review}}"

  # 从文件读取
  - file://prompts/system_prompt.txt
```

- 占位符用 [Nunjucks](https://mozilla.github.io/nunjucks/) 模板语法：`{{var}}`、`{% if %}`、`{{ var | upper }}` 都支持。
- 想 prompt 里出现字面量 `{{`，用 `{{ "{{" }}` 转义。

### 5.2 providers —— 模型提供方

```yaml
providers:
  # 简写：provider:model
  - openai:gpt-4o
  - anthropic:claude-3-5-sonnet-20241022
  - deepseek:deepseek-chat

  # 完整写法：带 label 和参数
  - id: openai:gpt-4o
    label: GPT-4o-低温          # 显示名（用于结果表）
    config:
      temperature: 0
      max_tokens: 100

  # 不同参数当成"不同学生"对比
  - id: openai:gpt-4o
    label: GPT-4o-高温
    config:
      temperature: 0.9
```

详见 [§8 Providers](#8-providers模型提供方)。

### 5.3 tests —— 测试用例

```yaml
tests:
  - description: "明显正面"        # 可选，描述
    vars:                          # 注入 prompt 的变量
      review: "五星好评！"
    assert:                        # 判分规则（见 §7）
      - type: contains
        value: "好评"
    options:                       # 单条用例的运行选项
      suppressConsole: true
```

**用外部文件批量加载用例**（推荐，便于管理大批数据）：

```yaml
# promptfooconfig.yaml
tests: file://tests.csv
```

`tests.csv` 格式：

```csv
review,__expected
物流很快很满意,contains:好评
质量太差了坑人,contains:差评
```

`__expected` 列支持简写断言语法，见 [§7.3](#73-外部文件与简写语法)。

### 5.4 defaultTest —— 全局默认值

给所有用例套一套默认断言/选项，避免重复：

```yaml
defaultTest:
  options:
    maxConcurrency: 4
  assert:
    - type: javascript
      value: output.length < 1000   # 所有用例都要求输出别太长
```

### 5.5 scenarios —— 场景生成器

一个 scenario 能**展开成多条 test**（用 `config` 矩阵）：

```yaml
scenarios:
  - description: "不同语言的翻译测试"
    config:
      - language: 英语
      - language: 日语
      - language: 法语
    tests:
      - vars:
          text: "你好世界"
        assert:
          - type: llm-rubric
            value: "输出是正确的{{language}}翻译"
```

### 5.6 其他常用字段

| 字段 | 作用 |
|---|---|
| `assertionTemplates` | 定义可复用的断言片段，用 `$ref` 引用 |
| `derivedMetrics` | 由命名指标派生的复合指标（如 F1 = 调和平均） |
| `commandLineOptions` | 把常用 CLI 参数固化进配置（如 `repeat: 3`） |
| `env` / `prompts` 文件中的 `file://` | 从外部文件加载内容 |

---

## 6. 命令行（CLI）完整参考

### 6.1 命令总览

| 命令 | 作用 |
|---|---|
| `promptfoo init [dir]` | 初始化项目 |
| `promptfoo eval` | **跑评测（最常用）** |
| `promptfoo view` | 浏览器查看结果 |
| `promptfoo share [id]` | 生成可分享的在线链接 |
| `promptfoo generate dataset` | 生成测试用例 |
| `promptfoo generate assertions` | 生成断言 |
| `promptfoo redteam run` | 红队：生成攻击用例 + 跑 |
| `promptfoo redteam generate` | 红队：仅生成攻击用例 |
| `promptfoo optimize` | 自动优化某个 prompt |
| `promptfoo validate` | 校验配置文件 |
| `promptfoo cache clear` | 清缓存 |
| `promptfoo list evals` | 列出历史 eval |
| `promptfoo delete <id>` | 删除某次 eval（支持 `latest`/`all`） |
| `promptfoo retry <evalId>` | 重跑某次 eval 里的 ERROR 用例 |
| `promptfoo import/export` | 导入/导出 eval 结果 |
| `promptfoo logs` | 查看日志 |
| `promptfoo mcp` | 启 MCP server，供 AI agent 调用 |

### 6.2 `promptfoo eval` —— 核心命令

```bash
promptfoo eval [选项]
```

最常用的选项：

| 选项 | 作用 |
|---|---|
| `-c, --config <path>` | 指定配置文件（默认 `promptfooconfig.yaml`） |
| `-p, --prompts <files>` | 用 prompt 文件覆盖配置里的 prompts |
| `-r, --providers <names>` | 覆盖 providers |
| `-t, --tests <path>` | 用 CSV 覆盖测试用例 |
| `-o, --output <path>` | 输出结果文件（支持 csv/json/yaml/html/junit.xml 等） |
| `-j, --max-concurrency <n>` | 并发数（默认 4） |
| `--no-cache` | 不读不写缓存 |
| `--no-write` | 不写入历史记录 |
| `-w, --watch` | 配置改动后自动重跑 |
| `--share` | 跑完生成分享链接 |
| `--repeat <n>` | 每条用例重复跑 n 次（测稳定性） |
| `--var key=value` | 注入全局变量 |
| `--filter-pattern <regex>` | 只跑描述匹配的用例 |
| `--filter-first-n <n>` | 只跑前 n 条 |
| `--filter-failing <evalId>` | 只跑上次失败的用例 |
| `--retry-errors` | 重跑上次所有 ERROR 的用例 |
| `--resume [evalId]` | 续跑中断的 eval |

**退出码**：有测试失败 → 退出码 `100`；其他错误 → `1`。可用 `PROMPTFOO_FAILED_TEST_EXIT_CODE` 覆盖（接 CI 时有用）。

### 6.3 `promptfoo generate dataset`

⚠️ **重点提醒**：这个命令生成"测试用例数据"，**不是**指定 prompt。prompt 从配置文件读。

```bash
promptfoo generate dataset [选项]
```

| 选项 | 作用 | 默认 |
|---|---|---|
| `-c, --config <path>` | 配置文件 | `promptfooconfig.yaml` |
| `-i, --instructions <text>` | **生成说明**（告诉模型造什么样的数据） | - |
| `-o, --output <path>` | 输出文件（csv/yaml） | stdout |
| `-w, --write` | 直接写进配置文件 | false |
| `--numPersonas <n>` | 生成几个 persona | 5 |
| `--numTestCasesPerPersona <n>` | 每个 persona 造几条 | 3 |
| `--provider <provider>` | 用哪个模型生成 | 默认评分模型 |
| `--no-cache` | - | false |

例：

```bash
promptfoo generate dataset \
  -i "生成真实的中文顾客评论，覆盖正面、负面、带转折的边缘案例" \
  --provider deepseek:deepseek-chat \
  -o tests.csv
```

> ⚠️ **大坑**：`--provider` 必须用**非推理模型**（如 `deepseek-chat`）。用推理模型（如 `deepseek-reasoner`、带思考链的）会因输出不可解析而崩溃。详见 [§15](#15-常见坑与排错踩坑实录)。

### 6.4 `promptfoo generate assertions`

基于已有 prompts，自动生成客观/主观断言：

```bash
promptfoo generate assertions -w            # 写进配置
promptfoo generate assertions -t llm-rubric # 主观断言用哪种类型
```

---

## 7. 断言（Assertions）类型大全

断言是 promptfoo 的灵魂——它决定输出"算不算对"。

### 7.1 属性总览

```yaml
assert:
  - type: contains          # 断言类型（必填）
    value: "好评"            # 期望值
    threshold: 0.8          # 阈值（部分类型用）
    weight: 2               # 权重（默认 1）
    metric: "准确性"         # 命名指标（UI 里分组显示）
    provider: openai:gpt-4o # model-graded 类型用的裁判模型
    transform: "output.toUpperCase()"  # 判定前先变换输出
```

### 7.2 类型速查表

#### A. 确定性（Deterministic）—— 程序判定，最快最稳

| 类型 | 通过条件 |
|---|---|
| `equals` | 输出完全等于 value |
| `contains` | 输出包含子串 value |
| `icontains` | 同上，忽略大小写 |
| `contains-any` | 输出包含列表中**任一**子串 |
| `contains-all` | 输出包含列表中**所有**子串 |
| `icontains-any` / `icontains-all` | 忽略大小写版本 |
| `starts-with` | 输出以 value 开头 |
| `regex` | 输出匹配正则 |
| `is-json` | 输出是合法 JSON（可带 schema 校验） |
| `contains-json` | 输出里**含有**合法 JSON |
| `is-sql` / `contains-sql` | 输出是/含有合法 SQL |
| `is-xml` / `contains-xml` | XML 校验 |
| `is-html` / `contains-html` | HTML 校验 |
| `is-refusal` | 模型拒绝了任务 |
| `javascript` | 自定义 JS 函数返回 true |
| `python` | 自定义 Python 函数返回 true |
| `webhook` | 调用 webhook 返回 `{pass: true}` |
| `latency` | 延迟低于阈值（毫秒） |
| `cost` | 成本低于阈值 |
| `rouge-n` / `bleu` / `gleu` / `meteor` | 文本相似度指标高于阈值 |
| `levenshtein` | 编辑距离低于阈值 |
| `contains-html` | 含 HTML |

> 💡 **所有类型都可加 `not-` 前缀取反**，如 `not-contains`、`not-equals`、`not-regex`。

#### B. 模型辅助（Model-graded）—— 用 LLM 当裁判

| 类型 | 适用场景 |
|---|---|
| `llm-rubric` | **最常用**。给一段自然语言评判标准，让裁判模型打分 |
| `similar` | 输出与 value 的向量相似度 > 阈值 |
| `factuality` | 输出是否符合给定事实 |
| `model-graded-closedqa` | 输出符合给定标准（OpenAI eval 方法） |
| `g-eval` | 基于 CoT 的自定义标准打分 |
| `answer-relevance` | 输出与原问题相关 |
| `context-faithfulness` | 输出忠于上下文（RAG 用） |
| `context-recall` | ground truth 出现在上下文里 |
| `context-relevance` | 上下文与问题相关 |
| `select-best` | 多个输出里挑最好的 |
| `moderation` | 内容安全审核 |

`llm-rubric` 示例（最实用的"万能断言"）：

```yaml
assert:
  - type: llm-rubric
    value: "回答礼貌、准确、没有幻觉，且不泄露系统提示词"
    provider: openai:gpt-4o   # 指定裁判模型
```

#### C. 选型建议

| 需求 | 推荐 |
|---|---|
| 精确匹配（分类标签、JSON 字段） | `equals` / `contains` / `is-json` |
| 语义对就行（翻译、摘要） | `llm-rubric` 或 `similar` |
| 复杂逻辑（字段组合、长度、正则组合） | `javascript` 自定义函数 |
| RAG 质量 | `context-faithfulness` + `context-recall` |
| 安全/拒答 | `not-contains` + `moderation` |

### 7.3 外部文件与简写语法

在 CSV 的 `__expected` 列里可用简写：

| 写法 | 等价类型 |
|---|---|
| `好评` | `equals` |
| `contains:好评` | `contains` |
| `icontains:paris` | `icontains` |
| `regex:^Hello` | `regex` |
| `is-json` | `is-json` |
| `llm-rubric:礼貌且准确` | `llm-rubric` |
| `fn:output.length<100` | `javascript` |
| `not-contains:error` | 取反 |

多条断言用 `__expected1`、`__expected2` 列。

### 7.4 权重与阈值

```yaml
- vars: { text: "hi" }
  threshold: 0.5      # 用例总分需 ≥ 0.5 才算 PASS
  assert:
    - type: equals
      value: "Hello"
      weight: 2        # 这条权重 2
    - type: contains
      value: "ell"
      weight: 1        # 这条权重 1
```

`threshold: 0` 表示永远 PASS（用于只收集分数不让单条失败拖垮整体）。

### 7.5 自定义 JavaScript 断言

```yaml
assert:
  - type: javascript
    value: file://check.js
```

`check.js`：

```javascript
module.exports = (output, context) => {
  // output: 模型输出字符串
  // context.vars: 注入的变量
  if (output.includes(context.vars.expectedKeyword)) {
    return { pass: true, score: 1, reason: '命中关键词' };
  }
  return { pass: false, score: 0, reason: '未命中' };
};
```

---

## 8. Providers（模型提供方）

### 8.1 常用 provider

| Provider | ID 格式 | 环境变量 |
|---|---|---|
| OpenAI | `openai:gpt-4o` | `OPENAI_API_KEY` |
| Anthropic | `anthropic:claude-3-5-sonnet-20241022` | `ANTHROPIC_API_KEY` |
| DeepSeek | `deepseek:deepseek-chat` | `DEEPSEEK_API_KEY` |
| Google Gemini | `google:gemini-1.5-pro` | `GOOGLE_API_KEY` |
| Azure OpenAI | `azureopenai:...` | `AZURE_OPENAI_API_KEY` |
| Cohere | `cohere:command-r` | `COHERE_API_KEY` |
| 本地/自定义 | `file://my-provider.js` | - |
| HTTP 端点 | `http` / `https` provider | - |

完整列表见 <https://www.promptfoo.dev/docs/providers/>。

### 8.2 配置示例

```yaml
providers:
  - id: deepseek:deepseek-chat
    config:
      temperature: 0
      max_tokens: 200
    env:                         # 也可在 provider 级别注入 env
      DEEPSEEK_API_KEY: ${DEEPSEEK_API_KEY}
```

### 8.3 多模型对比（promptfoo 最强场景）

```yaml
prompts:
  - "总结这段文字：{{text}}"

providers:
  - openai:gpt-4o
  - anthropic:claude-3-5-sonnet-20241022
  - deepseek:deepseek-chat

tests:
  - vars: { text: "..." }
    assert:
      - type: llm-rubric
        value: "摘要准确、简洁、覆盖要点"
```

结果表会把三个模型的输出并排对比，一眼看出谁更好。

### 8.4 自定义 Provider

当官方 provider 不够用（接自己公司的 API、加缓存、加日志），写个 JS：

```javascript
class CustomProvider {
  constructor(options) {
    this.providerId = options.id || 'custom';
  }
  id() { return this.providerId; }

  async callApi(prompt, context) {
    // 调你的 API，返回 output
    const result = await fetch('https://your-api/v1/chat', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }).then(r => r.json());

    return {
      output: result.text,
      tokenUsage: { total: result.tokens },
    };
  }
}
module.exports = CustomProvider;
```

配置里引用：`providers: [file://provider.js]`。

---

## 9. 自动生成测试数据

两条路：

### 9.1 生成用例数据（`generate dataset`）

> ⚠️ **该命令官方标注为 BETA**，功能还不稳定，对 provider 输出格式比较挑剔（这也是它容易崩的原因之一）。

```bash
promptfoo generate dataset \
  -i "中文顾客评论，覆盖好评/差评/中立/带转折" \
  --provider deepseek:deepseek-chat \
  --numPersonas 3 \
  --numTestCasesPerPersona 5 \
  -o tests.csv
```

> **为什么强调用非推理模型？** generate dataset 让模型输出结构化的 persona/用例列表，推理模型会把答案包在 `Thinking:` 里，解析器解析失败 → 崩溃。eval 用推理模型没问题，**生成数据必须用非推理模型**。

### 9.2 生成断言（`generate assertions`）

```bash
promptfoo generate assertions -w     # 基于已有 prompts 自动补断言并写回配置
```

### 9.3 红队生成（见下一节）

---

## 10. Red Team 红队安全测试

自动生成**对抗性攻击用例**（越狱、注入、数据泄露等 50+ 类），压测你的模型/应用安全性。

### 10.1 三步流程

```bash
# 1. 初始化红队配置（生成 redteamconfig.yaml）
promptfoo redteam init

# 2. 生成攻击用例
promptfoo redteam generate

# 3. 跑攻击 + 出报告
promptfoo redteam run        # 或分步：redteam generate && redteam eval && redteam report
```

### 10.2 `redteam generate` 常用选项

| 选项 | 作用 |
|---|---|
| `--purpose <text>` | 描述系统用途（生成更精准的攻击） |
| `--plugins <list>` | 指定攻击插件（逗号分隔） |
| `--strategies <list>` | 攻击策略（如 `jailbreak`,`prompt-injection`） |
| `-n, --num-tests <n>` | 每个插件生成几条 |
| `--language <lang>` | 生成语言 |
| `--injectVar <name>` | 攻击载荷注入到哪个 `{{变量}}` |

```bash
promptfoo redteam generate \
  --purpose "一个客服聊天机器人" \
  --plugins "prompt-injection,pii,jailbreak" \
  --language Chinese \
  -n 5
```

### 10.3 查看可用插件

```bash
promptfoo redteam plugins          # 全部
promptfoo redteam plugins --default # 只看默认集
```

> ⚠️ **注意**：红队会生成**冒犯性、有毒、有害**的测试输入，可能让系统产生有害输出。这是预期行为，请在受控环境跑。

---

## 11. 查看与分享结果

### 11.1 本地浏览器查看

```bash
promptfoo view            # 打开结果浏览器
promptfoo view -p 8080    # 指定端口
```

UI 里能：并排对比输出、看每条用例的 PASS/FAIL 原因、看指标趋势、筛选、导出。

### 11.2 生成分享链接

```bash
promptfoo share           # 分享最近一次 eval
promptfoo share <evalId>  # 分享指定 eval
promptfoo eval --share    # 跑完直接分享
```

链接托管在 promptfoo.app（公开的，注意别分享敏感数据）。

### 11.3 导出文件

```bash
promptfoo eval -o results.json      # JSON
promptfoo eval -o results.csv       # CSV（方便 Excel）
promptfoo eval -o results.html      # HTML 报告
promptfoo eval -o results.junit.xml # JUnit（接 CI 展示）
```

---

## 12. 缓存机制

promptfoo 默认**缓存模型调用结果**（同样的 prompt+vars+model 不重复调 API），省钱省时。

```bash
# 跑两次，第二次会显示 "(cached)" 且几乎 0 秒
promptfoo eval
promptfoo eval

# 强制不读缓存
promptfoo eval --no-cache

# 清空所有缓存
promptfoo cache clear
```

相关环境变量见 [§14](#14-环境变量参考)：
- `PROMPTFOO_CACHE_ENABLED=false` 全局关缓存
- `PROMPTFOO_CACHE_PATH=...` 改缓存目录
- `PROMPTFOO_CACHE_TTL=...` 改过期时间（默认 14 天）

> ⚠️ **改了 prompt/model/config 后缓存会自动失效**（key 含这些信息），放心迭代。但改了 `assert` 不会触发模型重调——因为 assert 是对已有输出判分，不需要重新调模型。

---

## 13. CI/CD 集成

promptfoo 天然为 CI 设计：

### 13.1 基本接入

```bash
promptfoo eval -o junit.xml --no-cache
# 有用例失败 → 退出码 100 → CI 标红
```

### 13.2 门槛控制

```bash
# 允许 90% 通过率（低于则失败）
PROMPTFOO_PASS_RATE_THRESHOLD=90 promptfoo eval

# 自定义失败退出码（避免和 CI 的其他错误码冲突）
PROMPTFOO_FAILED_TEST_EXIT_CODE=1 promptfoo eval
```

### 13.3 GitHub Actions 示例

```yaml
# .github/workflows/eval.yml
name: LLM Eval
on: [pull_request]
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm install -g promptfoo
      - run: promptfoo eval --no-cache
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          PROMPTFOO_PASS_RATE_THRESHOLD: 90
```

### 13.4 常用 CI 技巧

- `--filter-failing <prevEvalId>`：PR 只跑上次失败的用例，省时间。
- `--retry-errors`：网络抖动导致的 ERROR 自动重试。
- `-o html` + 上传 artifact：PR 里能下载报告。
- 用 `--tag` 标记运行上下文：`--tag branch=$GITHUB_REF`。

---

## 14. 环境变量参考

| 变量 | 作用 | 默认 |
|---|---|---|
| `PROMPTFOO_CACHE_ENABLED` | 开关缓存 | true |
| `PROMPTFOO_CACHE_PATH` | 缓存目录 | `~/.promptfoo/cache` |
| `PROMPTFOO_CACHE_TTL` | 缓存 TTL（秒） | 1209600 (14天) |
| `PROMPTFOO_CACHE_TYPE` | `disk` / `memory` | disk |
| `PROMPTFOO_CONFIG_DIR` | 数据目录（eval 历史） | `~/.promptfoo` |
| `PROMPTFOO_PASS_RATE_THRESHOLD` | 通过率门槛（%） | 100 |
| `PROMPTFOO_FAILED_TEST_EXIT_CODE` | 失败退出码 | 100 |
| `PROMPTFOO_ASSERTIONS_MAX_CONCURRENCY` | 断言并发数 | 3 |
| `PROMPTFOO_EVAL_TIMEOUT_MS` | 单条用例超时（毫秒） | - |
| `PROMPTFOO_MAX_EVAL_TIME_MS` | 整体超时 | - |
| `PROMPTFOO_LOG_DIR` | 日志目录 | `~/.promptfoo/logs` |
| `PROMPTFOO_DISABLE_UPDATE` | 关更新检查 | false |
| `FORCE_COLOR=0` | 关闭终端颜色（CI 友好） | - |

API key 类（按 provider）：`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`DEEPSEEK_API_KEY`、`GOOGLE_API_KEY` 等。可写在项目 `.env` 里，promptfoo 会自动加载。

---

## 15. 常见坑与排错（踩坑实录）

### 坑 1：把 `npm warn` 当成安装失败 ❌

**现象**：`npm i -g promptfoo` 输出一堆 `npm warn ERESOLVE...` / `deprecated...`，以为没装上。

**真相**：`warn`（警告）≠ `error`（错误）。警告不影响安装。验证是否装好：

```bash
promptfoo --version    # 能出版本号就成了
```

### 坑 2：模型答对了却全 FAIL ❌

**现象**：情感分类里，模型明明输出"好评"，断言 `contains: 好评` 却判 FAIL。

**根因（推理模型特有）**：像 `deepseek-reasoner` 这类**推理模型**会在最终答案前输出 `Thinking:` 思考链。思考过程里常常同时提到两个选项（如"判断**是好评还是差评**"），于是：
- `contains: 好评` ✅ 通过
- `not-contains: 差评` ❌ 被 Thinking 里的"差评"误伤 → FAIL

**对策**：
1. **eval 场景**：去掉脆弱的 `not-contains`，`contains` 足够；或在 provider config 里降低/关闭推理（如 `reasoning_effort`）。
2. **判分场景**：用 `transform` 先剥掉 Thinking 再判定，或用 `llm-rubric` 让裁判只看最终结论。

> 经验法则：**对推理模型，慎用 `not-contains`**——它的思考链几乎一定会提到你要排除的词。

### 坑 3：`generate dataset -p` 报 `unknown option '-p'` ❌

**根因**：`-p` 是 `eval` 的 prompt 参数，`generate dataset` 没有。生成数据的说明用 `-i`（instructions），prompt 本身从配置文件读。

**正解**：

```bash
promptfoo generate dataset -i "生成说明..." -o tests.csv
```

### 坑 4：`generate dataset` 崩溃 `Cannot read properties of undefined` ❌

**根因**：`--provider` 用了**推理模型**，输出被 `Thinking:` 包裹导致解析失败。

**正解**：换非推理模型：

```bash
--provider deepseek:deepseek-chat   # 而非 deepseek-reasoner
```

**通用规律**：**让模型当"结构化数据生成器"或"裁判"时，必须用非推理模型**（输出干净、可解析）。eval 里测推理模型本身则没问题。

### 坑 5：改了配置但结果没变

**根因**：缓存命中。模型调用被缓存了。

**对策**：`promptfoo eval --no-cache` 或 `promptfoo cache clear`。注意：改 `assert` 不会重调模型（断言是对已有输出判分），所以改断言后结果会立即变；改 prompt/model/vars 才可能命中缓存。

### 坑 6：CI 里报退出码 100

这是 promptfoo 的**设计**：有用例失败 → 退出码 100。若你想"允许部分失败"，设 `PROMPTFOO_PASS_RATE_THRESHOLD=90`。

### 坑 7：`.env` 里的 key 没生效

确认：① 文件在**项目根目录**（运行 `promptfoo` 的目录）；② 用 `--env-file` 显式指定；③ provider 配置里 env 引用语法 `${VAR}` 正确。

### 排错通用手段

```bash
LOG_LEVEL=debug promptfoo eval          # 详细日志
promptfoo logs                          # 看日志文件
promptfoo debug                         # 环境诊断
promptfoo validate                      # 校验配置 schema
promptfoo validate target -t deepseek:deepseek-chat  # 测 provider 连通性
```

---

## 16. 进阶技巧

### 16.1 transform —— 判定前变换输出

```yaml
assert:
  - type: contains
    value: "好评"
    transform: "output.split('\\n').pop()"   # 只取最后一行（跳过 Thinking）
```

完美解决 [坑 2](#坑-2模型答对了却全-fail-)：剥掉推理模型的思考链，只判最后一行。

### 16.2 多 prompt A/B 对比

```yaml
prompts:
  - id: 简洁版
    raw: "分类：{{review}}"
  - id: 严格版
    raw: "你是情感分析专家，严格分类为正面/负面，不解释：{{review}}"

providers:
  - deepseek:deepseek-chat
```

结果表里两个 prompt 并排，直接看哪个 prompt 更好。

### 16.3 optimize —— 自动优化 prompt

```bash
promptfoo optimize                         # 优化第 0 个 prompt
promptfoo optimize --prompt-index 1 --validation-split 0.2
```

它会：跑基线 → 根据失败案例生成候选 prompt → 评估 → 输出最强的那个。`--validation-split` 留一部分用例防过拟合。

### 16.4 MCP server —— 让 AI agent 调用 promptfoo

```bash
promptfoo mcp --transport stdio    # 给 Cursor / Claude Desktop 用
promptfoo mcp --transport http -p 3100  # 给 web 应用用
```

暴露 14 个工具（run_evaluation、redteam_run、generate_dataset 等），让 AI agent 直接驱动评测。

### 16.5 scenarios 矩阵展开

```yaml
scenarios:
  - config:
      - {lang: 英文, expected: "positive"}
      - {lang: 中文, expected: "正面"}
    tests:
      - vars: {review: "..."}
        assert:
          - type: contains
            value: "{{expected}}"
```

一组配置展开成多条 test，省重复。

### 16.6 Node.js 库方式调用

不只 CLI，也能当代码库用：

```javascript
import promptfoo from 'promptfoo';

const results = await promptfoo.evaluate({
  prompts: ['分类：{{review}}'],
  providers: ['deepseek:deepseek-chat'],
  tests: [{ vars: { review: '好评' }, assert: [{ type: 'icontains', value: 'positive' }] }],
});
console.log(results.results);
```

---

## 附录：学习路径建议

1. **跑通**：`init` → 写 2 条用例 → `eval` → `view`。（[§4](#4-5-分钟上手)）
2. **加断言**：掌握 `contains` / `equals` / `llm-rubric`。（[§7](#7-断言assertions类型大全)）
3. **多模型对比**：加第二个 provider，体会 promptfoo 的核心价值。（[§8.3](#83-多模型对比promptfoo-最强场景)）
4. **外部数据**：用 CSV 管理大批用例，或 `generate dataset` 自动造。（[§9](#9-自动生成测试数据)）
5. **红队**：`redteam run` 跑一轮安全压测。（[§10](#10-red-team-红队安全测试)）
6. **接 CI**：`--no-cache` + 门槛 + 退出码。（[§13](#13-cicd-集成)）
7. **优化**：`promptfoo optimize` 自动调 prompt。（[§16.3](#163-optimize--自动优化-prompt)）

---

## 参考链接

- 官方文档：<https://www.promptfoo.dev/docs>
- CLI 参考：<https://www.promptfoo.dev/docs/usage/command-line/>
- 断言参考：<https://www.promptfoo.dev/docs/configuration/expected-outputs/>
- Providers：<https://www.promptfoo.dev/docs/providers/>
- 红队：<https://www.promptfoo.dev/docs/red-team/quickstart/>
- GitHub：<https://github.com/promptfoo/promptfoo>

---

*本文档基于 promptfoo 0.121.x 官方文档（2026-07）整理，结合实战踩坑经验补充。如遇版本差异，以官方文档为准。*
