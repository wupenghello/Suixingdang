// DOM/HTML 转义工具（从 app.js 抽离，行为不变）
// escapeHtml：转义 & < > 及引号，使其在文本与属性（data-*）上下文都安全，防 XSS。

export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  // innerHTML 只转义 & < >；补转义引号，使其在属性上下文（data-* 等）也安全
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
