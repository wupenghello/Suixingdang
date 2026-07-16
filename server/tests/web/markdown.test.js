import { describe, it, expect } from 'vitest';
import { renderMarkdown, renderNoteMarkdown } from '../../app/web/assets/utils/markdown.js';

// renderMarkdown：marked 解析 + DOMPurify 净化 + _enhanceMarkdownDom（标题锚点/外链/代码块复制按钮）。
// 依赖 setup.js 注入的 window.marked / window.DOMPurify（真库，测真实净化行为）。

describe('renderMarkdown', () => {
  it('空串 → 空串', () => {
    expect(renderMarkdown('')).toBe('');
  });

  it('正常 markdown：粗体 + 行内代码', () => {
    const out = renderMarkdown('**粗体** 和 `code`');
    expect(out).toContain('<strong>粗体</strong>');
    expect(out).toContain('<code>code</code>');
  });

  it('标题被 _enhanceMarkdownDom 加上 id（用于 TOC 跳转）', () => {
    expect(renderMarkdown('# 标题一')).toMatch(/<h1[^>]*\sid="标题一"/);
  });

  // ===== 安全回归：DOMPurify 净化（AI 回复是注入入口，最后关口）=====
  it('XSS：<script> 标签被净化', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script>');
  });

  it('XSS：<img onerror> 事件处理器被净化', () => {
    expect(renderMarkdown('<img src=x onerror="alert(1)">')).not.toContain('onerror');
  });

  it('XSS：javascript: 伪协议链接被净化', () => {
    expect(renderMarkdown('[click](javascript:alert(1))')).not.toContain('javascript:alert');
  });

  it('代码块：_enhanceMarkdownDom 加复制按钮 + 语言标签', () => {
    const out = renderMarkdown('```js\nvar x = 1;\n```\n');
    expect(out).toContain('code-copy-btn');
    expect(out).toContain('code-lang-label');
  });

  it('链接：_enhanceMarkdownDom 设 target=_blank + rel=noopener', () => {
    const out = renderMarkdown('[外链](https://example.com)');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('noopener');
  });

  it('多同名标题：slug 去重（第二个加 -2）', () => {
    const out = renderMarkdown('# 同\n\n# 同\n');
    expect(out).toMatch(/id="同"/);
    expect(out).toMatch(/id="同-2"/);
  });

  it('mermaid 代码块：替换为 mermaid-chart', () => {
    const out = renderMarkdown('```mermaid\ngraph TD\nA-->B\n```\n');
    expect(out).toContain('mermaid-chart');
  });

  it('快照：固定 markdown 渲染稳定（升级 marked/DOMPurify 时提示漂移）', () => {
    expect(renderMarkdown('# 标题\n\n段落 **粗** `码`。\n\n```js\nvar x = 1;\n```\n')).toMatchSnapshot();
  });
});

describe('renderNoteMarkdown', () => {
  it('空串 → { html: "", toc: [] }', () => {
    expect(renderNoteMarkdown('')).toEqual({ html: '', toc: [] });
  });

  it('含 h1-h3 标题 → 提取 TOC（level/text/id）', () => {
    const { toc } = renderNoteMarkdown('# 一\n\n## 二\n\n### 三');
    expect(toc).toHaveLength(3);
    expect(toc[0]).toMatchObject({ level: 1, text: '一' });
    expect(toc[2]).toMatchObject({ level: 3, text: '三' });
  });

  it('双链 [[note]] → 替换为 wikilink <a>', () => {
    const { html } = renderNoteMarkdown('见 [[某笔记]]');
    expect(html).toContain('wikilink');
    expect(html).toContain('data-wikilink="某笔记"');
  });

  it('双链 [[note|别名]] → 链接文本用别名，data-wikilink 用原名', () => {
    const { html } = renderNoteMarkdown('[[某笔记|显示名]]');
    expect(html).toContain('显示名');
    expect(html).toContain('data-wikilink="某笔记"');
  });
});
