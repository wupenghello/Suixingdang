// 回收站页面骨架/表格/空态的纯 HTML 生成（从 app.js 抽离，便于 layout 单测）
// 所有动态值经 escapeHtml 转义，XSS 安全；不依赖 DOM，可在 vitest/jsdom 直接断言结构。
import { escapeHtml } from './dom.js';
import { ICONS } from './icons.js';
import { formatSize } from './format.js';
import { expBadge } from './trash.js';

// 批量选择按钮图标（与 app.js 的 SELECT_ICON 同源）
const SELECT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><polyline points="8.5,12 11,14.5 15.5,9.5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// 顶栏 + 滚动体骨架（renderTrash 注入 #main-content 的内容）
export function trashShellHTML() {
  return `
    <div class="topbar">
      <div class="topbar-title">${ICONS.trash} 回收站</div>
      <div class="topbar-spacer"></div>
      <button class="btn btn-secondary btn-sm" id="btn-trash-select-toggle" title="批量选择">${SELECT_ICON}<span>批量选择</span></button>
      <button class="btn btn-secondary" id="btn-trash-purge">${ICONS.refresh} 清理过期</button>
      <button class="btn btn-danger" id="btn-trash-empty">${ICONS.trash} 清空回收站</button>
    </div>
    <div class="trash-body">
      <div id="trash-banner" class="trash-banner"></div>
      <div id="trash-batch-bar" class="batch-bar" style="display:none"></div>
      <div id="trash-content">加载中...</div>
    </div>`;
}

// 保留期横幅文案（图标单独包裹，便于 CSS 约束尺寸 + flex 对齐）
export function trashBannerHTML(retentionDays, lockedCount) {
  return `<div class="trash-banner-icon">${ICONS.trash}</div><div class="trash-banner-text">文件在回收站保留 <strong>${retentionDays} 天</strong> 后将永久删除。已锁存文件不受此限制。${lockedCount ? ` 当前锁存 <strong>${lockedCount}</strong> 个。` : ''}</div>`;
}

// 空态
export function trashEmptyStateHTML(retentionDays) {
  return `<div class="empty-state"><div class="trash-empty-art">${ICONS.trash}</div><div class="empty-title">回收站空空如也</div><div class="empty-desc">删除的文件会在此保留 ${retentionDays} 天,期间可随时恢复。<br>重要文件可手动锁存,跳出自动清理。</div></div>`;
}

// 过期徽章 HTML（三级配色 + 锁存）
export function trashExpBadgeHTML(remainingDays, locked) {
  const b = expBadge(remainingDays, locked);
  if (b.cls === 'lock') return `<span class="badge badge-lock" title="已锁存,永不过期">${ICONS.lock} 锁存</span>`;
  if (b.cls === 'danger') return `<span style="color:var(--danger);font-weight:600">⚠ ${b.text}</span>`;
  if (b.cls === 'warning') return `<span style="color:var(--warning);font-weight:600">${b.text}</span>`;
  return `<span>${b.text}</span>`;
}

// 单行 HTML
export function trashRowHTML(item) {
  const size = formatSize(item.size);
  const delTime = new Date(item.deleted_at).toLocaleString('zh-CN', { hour12: false });
  return `<tr class="trash-row" data-file-id="${escapeHtml(item.file_id)}" data-name="${escapeHtml(item.name)}">
    <td><div class="file-check" title="选择"></div></td>
    <td style="font-weight:500">${escapeHtml(item.name)}</td>
    <td style="color:var(--text-muted);font-size:12px">${escapeHtml(item.path)}</td>
    <td style="font-size:12px">${size}</td>
    <td style="color:var(--text-muted);font-size:12px">${delTime}</td>
    <td style="font-size:12px">${trashExpBadgeHTML(item.remaining_days, item.locked)}</td>
    <td style="text-align:right;white-space:nowrap">
      <button class="icon-btn" data-action="trash-preview" title="预览">${ICONS.eye}</button>
      <button class="btn btn-secondary btn-sm" data-action="trash-restore" title="恢复至原位置">${ICONS.refresh} 恢复</button>
      <button class="btn btn-sm ${item.locked ? 'btn-primary' : 'btn-secondary'}" data-action="trash-lock" title="${item.locked ? '解锁' : '锁存(跳出自动清理)'}">${item.locked ? ICONS.lock + ' 解锁' : ICONS.lock + ' 锁存'}</button>
      <button class="btn btn-danger btn-sm" data-action="trash-purge" title="彻底删除">${ICONS.trash} 删除</button>
    </td>
  </tr>`;
}

// 表格区整体（含横滚兜底容器 + 固定列宽）
export function trashTableHTML(items, retentionDays) {
  return `
    <div style="padding:8px 0 12px;font-size:13px;color:var(--text-muted)">
      共 ${items.length} 个文件 · 保留期 ${retentionDays} 天
    </div>
    <div class="table-scroll">
    <table class="data-table trash-table">
      <col class="col-check"><col class="col-name"><col class="col-path"><col class="col-size"><col class="col-deleted"><col class="col-remaining"><col class="col-actions">
      <thead><tr>
        <th class="th-check"></th>
        <th>文件名</th><th>原路径</th><th>大小</th><th>删除时间</th><th>剩余天数</th><th>操作</th>
      </tr></thead>
      <tbody>
        ${items.map(trashRowHTML).join('')}
      </tbody>
    </table>
    </div>`;
}
