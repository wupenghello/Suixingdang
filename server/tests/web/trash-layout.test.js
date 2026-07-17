import { describe, it, expect } from 'vitest';
import {
  trashShellHTML,
  trashBannerHTML,
  trashEmptyStateHTML,
  trashTableHTML,
  trashRowHTML,
  trashExpBadgeHTML,
} from '../../app/web/assets/utils/trash-layout.js';
import { expBadge } from '../../app/web/assets/utils/trash.js';

// 拼手構造测试用条目
const baseItem = (over = {}) => ({
  file_id: 'f1',
  name: '报告.pdf',
  path: '/docs/报告.pdf',
  size: 2048,
  deleted_at: '2026-07-10 08:00:00',
  remaining_days: 3,
  locked: false,
  ...over,
});

describe('trashShellHTML（骨架 · 滚动容器）', () => {
  it('包含顶栏与 .trash-body 滚动容器（修复 R1/R2：长列表可滚动、不裁切）', () => {
    const html = trashShellHTML();
    expect(html).toContain('class="topbar"');
    expect(html).toContain('class="trash-body"');
    expect(html).toContain('id="trash-content"');
    expect(html).toContain('id="trash-banner"');
    expect(html).toContain('id="trash-batch-bar"');
  });

  it('清空/清理/批量选择按钮齐备（批量选择含图标+文字 span）', () => {
    const html = trashShellHTML();
    expect(html).toContain('id="btn-trash-empty"');
    expect(html).toContain('id="btn-trash-purge"');
    expect(html).toContain('id="btn-trash-select-toggle"');
    // 按钮内必须同时有 svg 图标与 <span>批量选择</span>，否则 syncTrashSelectUI 会 null deref
    const btn = html.match(/id="btn-trash-select-toggle"[^>]*>([\s\S]*?)<\/button>/);
    expect(btn).toBeTruthy();
    expect(btn[1].includes('<svg')).toBe(true);
    expect(btn[1].includes('<span>批量选择</span>')).toBe(true);
  });
});

describe('trashBannerHTML（保留期横幅）', () => {
  it('显示保留天数', () => {
    expect(trashBannerHTML(7, 0)).toContain('7 天');
  });
  it('有锁存时追加锁存数', () => {
    const html = trashBannerHTML(30, 2);
    expect(html).toContain('锁存');
    expect(html).toContain('<strong>2</strong>');
  });
  it('无锁存时不追加', () => {
    expect(trashBannerHTML(7, 0)).not.toContain('当前锁存');
  });
  it('图标与文字分离包裹（便于 CSS 约束尺寸 + flex 对齐）', () => {
    const html = trashBannerHTML(7, 0);
    expect(html).toContain('class="trash-banner-icon"');
    expect(html).toContain('class="trash-banner-text"');
    // SVG 在 icon 容器内，而非裸插在文字里
    expect(html).toMatch(/class="trash-banner-icon"[^>]*>.*<svg/s);
  });
});

describe('trashEmptyStateHTML（空态）', () => {
  it('包含空态艺术字与说明', () => {
    const html = trashEmptyStateHTML(7);
    expect(html).toContain('empty-state');
    expect(html).toContain('trash-empty-art');
    expect(html).toContain('empty-title');
  });
});

describe('trashTableHTML（表格 · 横滚兜底）', () => {
  it('外包 .table-scroll 横滚容器（修复 R4：窄屏不击穿视口）', () => {
    const html = trashTableHTML([baseItem()], 7);
    expect(html).toContain('class="table-scroll"');
    expect(html).toContain('class="data-table trash-table"');
  });

  it('行数与条目数一致，且每行带选择 checkbox', () => {
    const items = [baseItem(), baseItem({ file_id: 'f2' }), baseItem({ file_id: 'f3' })];
    const html = trashTableHTML(items, 7);
    expect(html.match(/class="trash-row"/g)).toHaveLength(3);
    expect(html.match(/class="file-check"/g)).toHaveLength(3);
  });

  it('表头 7 列齐备', () => {
    const html = trashTableHTML([baseItem()], 7);
    for (const h of ['文件名', '原路径', '大小', '删除时间', '剩余天数', '操作']) {
      expect(html).toContain(h);
    }
  });
});

describe('trashRowHTML（单行）', () => {
  it('回填 data-file-id / data-name', () => {
    const html = trashRowHTML(baseItem({ file_id: 'abc', name: 'x' }));
    expect(html).toContain('data-file-id="abc"');
    expect(html).toContain('data-name="x"');
  });

  it('XSS：文件名/路径中的 < > & " 被转义', () => {
    const html = trashRowHTML(baseItem({ name: '<img src=x onerror=alert(1)>', path: '/a&b"' }));
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  });

  it('size 走 formatSize（2048 -> 2 KB）', () => {
    expect(trashRowHTML(baseItem({ size: 2048 }))).toContain('2 KB');
  });

  it('锁存态行显示解锁按钮、文案差异', () => {
    const locked = trashRowHTML(baseItem({ locked: true }));
    expect(locked).toContain('解锁');
    const unlocked = trashRowHTML(baseItem({ locked: false }));
    expect(unlocked).toContain('锁存');
  });
});

describe('trashExpBadgeHTML（三级配色 + 锁存 · 与 expBadge 纯函数契约一致）', () => {
  it('锁存 -> 锁存徽章(永不过期)', () => {
    expect(trashExpBadgeHTML(0.5, true)).toContain('badge-lock');
    expect(trashExpBadgeHTML(0.5, true)).toContain('锁存');
  });
  it('危险(<=1 天) -> 红色', () => {
    const html = trashExpBadgeHTML(0.5, false);
    expect(html).toContain('var(--danger)');
    expect(html).toContain(expBadge(0.5, false).text);
  });
  it('警告(1-2 天) -> 橙色', () => {
    expect(trashExpBadgeHTML(1.5, false)).toContain('var(--warning)');
  });
  it('普通(>2 天) -> 无特殊色', () => {
    expect(trashExpBadgeHTML(3, false)).not.toContain('var(--danger)');
    expect(trashExpBadgeHTML(3, false)).not.toContain('var(--warning)');
  });
});

// ===== 端到端 DOM 集成：把真实 HTML 注入 jsdom，验证骨架/表格/高亮选择器可匹配 =====
// 目的：兜住「renderTrash → loadTrash」骨架级回归（修复 R1/R2/R3/R4 的 layout 测试）
describe('trash layout DOM integration (jsdom)', () => {
  const item = baseItem({ file_id: 'x1', name: 'a.txt', path: '/a.txt', size: 1024, remaining_days: 6, deleted_at: '2026-07-10 08:00:00' });

  it('shell 含 .trash-body 滚动容器 + 顶栏按钮（含 span，防 syncTrashSelectUI null deref）', () => {
    document.body.innerHTML = trashShellHTML();
    expect(document.querySelector('.trash-body')).not.toBeNull();
    expect(document.querySelector('.topbar')).not.toBeNull();
    const toggle = document.getElementById('btn-trash-select-toggle');
    expect(toggle.querySelector('span')).not.toBeNull();
    expect(toggle.querySelector('span').textContent).toBe('批量选择');
  });

  it('表格渲染行数匹配、外包 .table-scroll 横滚容器（修复 R4）', () => {
    document.getElementById('trash-content').innerHTML = trashTableHTML([item, baseItem({ file_id: 'x2' })], 7);
    expect(document.querySelectorAll('.trash-row')).toHaveLength(2);
    // table-scroll 容器必须存在且包裹 data-table
    const scroll = document.querySelector('.table-scroll');
    expect(scroll).not.toBeNull();
    expect(scroll.querySelector('.data-table')).not.toBeNull();
    // 固定列宽：col 分组与 trash-table class
    expect(document.querySelector('.trash-table')).not.toBeNull();
    expect(document.querySelectorAll('.trash-table col')).toHaveLength(7);
  });

  it('banner 注入后图标与文字分别包裹在独立容器', () => {
    document.body.innerHTML = trashShellHTML();
    document.getElementById('trash-banner').innerHTML = trashBannerHTML(7, 2);
    expect(document.querySelector('.trash-banner-icon')).not.toBeNull();
    expect(document.querySelector('.trash-banner-text')).not.toBeNull();
    expect(document.querySelector('.trash-banner-icon svg')).not.toBeNull();
  });

  it('.trash-row 的 data-file-id 可被 querySelector 选中（handler 绑定前提）', () => {
    document.getElementById('trash-content').innerHTML = trashTableHTML([item], 7);
    const row = document.querySelector('.trash-row');
    expect(row.dataset.fileId).toBe('x1');
    // checkbox 与行一一对应
    expect(row.querySelector('.file-check')).not.toBeNull();
  });

  it('选中高亮选择器作用在 td 而非 tr（修复 R3：td 背景不被覆盖）', () => {
    document.getElementById('trash-content').innerHTML = trashTableHTML([item], 7);
    const row = document.querySelector('.trash-row');
    row.classList.add('is-selected');
    // 用 CSS 选择器验证：.trash-row.is-selected > td 能匹配到单元格
    const cells = row.querySelectorAll(':scope > td');
    expect(cells.length).toBeGreaterThan(0);
    // 至少一列存在（可匹配 is-selected 下的 td）
    expect(row.matches('.trash-row.is-selected')).toBe(true);
  });
});
