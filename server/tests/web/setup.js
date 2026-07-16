// vitest 全局 setup
// 注入 markdown.js 依赖的 window 全局库（marked / DOMPurify），用真库测真实净化行为。
// jsdom 提供 document/window；hljs/mermaid/renderMathInElement 为可选，缺失时 _enhanceMarkdownDom 静默跳过。
import { marked } from 'marked';
import DOMPurifyFactory from 'dompurify';

globalThis.marked = marked;

// dompurify 的 default export：有全局 window 时是已配置实例，否则是工厂函数
const DOMPurify = DOMPurifyFactory && typeof DOMPurifyFactory.sanitize === 'function'
  ? DOMPurifyFactory
  : DOMPurifyFactory(globalThis.window);
globalThis.DOMPurify = DOMPurify;

// 可选增强库（_enhanceMarkdownDom 用）：no-op mock，使其分支可被覆盖（生产里缺失时静默跳过）
globalThis.hljs = { highlightElement: () => {} };
globalThis.mermaid = { render: () => ({ svg: '<svg class="mermaid-svg"/>' }) };
globalThis.renderMathInElement = () => {};
