/**
 * 文件库重构测试：验证新引入的图标与关键 CSS class 名在 app.js 中一致存在，
 * 且 app.js 顶层不产出 'undefined' 文本。
 * 这些是 PRD §5 白卡 Bentô 重构 + Q4.C 合成敏感分组的静态契约测试。
 */
import { describe, it, expect } from 'vitest';
import { ICONS, getFileIcon } from '../../app/web/assets/utils/icons.js';
import fs from 'node:fs';

import path from 'node:path';
const WEB_ROOT = path.resolve(__dirname, '../../app/web');
const appSrc = fs.readFileSync(path.resolve(WEB_ROOT, 'assets/app.js'), 'utf8');
const cssSrc = fs.readFileSync(path.resolve(WEB_ROOT, 'assets/app.css'), 'utf8');
const htmlSrc = fs.readFileSync(path.resolve(WEB_ROOT, 'index.html'), 'utf8');

describe('图标契约（重构后）', () => {
  it('新增的 file-library icon key 都存在且为 <svg> 字符串', () => {
    for (const k of ['fileCabinet', 'sensitive', 'shieldOff']) {
      expect(typeof ICONS[k]).toBe('string');
      expect(ICONS[k].startsWith('<svg')).toBe(true);
    }
  });

  it('既有的关键 icon key 不被重构破坏', () => {
    for (const k of ['folder','files','groups','add','upload','trash','eye','download','close','pin','refresh']) {
      expect(typeof ICONS[k]).toBe('string');
      expect(ICONS[k]).toContain('</svg>');
    }
  });

  it('export 避免 reserved word 已改名为 exportIco', () => {
    // export 作为对象字面量 key 在 new Function / strict 模式编译下抛 SyntaxError
    expect(ICONS.exportIco).toBeDefined();
    expect(typeof ICONS.exportIco).toBe('string');
  });
});

describe('app.js 渲染契约（重构后）', () => {
  it('渲染档案室侧栏的关键选择器出现在源码中', () => {
    // renderGroupsSidebar 白卡重构后的 DOM contract
    expect(appSrc).toContain('files-groups-hd');
    expect(appSrc).toContain('档案室');
    expect(appSrc).toContain('fileCabinet');
    expect(appSrc).toContain('group-item-cta');
    expect(appSrc).toContain('btn-group-create-quick');
  });

  it('合成敏感分组（Q4.C）相关 id / 类名在源码中', () => {
    expect(appSrc).toContain('__sensitive__');
    expect(appSrc).toContain('SENSITIVE_GROUP_ID');
    expect(appSrc).toContain('group-item--sensitive');
    expect(appSrc).toContain('sensitiveFileCount');
    expect(appSrc).toContain('.sensitive');
  });

  it('is-sensitive 行样式 + alert 告警条都在源码中', () => {
    expect(appSrc).toContain('is-sensitive');
    expect(appSrc).toContain('alert-bar');
    expect(appSrc).toContain('btn-view-sensitive');
    expect(appSrc).toContain('btn-dismiss-sensitive');
  });

  it('bento 文件列表 / 网格 view 的白卡 class 在源码中', () => {
    expect(appSrc).toContain('file-list-card');
    expect(appSrc).toContain('file-card-actions');   // 网格卡 hover 药丸
    expect(appSrc).toContain('file-card-action');    // 单个药丸 button
    expect(appSrc).toContain('group-divider');
  });

  it('新 file-item 敏感视图空态有返回全部文件 CTA', () => {
    expect(appSrc).toContain('btn-back-all');
  });

  it('ICONS.exportIco 引用留在 app.js（export 改名对齐）', () => {
    expect(appSrc).toContain('ICONS.exportIco');
    expect(appSrc).not.toContain('ICONS.export\b');
  });
});

/**
 * 文件库表格布局契约（R1–R7 重构 + A11y + 设计真源一致性）
 * 这些断言把“表格炸了”的根因逐条钉死，防止 CI 绿但样式回归。
 */
describe('文件库表格布局契约', () => {
  it('R1: 列模板单一真源 --file-cols，表头与行共用同一变量', () => {
    expect(cssSrc).toContain('--file-cols:');
    expect(cssSrc).toContain('grid-template-columns: var(--file-cols);');
    // 表头与行必须在同一规则块内共享列模板，杜绝 auto 列各自计算导致错位
    expect(cssSrc).toMatch(/\.file-table-head,\s*\n\s*\.file-row/);
  });

  it('R1: 表头操作列保留占位（visibility 而非 display:none），与行同列宽', () => {
    expect(cssSrc).toContain('.file-table-head .file-cell--actions { visibility: hidden; }');
    expect(cssSrc).not.toContain('.file-table-head .file-cell--actions { display: none; }');
  });

  it('R1: 操作列定宽 var(--file-actions-w)，表头占位与行内按钮同宽', () => {
    expect(cssSrc).toContain('var(--file-actions-w, 160px)');
  });

  it('R2: ≤720px 窄屏列数与可见 cell 严格匹配（表头隐藏 + 仅 name/actions）', () => {
    expect(cssSrc).toMatch(/@media \(max-width: 720px\)/);
    expect(cssSrc).toContain('--file-cols: minmax(0, 1fr) auto;');
    expect(cssSrc).toContain('.file-table-head { display: none; }');
    expect(cssSrc).toContain('.file-row .file-cell--type,');
    expect(cssSrc).toContain('.file-row .file-cell--date { display: none; }');
  });

  it('R3: 置顶配色统一品牌蓝，无橙色 is-pinned 背景覆盖', () => {
    expect(cssSrc).toMatch(/\.file-row\.is-pinned \{[^}]*var\(--primary-lighter\)/);
    // 被删的历史橙底（rgba 255,125,0,0.03）不应回归
    expect(cssSrc).not.toContain('rgba(255, 125, 0, 0.03)');
  });

  it('R4: 操作列常驻可见，无 opacity:0 / hover 显隐冲突', () => {
    expect(cssSrc).not.toMatch(/\.file-cell--actions\s*\{[^}]*opacity:\s*0/);
    expect(cssSrc).not.toContain('.file-row:hover .file-cell--actions { opacity: 1; }');
  });

  it('R5: 列宽语义化（minmax 而非硬编码 70/84/92 定宽）', () => {
    expect(cssSrc).toContain('minmax(72px, auto)');
    expect(cssSrc).toContain('minmax(80px, auto)');
    // 旧的硬编码列模板串不应再出现
    expect(cssSrc).not.toContain('grid-template-columns: minmax(0, 1fr) 70px 84px 92px auto;');
  });

  it('R6: 行淡分隔线（Notion/飞书式 border-bottom）', () => {
    expect(cssSrc).toMatch(/\.file-row\s*\{[\s\S]*?border-bottom:\s*1px solid var\(--border-light\)/);
  });

  it('R7: 历史 flex hack 已清理', () => {
    expect(cssSrc).not.toContain('修复：确保file-list-card');
  });

  it('F-P0-5: app.css / app.js 均带 ?v= 防缓存查询串', () => {
    expect(htmlSrc).toMatch(/app\.css\?v=\d+/);
    expect(htmlSrc).toMatch(/app\.js\?v=\d+/);
  });

  it('A11y: 表格容器与表头具备 grid/row 语义', () => {
    expect(appSrc).toContain('class="file-table" role="grid"');
    expect(appSrc).toContain('class="file-table-head" role="row"');
  });

  it('A11y: 文件名截断时 title 提供全名 tooltip', () => {
    expect(appSrc).toContain('class="file-name" title="${escapeHtml(item.name)}"');
  });

  it('设计真源一致：代码库零 #2B5FFF 引用（统一 #3370FF）', () => {
    expect(cssSrc.toUpperCase()).not.toContain('2B5FFF');
    expect(appSrc.toUpperCase()).not.toContain('2B5FFF');
  });

  it('档案室侧栏图标尺寸约束（防 fileCabinet/add 图标按 viewBox 撑到 ~190px）', () => {
    // .files-groups-hd / .group-item-cta 曾缺失 svg 尺寸规则，图标渲染成 ~190px
    expect(cssSrc).toMatch(/\.files-groups-hd svg\s*\{[^}]*width:\s*16px/);
    expect(cssSrc).toMatch(/\.group-item-cta svg\s*\{[^}]*width:\s*16px/);
  });
});
