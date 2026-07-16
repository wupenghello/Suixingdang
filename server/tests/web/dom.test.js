import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../../app/web/assets/utils/dom.js';

// escapeHtml：转义 & < > 及引号，使文本在「元素内容」与「属性值（data-*）」上下文都安全。
// 依赖 happy-dom 提供的 document.createElement / textContent / innerHTML。

describe('escapeHtml', () => {
  it('转义 & < >', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('转义引号（属性上下文安全）', () => {
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
  });

  it('null / undefined → 空串', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('非字符串经 String() 转换', () => {
    expect(escapeHtml(123)).toBe('123');
  });

  // ===== 安全回归：XSS 防护 =====
  it('XSS：无法逃逸属性上下文注入 onmouseover', () => {
    const evil = '" onmouseover="alert(1)';
    const out = escapeHtml(evil);
    // 所有裸 " 都被转义，攻击者无法闭合 data-* 属性
    expect(out).not.toContain('" onmouseover');
    expect(out).toBe('&quot; onmouseover=&quot;alert(1)');
  });

  it('XSS：<script> 标签被文本化为无危害实体', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
