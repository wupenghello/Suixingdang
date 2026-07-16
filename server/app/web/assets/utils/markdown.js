// Markdown 渲染（从 app.js 抽离，行为不变）
// renderMarkdown 用于 AI 回复；renderNoteMarkdown 用于笔记（含 TOC + 双链 [[]]）。
// 依赖：window.marked/DOMPurify/hljs/mermaid/renderMathInElement（lib 全局）、ICONS（代码复制按钮）、escapeHtml。
import { ICONS } from './icons.js';
import { escapeHtml } from './dom.js';

export function renderMarkdown(text) {
  if (!text) return '';
  let html;
  try {
    html = window.marked.parse(text, { breaks: true, gfm: true });
  } catch { return escapeHtml(text).replace(/\n/g, '<br>'); }
  try { html = window.DOMPurify.sanitize(html); } catch {}
  const div = document.createElement('div');
  div.innerHTML = html;
  _enhanceMarkdownDom(div);
  return div.innerHTML;
}

function _enhanceMarkdownDom(div) {
  // Mermaid 图表：将 language-mermaid 代码块替换为渲染后的 SVG（须在 hljs 之前，避免 hljs 干扰）
  div.querySelectorAll('pre code.language-mermaid').forEach(code => {
    if (window.mermaid) {
      try {
        const graphText = code.textContent || '';
        const id = 'mermaid-' + Math.random().toString(36).slice(2, 10);
        const { svg } = window.mermaid.render(id, graphText);
        const wrapper = document.createElement('div');
        wrapper.className = 'mermaid-chart';
        wrapper.innerHTML = svg;
        code.closest('pre').replaceWith(wrapper);
      } catch {}
    }
  });
  // 代码高亮（hljs 可选，缺失时静默跳过）
  if (window.hljs) {
    div.querySelectorAll('pre code').forEach(block => {
      try { window.hljs.highlightElement(block); } catch {}
    });
  }
 // 代码块：添加语言标签 + 复制按钮
 div.querySelectorAll('pre').forEach(pre => {
   if (pre.querySelector('.code-copy-btn')) return;
   const code = pre.querySelector('code');
   const lang = code ? (code.className.match(/language-(\w+)/) || [])[1] : '';
   const wrapper = document.createElement('div');
   wrapper.className = 'code-block-header';
   if (lang) { const label = document.createElement('span'); label.className = 'code-lang-label'; label.textContent = lang; wrapper.appendChild(label); }
   const btn = document.createElement('button');
   btn.className = 'code-copy-btn';
   btn.innerHTML = ICONS.copy;
   btn.title = '复制代码';
   btn.addEventListener('click', () => {
     const text = (code ? code.textContent : pre.textContent) || '';
     navigator.clipboard.writeText(text).then(() => {
       btn.innerHTML = ICONS.tbCheck;
       btn.classList.add('is-copied');
       setTimeout(() => { btn.innerHTML = ICONS.copy; btn.classList.remove('is-copied'); }, 2000);
     }).catch(() => {});
   });
   wrapper.appendChild(btn);
   pre.style.position = 'relative';
   pre.prepend(wrapper);
 });
  // KaTeX 数学公式渲染（行内 $...$ 和块级 $$...$$）
  if (window.renderMathInElement) {
    try {
      window.renderMathInElement(div, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true },
        ],
        throwOnError: false,
      });
    } catch {}
  }
  // 标题加 id（用于 TOC 跳转），去重处理
  const slugCount = {};
  div.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
    const text = (h.textContent || '').trim();
    if (!text) return;
    let slug = text.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '');
    if (!slug) slug = 'heading';
    slugCount[slug] = (slugCount[slug] || 0) + 1;
    if (slugCount[slug] > 1) slug += '-' + slugCount[slug];
    h.id = slug;
  });
  // 外部链接新窗口打开，避免覆盖当前会话
  div.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
}

export function renderNoteMarkdown(text) {
  if (!text) return { html: '', toc: [] };
  let html;
  try {
    html = window.marked.parse(text, { breaks: true, gfm: true });
  } catch { return { html: escapeHtml(text).replace(/\n/g, '<br>'), toc: [] }; }
  try { html = window.DOMPurify.sanitize(html); } catch {}
  const div = document.createElement('div');
  div.innerHTML = html;
  _enhanceMarkdownDom(div);
  _renderWikilinks(div);
  // 提取 TOC（仅 h1-h3，避免过深）
  const toc = [];
  div.querySelectorAll('h1,h2,h3').forEach(h => {
    toc.push({ level: parseInt(h.tagName[1], 10), text: (h.textContent || '').trim(), id: h.id });
  });
  return { html: div.innerHTML, toc };
}

function _renderWikilinks(div) {
  // 在渲染后的 DOM 中将 [[note name]] 文本替换为可点击的内部链接
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT, null);
  const nodes = [];
  let node;
  while (node = walker.nextNode()) {
    if (/\[\[.+\]\]/.test(node.textContent)) nodes.push(node);
  }
  nodes.forEach(textNode => {
    const text = textNode.textContent;
    const parts = [];
    let last = 0;
    const re = /\[\[([^\]]+)\]\]/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push(document.createTextNode(text.slice(last, m.index)));
      const inner = m[1];
      const [name, alias] = inner.split("|");
      const linkText = (alias || name).trim();
      const span = document.createElement('a');
      span.className = 'wikilink';
      span.href = '#';
      span.dataset.wikilink = name.split("#")[0].trim();
      span.textContent = linkText;
      parts.push(span);
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(document.createTextNode(text.slice(last)));
    if (parts.length) {
      const frag = document.createDocumentFragment();
      parts.forEach(p => frag.appendChild(p));
      textNode.parentNode.replaceChild(frag, textNode);
    }
  });
}
