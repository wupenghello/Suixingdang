// 初始化 Mermaid 图表库（延迟到首次渲染时自动启动）
if (window.mermaid) {
  window.mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' });
}

// 随行档 - 前端 SPA

// ============ Utils（已抽离到 ./utils/，便于单测；生产仍零构建）============
// ============ Utils（已抽离到 ./utils/，便于单测；生产仍零构建）============
// import 带 ?v=（与 index.html 的 app.js?v= 同步）：改 utils 后需同步升这里 + index.html 的 ?v=，
// 否则浏览器命中缓存的旧 utils。check-cache-busting.mjs 在 CI 兜底检测漏改。
import { formatSize, formatDate, formatDateTime, stripExt } from './utils/format.js?v=61';
import { parseServerTs } from './utils/time.js?v=60';
import { escapeHtml } from './utils/dom.js?v=60';
import { getPreviewType, fileTypeBadge } from './utils/file-classify.js?v=60';
import { ICONS, getFileIcon } from './utils/icons.js?v=62';
import { renderMarkdown, renderNoteMarkdown } from './utils/markdown.js?v=60';
import { isTokenActive, tokenStatusBadge, tokenKindBadge, tokenExpiryText } from './utils/tokens.js?v=60';
import { trashShellHTML, trashBannerHTML, trashEmptyStateHTML, trashTableHTML } from './utils/trash-layout.js?v=66';
import { createTrashSelection } from './utils/trash-selection.js?v=66';

// ============ API 层 ============
const API = {
  // 会话令牌存 HttpOnly cookie（由服务端 set/clear，前端 JS 不可读），防 XSS 偷令牌。
  // 同源 fetch/XHR 自动带 cookie，无需手动附加 Authorization 头。
  async request(url, options = {}) {
    const headers = { ...options.headers };
    if (options.body && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    let res = await fetch(url, { ...options, headers });
    // access 过期：用 refresh cookie 静默续期（服务端读 cookie 并 set 新 access cookie）
    if (res.status === 401) {
      const refreshRes = await fetch('/api/auth/refresh', { method: 'POST' });
      if (refreshRes.ok) {
        res = await fetch(url, { ...options, headers });
      } else if (!options._skipLogoutRedirect) {
        // refresh 也失效：清 cookie 并回落地页（同步渲染）。
        // 仅非跳过模式调用——App.init 探测登录态时由 init 自己决定渲染 login()，避免竞态。
        App.logout();
        return res;  // 返回 401（非 undefined），调用方 res.ok 检查不致 TypeError
      }
    }
    return res;
  },
  async get(url, options) { return this.request(url, options); },
  async post(url, body) {
    return this.request(url, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
  },
  async put(url, body) {
    return this.request(url, { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) });
  },
  async postForm(url, formData) { return this.request(url, { method: 'POST', body: formData }); },
  async del(url) { return this.request(url, { method: 'DELETE' }); },
};

// ============ Toast ============
const Toast = {
  show(message, type = 'info', duration = 3000, action) {
    let container = document.getElementById('toasts');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toasts';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    // 可选操作按钮(单对象或数组,如"撤销"/"查看")
    const actions = Array.isArray(action) ? action : (action ? [action] : []);
    actions.forEach(act => {
      if (act && act.label && typeof act.onClick === 'function') {
        const btn = document.createElement('button');
        btn.className = 'toast-action';
        btn.textContent = act.label;
        btn.addEventListener('click', () => { act.onClick(); });
        el.appendChild(btn);
      }
    });
    container.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 200); }, duration);
  }
};

// ============ Upload Manager ============
const UploadManager = {
  items: [],
  visible: false,

  show() {
    if (this.container) return;
    this.container = document.createElement('div');
    this.container.className = 'upload-list';
    this.container.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="upload-close"]')) this.close();
    });
    this.render();
    document.body.appendChild(this.container);
    this.visible = true;
  },

  hide() {
    if (this.container && this.items.every(i => i.status === 'done' || i.status === 'error')) {
      setTimeout(() => {
        if (this.container) {
          this.container.remove();
          this.container = null;
          this.items = [];
          this.visible = false;
        }
      }, 2000);
    }
  },

  add(filename, size) {
    this.show();
    const item = { id: Date.now() + Math.random(), filename, size, progress: 0, status: 'uploading' };
    this.items.push(item);
    this.render();
    return item;
  },

  update(id, updates) {
    const item = this.items.find(i => i.id === id);
    if (item) { Object.assign(item, updates); this.render(); }
  },

  render() {
    if (!this.container) return;
    const active = this.items.filter(i => i.status === 'uploading').length;
    const done = this.items.filter(i => i.status === 'done').length;
    const failed = this.items.filter(i => i.status === 'error').length;

    const headerText = active > 0 ? `上传中 ${active}/${this.items.length}` : `完成 ${done}/${this.items.length}`;
    this.container.innerHTML = `
      <div class="upload-list-header">
        <span>${headerText}</span>
        ${active === 0 ? `<button class="icon-btn" data-action="upload-close" style="width:20px;height:20px">✕</button>` : ''}
      </div>
      ${this.items.map(item => {
        const pct = item.status === 'done' ? 100 : item.status === 'error' ? 100 : item.progress;
        const cls = item.status === 'done' ? 'success' : item.status === 'error' ? 'error' : '';
        const statusText = item.status === 'done' ? '✓' : item.status === 'error' ? '失败' : `${pct}%`;
        return `
          <div class="upload-item">
            <div class="upload-item-name">
              <span>${item.filename}</span>
              <span class="upload-item-status">${statusText}</span>
            </div>
            <div class="progress-bar"><div class="progress-fill ${cls}" style="width:${pct}%"></div></div>
          </div>
        `;
      }).join('')}
    `;
  },

  close() {
    if (this.container) { this.container.remove(); this.container = null; this.items = []; this.visible = false; }
  }
};


// 文件页控件图标
const SORT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="13" y2="7"/><line x1="4" y1="12" x2="11" y2="12"/><line x1="4" y1="17" x2="9" y2="17"/><polyline points="15,14 18,17 21,14"/></svg>';
const GRID_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z"/></svg>';
const LIST_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20,6 9,17 4,12"/></svg>';
const SELECT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><polyline points="8.5,12 11,14.5 15.5,9.5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const ICON_CHEVRON_LEFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';

// ============ Utils ============
// formatSize / formatDate / formatDateTime 已抽离至 ./utils/format.js（见顶部 import）
// PREVIEW_*_EXT / getPreviewType 已抽离至 ./utils/file-classify.js（见顶部 import）
// escapeHtml 已抽离至 ./utils/dom.js（见顶部 import）






// 偏好持久化（视图、排序等）
function loadPref(key, def) {
  try { const v = JSON.parse(localStorage.getItem('sxd_' + key)); return v == null ? def : v; } catch { return def; }
}
function savePref(key, val) {
  try { localStorage.setItem('sxd_' + key, JSON.stringify(val)); } catch {}
}

// 列表加载骨架屏（替代纯文字"加载中..."）
function skeletonHTML(rows = 6) {
  const row = `<div class="skeleton-row"><div class="sk-icon"></div><div class="sk-lines"><div class="sk-line w-50"></div><div class="sk-line w-25"></div></div></div>`;
  return `<div class="file-list">${row.repeat(rows)}</div>`;
}

// 错误态 + 重试按钮（替代纯文字"加载失败"）
function renderErrorState(container, message, onRetry) {
  container.innerHTML = `<div class="empty-state error-state"><div>${escapeHtml(message || '加载失败')}</div>${onRetry ? '<button class="btn btn-secondary btn-sm" style="margin-top:12px">重试</button>' : ''}</div>`;
  if (onRetry) {
    const btn = container.querySelector('.error-state button');
    if (btn) btn.addEventListener('click', onRetry);
  }
}

// ============ Context Menu ============
function showContextMenu(x, y, items) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.id = 'context-menu';
  menu.innerHTML = items.map(item =>
    item.divider ? '<div style="height:1px;background:var(--border);margin:4px 0"></div>'
    : `<div class="context-menu-item ${item.danger ? 'danger' : ''}" data-action="${item.action}">${item.icon || ''}<span>${item.label}</span></div>`
  ).join('');
  // Clamp to viewport
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';
  menu.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', () => {
      const action = el.dataset.action;
      closeContextMenu();
      const item = items.find(i => i.action === action);
      if (item && item.onClick) item.onClick();
    });
  });
}
function closeContextMenu() {
  const existing = document.getElementById('context-menu');
  if (existing) existing.remove();
}

// ============ Account Popover（侧栏账户弹层） ============
// 左下角 .sidebar-user 的点击入口：身份 / 存储用量 / 最近登录 / 快捷动作。
// 数据全部来自当前用户自身（/me + /stats），不涉及他人；纯内存渲染，不落盘。
let _accountPopover = null;
let _popoverDismiss = null; // {onDown, onEsc} — 供 closeAccountPopover 统一移除

function closeAccountPopover() {
  // 统一移除 document 级监听器，避免菜单项点击 / toggle 路径泄漏（修复：监听器泄漏）
  if (_popoverDismiss) {
    document.removeEventListener('mousedown', _popoverDismiss.onDown);
    document.removeEventListener('keydown', _popoverDismiss.onEsc);
    _popoverDismiss = null;
  }
  if (_accountPopover) { _accountPopover.remove(); _accountPopover = null; }
  const anchor = document.getElementById('sidebar-user');
  if (anchor) anchor.setAttribute('aria-expanded', 'false');
}

async function openAccountPopover(anchor) {
  // toggle：已开则关
  if (_accountPopover) { closeAccountPopover(); return; }
  const me = App.currentUser || {};
  const initial = (me.username || '档').charAt(0).toUpperCase();
  const roleMap = { user: '普通用户', admin: '管理员' };
  const statusBadge = me.status === 'active'
    ? '<span class="badge badge-success">正常</span>'
    : '<span class="badge badge-danger">已禁用</span>';

  const pop = document.createElement('div');
  pop.className = 'account-popover';
  pop.setAttribute('role', 'menu');
  pop.innerHTML = `
    <div class="ap-header">
      <div class="ap-avatar">${escapeHtml(initial)}</div>
      <div class="ap-meta">
        <div class="ap-name">${escapeHtml(me.username || '')}</div>
        <div class="ap-sub">${escapeHtml(roleMap[me.role] || me.role || '')} · ${statusBadge}</div>
      </div>
    </div>
    <div class="ap-storage" id="ap-storage">加载中…</div>
    <div class="ap-login" id="ap-login"></div>
    <div class="ap-menu" role="none">
      <button class="ap-item" role="menuitem" data-ap="account">${ICONS.user}<span>账户详情</span></button>
      <button class="ap-item" role="menuitem" data-ap="security">${ICONS.shield}<span>安全与会话</span></button>
      <button class="ap-item" role="menuitem" data-ap="others">${ICONS.logout}<span>退出其他设备</span></button>
    </div>
    <div class="ap-divider"></div>
    <button class="ap-item ap-danger" role="menuitem" data-ap="logout">${ICONS.logout}<span>退出登录</span></button>`;
  document.body.appendChild(pop);
  _accountPopover = pop;
  anchor.setAttribute('aria-expanded', 'true');

  positionPopover(pop, anchor);
  loadPopoverStats(pop);

  // 最近登录（来自 /me；完整登录历史见设置-账户页）
  const loginEl = pop.querySelector('#ap-login');
  if (loginEl && me.last_login_at) {
    loginEl.innerHTML = `<span class="ap-login-label">最近登录</span><span class="ap-login-val">${formatDateTime(me.last_login_at)}</span>`;
  }

  // 菜单项动作
  pop.querySelectorAll('[data-ap]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.ap;
      closeAccountPopover();
      if (action === 'account') App.openSettings('account');
      else if (action === 'security') App.openSettings('security');
      else if (action === 'others') revokeOtherTokens();
      else if (action === 'logout') App.logout();
    });
  });

  // 关闭：点击外部 / Esc（setTimeout 避免与本轮 click 冲突）
  setTimeout(() => {
    const onDown = (e) => {
      if (_accountPopover && !_accountPopover.contains(e.target) && !anchor.contains(e.target)) closeAccountPopover();
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') { closeAccountPopover(); try { anchor.focus(); } catch {} }
    };
    _popoverDismiss = { onDown, onEsc };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
  }, 0);
}

// 弹层定位：默认向上展开，上方空间不足则向下；横向夹在视口内
function positionPopover(pop, anchor) {
  const rect = anchor.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();
  const gap = 8;
  const top = (rect.top - gap - popRect.height > 8)
    ? rect.top - popRect.height - gap
    : rect.bottom + gap;
  pop.style.top = Math.max(8, Math.min(top, window.innerHeight - popRect.height - 8)) + 'px';
  pop.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - popRect.width - 8)) + 'px';
}

// 弹层内的存储用量（紧凑版），异步加载
function loadPopoverStats(pop) {
  const el = pop.querySelector('#ap-storage');
  if (!el) return;
  (async () => {
    try {
      const d = await getStats();
      // 弹层已关闭则放弃写入（用 isConnected 正确检测移除，修复：关闭检测死代码）
      if (!el.isConnected) return;
      if (!d) { el.textContent = '用量加载失败'; el.classList.add('ap-fail'); return; }
      el.innerHTML = renderPopoverStorage(d);
    } catch { if (el.isConnected) { el.textContent = '用量加载失败'; el.classList.add('ap-fail'); } }
  })();
}

// ============ 存储用量共享逻辑（弹层 / 账户页 / 设置-存储索引 三处共用） ============
// 计算配额使用百分比与配色（充足→绿，偏紧→橙，告急→红）
function computeStorageFill(used, quota) {
  const limited = quota > 0;
  const pct = limited ? Math.min((used / quota) * 100, 100) : 0;
  let fill = 'success';
  if (pct >= 90) fill = 'danger';
  else if (pct >= 70) fill = 'warning';
  return { limited, pct, fill };
}

// 弹层紧凑版存储条
function renderPopoverStorage(stats) {
  const used = Number(stats.total_size_mb) || 0;
  const quota = Number(stats.quota_mb) || 0;
  const { limited, pct, fill } = computeStorageFill(used, quota);
  if (!limited) return `<div class="ap-storage-note">已用 ${used} MB · 未设配额</div>`;
  return `<div class="ap-storage-head"><span>存储用量</span><span>${Math.round(pct)}%</span></div>
    <div class="ap-storage-track"><div class="ap-storage-bar fill-${fill}" style="width:${pct}%"></div></div>
    <div class="ap-storage-foot">${used} MB / ${quota} MB</div>`;
}

// 标准版存储条（供账户页、设置-存储索引页使用）
function renderStorageBar(stats) {
  const used = Number(stats.total_size_mb) || 0;
  const quota = Number(stats.quota_mb) || 0;
  const { limited, pct, fill } = computeStorageFill(used, quota);
  if (!limited) return `<div class="storage-usage-note">当前账号未设置存储配额，用量无上限。</div>`;
  return `<div class="storage-usage">
    <div class="storage-usage-head"><span>配额使用</span><span class="storage-usage-pct">${Math.round(pct)}%</span></div>
    <div class="storage-usage-track"><div class="storage-usage-bar fill-${fill}" style="width:${pct}%"></div></div>
    <div class="storage-usage-foot">${used} MB / ${quota} MB</div>
  </div>`;
}

// /api/files/stats 短缓存（30s），避免弹层→账户页→设置页重复请求（修复：三次重复请求）
let _statsData = null;
let _statsDataTs = 0;
async function getStats() {
  const now = Date.now();
  if (_statsData && now - _statsDataTs < 30000) return _statsData;
  const res = await API.get('/api/files/stats');
  if (!res || !res.ok) return _statsData; // 失败时返回旧数据（若有）
  _statsData = await res.json();
  _statsDataTs = now;
  return _statsData;
}

// ============ Drag-Drop Upload ============
function setupDragDrop() {
  // 幂等：App.init 每次登录都会再跑，避免重复挂 document 监听导致一次拖放触发 N 次上传
  if (setupDragDrop._done) return;
  setupDragDrop._done = true;
  let dragCounter = 0;
  let overlay = null;

  document.addEventListener('dragenter', (e) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      dragCounter++;
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'upload-overlay';
        const dropTarget = App.currentView === 'transfer' ? '传输助手' : (selectedGroup ? '当前分组' : (currentDir || '主目录'));
        overlay.innerHTML = `<div class="upload-overlay-box">${ICONS.upload}<p>松开以发送文件到${dropTarget}</p></div>`;
        document.body.appendChild(overlay);
      }
    }
  });
  document.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  document.addEventListener('dragleave', (e) => {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      if (overlay) { overlay.remove(); overlay = null; }
    }
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    if (overlay) { overlay.remove(); overlay = null; }
    if (e.dataTransfer.files.length > 0) {
      if (App.currentView === 'transfer') handleTransferFiles(e.dataTransfer.files);
      else handleFilesUpload(e.dataTransfer.files);
    }
  });
}


// ============ Paste Upload ============
// 为粘贴进来的文件生成可读文件名：截图类泛名（image.png 等）按 MIME + 时间戳重命名，
// 从文件管理器复制的真实文件保留原名，避免所有截图都叫 image.png。
function makePasteFileName(file) {
  const raw = (file.name || '').trim();
  const GENERIC = new Set(['image.png', 'image.jpg', 'image.jpeg', 'image.gif', 'image.webp', 'image.bmp', 'unknown', 'untitled']);
  // 保留真实原名（含无扩展名的 README/Makefile 等）；只有泛名（image.png 等）才走生成逻辑
  if (raw && !GENERIC.has(raw.toLowerCase())) return raw;
  const mime = file.type || '';
  let ext = mime.split('/')[1] || 'bin';
  ext = ext.split(/[+;]/)[0];            // svg+xml -> svg
  if (ext === 'jpeg') ext = 'jpg';
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  // 随机后缀：同一秒粘贴多张图片时避免文件名碰撞（storage 同名会覆盖落盘文件）
  const suffix = Math.random().toString(36).slice(2, 6);
  let prefix = '粘贴文件';
  if (mime.startsWith('image/')) prefix = '粘贴图片';
  else if (mime.startsWith('video/')) prefix = '粘贴视频';
  else if (mime.startsWith('audio/')) prefix = '粘贴音频';
  return `${prefix}_${ts}_${suffix}.${ext}`;
}

function setupPaste() {
  // 幂等：App.init 每次登录都会再跑，避免重复挂 document paste 监听导致一次粘贴触发 N 次上传
  if (setupPaste._done) return;
  setupPaste._done = true;
  document.addEventListener('paste', (e) => {
    // 仅传输助手视图拦截文件粘贴；其余视图保持浏览器默认行为
    if (App.currentView !== 'transfer') return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items || !items.length) return;
    // 索引遍历：DataTransferItemList 在部分旧/移动浏览器上不可迭代，for...of 会抛错
    const fileItems = [];
    let hasString = false;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === 'string') { hasString = true; continue; }
      if (it.kind === 'file') { const f = it.getAsFile(); if (f) fileItems.push(f); }
    }
    if (!fileItems.length) return;        // 纯文本：放行，按默认插入到输入框
    // 富文本混合粘贴（从 Office/网页复制「文字+内嵌图片」）：优先保留文字，不把内嵌图片当文件上传
    if (hasString && fileItems.every(f => (f.type || '').startsWith('image/'))) return;
    e.preventDefault();
    const files = fileItems.map(f => new File([f], makePasteFileName(f), { type: f.type || '' }));
    handleTransferFiles(files);
  });
}


// ============ Register ============
// 登录/注册/找回 共用的分屏外壳：左品牌面板 + 右表单
function loginShell(card) {
  return `
    <div class="login-container">
      <aside class="login-brand">
        <div class="login-brand-top">
          <span class="login-brand-mark">档</span>
          <span class="login-brand-name">随行档</span>
        </div>
        <div class="login-brand-body">
          <h2>只对你显影的<br>私人档案室。</h2>
          <p>文件加密归档、一句话语义检索、由 AI 作答。公司电脑上只看不留,离开一键吊销。</p>
          <ul class="login-brand-points">
            <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5z"/><path d="M9 12l2 2 4-4"/></svg>AES-256 落盘加密</li>
            <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>一句话语义检索</li>
            <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>默认零落盘,一键吊销</li>
          </ul>
        </div>
        <div class="login-brand-foot">© 2026 随行档 · 自托管</div>
      </aside>
      <main class="login-main">${card}</main>
    </div>`;
}

async function renderRegister() {
  document.body.classList.remove('view-shell');
  document.getElementById('app').innerHTML = loginShell(`
      <div class="login-card">
        <div class="login-logo">档</div>
        <h1>创建账号</h1>
        <p class="subtitle">建立你的私人档案室</p>
        <form id="register-form">
          <div class="form-group"><label>用户名</label><input type="text" id="reg-username" class="form-input" placeholder="2个字符以上" autofocus></div>
          <div class="form-group"><label>密码</label><input type="password" id="reg-password" class="form-input" placeholder="8个字符以上"></div>
          <div class="form-group"><label>密保问题</label><input type="text" id="reg-question" class="form-input" placeholder="如：你最喜爱的运动是什么？"></div>
          <div class="form-group"><label>密保答案</label><input type="text" id="reg-answer" class="form-input" placeholder="用于找回密码"></div>
          <button type="submit" class="btn btn-primary btn-block" id="reg-btn" style="padding:10px 16px">注册</button>
        </form>
        <p style="text-align:center;margin-top:16px"><a href="#" data-action="renderLogin" style="color:var(--text-muted);font-size:13px;text-decoration:none">已有账号？登录</a></p>
      </div>
    `);
  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('reg-username').value;
    const password = document.getElementById('reg-password').value;
    const security_question = document.getElementById('reg-question').value;
    const security_answer = document.getElementById('reg-answer').value;
    const btn = document.getElementById('reg-btn');
    btn.disabled = true; btn.textContent = '注册中...';
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, security_question, security_answer }),
      });
      const data = await res.json();
      if (res.ok) {
        Toast.show('注册成功', 'success');
        App.init();
      } else {
        Toast.show(data.detail || '注册失败', 'error');
      }
    } catch (err) { Toast.show('网络错误: ' + err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = '注册'; }
  });
}
window.renderRegister = renderRegister;

// ============ Forgot Password ============
function renderForgotPassword() {
  document.body.classList.remove('view-shell');
  document.getElementById('app').innerHTML = loginShell(`
      <div class="login-card">
        <div class="login-logo">档</div>
        <h1>找回密码</h1>
        <p class="subtitle">通过密保问题重置密码</p>
        <form id="forgot-form">
          <div class="form-group"><label>用户名</label><input type="text" id="fp-username" class="form-input" placeholder="输入你的用户名" autofocus></div>
          <div id="fp-step2" style="display:none">
            <div class="form-group"><label>提示</label><input type="text" id="fp-question" class="form-input" readonly style="opacity:0.7"></div>
            <div class="form-group"><label>密保答案</label><input type="text" id="fp-answer" class="form-input" placeholder="输入密保答案"></div>
            <div class="form-group"><label>新密码</label><input type="password" id="fp-newpass" class="form-input" placeholder="8个字符以上"></div>
          </div>
          <button type="submit" class="btn btn-primary btn-block" id="fp-btn" style="padding:10px 16px">下一步</button>
        </form>
        <p style="text-align:center;margin-top:16px"><a href="#" data-action="renderLogin" style="color:var(--text-muted);font-size:13px;text-decoration:none">返回登录</a></p>
      </div>
    `);
  let step = 1;
  const form = document.getElementById('forgot-form');
  const btn = document.getElementById('fp-btn');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('fp-username').value;
    if (step === 1) {
      btn.disabled = true; btn.textContent = '验证中...';
      try {
        const res = await fetch('/api/auth/forgot-password/question', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username }),
        });
        const data = await res.json();
        if (res.ok) {
          document.getElementById('fp-question').value = data.question;
          document.getElementById('fp-step2').style.display = 'block';
          document.getElementById('fp-username').readOnly = true;
          document.getElementById('fp-answer').focus();
          step = 2;
          btn.textContent = '重置密码';
        } else {
          Toast.show(data.detail || '用户不存在', 'error');
          btn.textContent = '下一步';
        }
      } catch (err) { Toast.show('网络错误', 'error'); btn.textContent = '下一步'; }
      finally { btn.disabled = false; }
    } else {
      const answer = document.getElementById('fp-answer').value;
      const new_password = document.getElementById('fp-newpass').value;
      if (!answer || !new_password) { Toast.show('请填写完整', 'error'); return; }
      btn.disabled = true; btn.textContent = '重置中...';
      try {
        const res = await fetch('/api/auth/forgot-password/reset', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, answer, new_password }),
        });
        const data = await res.json();
        if (res.ok) { Toast.show('密码已重置，请登录', 'success'); renderLogin(); }
        else { Toast.show(data.detail || '重置失败', 'error'); }
      } catch (err) { Toast.show('网络错误', 'error'); }
      finally { btn.disabled = false; btn.textContent = '重置密码'; }
    }
  });
}
window.renderForgotPassword = renderForgotPassword;

// ============ Landing (官网落地页) ============
// 未登录访问根路径时展示的产品官网:顶栏 + Hero + 特性 + 安全/多端 + CTA + Footer。
// 纯静态渲染,右上角"登录"跳 renderLogin;注册 CTA 随 register-status 开关,失败降级为仅"登录"。
function renderLanding() {
  // 双落地页已合并（Q2A）：统一跳静态 landing.html，消除 .sx-page #2B5FFF 与静态页 #3370FF 的双源色差
  window.location.href = '/';
  return; // 以下旧 SPA 内落地页（.sx-page）已废弃，保留以避免大段删除风险；永不执行
  document.body.classList.remove('view-shell');
  const ic = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
    chat:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    sync:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 0 1 18 0"/><path d="M7.5 12a4.5 4.5 0 0 1 9 0"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>',
    guard:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5z"/><path d="M12 8v4M12 16h.01"/></svg>',
    trace:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
    lock:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15" r="1" fill="currentColor"/></svg>',
    key:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="15" r="4"/><path d="M10.85 12.15 21 2M18 5l3 3M15 8l3 3"/></svg>',
    doc:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5z"/></svg>',
    block:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
    warn:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    check:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    docker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="9" width="4" height="4"/><rect x="8" y="9" width="4" height="4"/><rect x="13" y="9" width="4" height="4"/><rect x="8" y="4" width="4" height="4"/><path d="M2 14c2 3 6 4 10 4 6 0 10-3 10-7 0-1-.5-2-1.5-2.5"/></svg>',
    ssl:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    db:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"/></svg>',
    audit:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    cite:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    twofa:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 12l2 2 4-4"/></svg>',
    arrow:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  };

  document.getElementById('app').innerHTML = `
    <div class="sx-page">
      <header class="sx-bar">
        <a class="sx-brand" href="#" data-action="renderLanding" title="随行档">
          <span class="sx-mark">档</span>
          <span class="sx-brand-meta"><span class="sx-brand-name">随行档</span><span class="sx-brand-sub">私人文件中枢</span></span>
        </a>
        <nav class="sx-bar-nav">
          <a href="#features">功能</a>
          <a href="#demo">演示</a>
          <a href="#security">安全</a>
          <a href="#deploy">部署</a>
        </nav>
        <div class="sx-bar-cta">
          <button class="sx-link" type="button" data-action="renderLogin">登录</button>
          <button class="sx-link sx-link--solid" type="button" id="landing-cta-nav" data-action="renderLogin">免费开始</button>
        </div>
      </header>

      <section class="sx-hero">
        <div class="sx-hero-inner">
          <span class="sx-pill">自托管 · 加密归档 · 零痕迹</span>
          <h1>把所有文件，装进<br>只对你<span class="sx-accent">显影</span>的档案室。</h1>
          <p class="sx-hero-lead">不想在公司电脑装网盘客户端，又需要随时取文件。随行档长在你自己的服务器上——浏览器打开就能用，文件加密归档、一句话检索、AI 直接回答。用完关页，这台电脑上什么都没留下。</p>
          <div class="sx-hero-cta">
            <button class="sx-btn" type="button" id="landing-cta-hero" data-action="renderLogin">免费开始 <span class="sx-arrow">→</span></button>
            <a class="sx-btn sx-btn--ghost" href="#demo">看演示</a>
          </div>

          <div class="sx-mockup" aria-hidden="true">
            <div class="sx-mockup-bar"><span class="sx-mockup-dot"></span><span class="sx-mockup-dot"></span><span class="sx-mockup-dot"></span></div>
            <div class="sx-mockup-body">
              <aside class="sx-mockup-side">
                <div class="sx-mockup-sideh">档案室</div>
                <div class="sx-mockup-item is-active">${ic.doc}全部文件</div>
                <div class="sx-mockup-item">${ic.doc}工作</div>
                <div class="sx-mockup-item">${ic.doc}证件</div>
                <div class="sx-mockup-item">${ic.doc}笔记</div>
              </aside>
              <div class="sx-mockup-main">
                <div class="sx-mockup-q">上个月哪份报价最高？</div>
                <div class="sx-mockup-a">在已归档文件中，<strong>报价单_2026Q2.xlsx</strong> 金额最高，为 ¥182,400。</div>
                <div class="sx-mockup-files">
                  <span class="sx-mockup-chip">${ic.doc}报价单_2026Q2.xlsx</span>
                  <span class="sx-mockup-chip">${ic.doc}合同_甲方.pdf</span>
                  <span class="sx-mockup-chip">${ic.doc}身份证.jpg</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="sx-section" id="features">
        <div class="sx-container">
          <div class="sx-head">
            <h2>一处档案室，替你收拢散落的文件</h2>
            <p>加密归档、语义检索、AI 作答、敏感预警。文件从家里、从手机、从各个角落汇到一处，只对你开放。</p>
          </div>
          <div class="sx-bento">
            <div class="sx-cell sx-cell--wide sx-cell--tint">
              <div class="sx-cell-ico">${ic.search}</div>
              <h3>语义检索</h3>
              <p>不用记文件名。搜"上季度报价"、"甲方合同条款"、"体检结论"，按内容匹配。Word、Excel、PDF、PPT 都能读。</p>
              <div class="sx-cell-art"><div class="sx-searchbar">${ic.search}上个月哪家供应商最贵<span class="sx-cursor"></span></div></div>
            </div>
            <div class="sx-cell">
              <div class="sx-cell-ico">${ic.chat}</div>
              <h3>AI 对话</h3>
              <p>问"尾款什么时候付"、"合同到期了吗"，Agent 在你的文件里找答案再回答，不用自己翻。</p>
            </div>
            <div class="sx-cell">
              <div class="sx-cell-ico">${ic.sync}</div>
              <h3>多端同步</h3>
              <p>家里守护进程盯着文件夹，新增即加密上传；公司用浏览器，不装任何客户端。</p>
            </div>
            <div class="sx-cell">
              <div class="sx-cell-ico">${ic.guard}</div>
              <h3>方向感知</h3>
              <p>银行流水往公司带会提醒，公司合同往家带也会提醒。.env 密钥直接拦。</p>
            </div>
            <div class="sx-cell">
              <div class="sx-cell-ico">${ic.trace}</div>
              <h3>零痕迹</h3>
              <p>默认不让下载，预览走 no-store。离职一键吊销令牌，只剩浏览器历史记录。</p>
            </div>
            <div class="sx-cell sx-cell--wide sx-cell--tint">
              <div class="sx-cell-ico">${ic.lock}</div>
              <h3>落盘加密</h3>
              <p>文件、数据库、向量库一体化 AES 加密。密钥在你手里，服务器被偷也读不出内容。支持挂 LUKS 加密卷做静态保护。</p>
            </div>
          </div>
        </div>
      </section>

      <section class="sx-section sx-section--soft" id="demo">
        <div class="sx-container">
          <div class="sx-head">
            <h2>不用翻文件夹，直接问</h2>
            <p>Agent 不只是聊天——它能搜文件、读内容、给建议、替你检查。下面是几个真实场景。</p>
          </div>
          <div class="sx-demo-chat">
            <div class="sx-demo-q">上次和甲方签的合同，尾款什么时候付？</div>
            <div class="sx-demo-a">在 <strong>合同_甲方_0603.pdf</strong> 第 2 页。尾款 ¥60,800，约定验收后 15 个工作日内支付，首期已于 6 月 15 日到账。<span class="sx-demo-cite">${ic.cite}合同_甲方_0603.pdf</span></div>

            <div class="sx-demo-q">下周从公司离职，帮我看看该清什么</div>
            <div class="sx-demo-a">当前 2 台设备在线。公司那台（<strong>ThinkPad-T14</strong>）缓存了 3 份敏感文件：银行流水_06.xlsx、体检报告.pdf、身份证_扫描件.jpg。这些已在服务器加密归档，建议吊销该设备令牌后清浏览器记录。<span class="sx-demo-act">需要我现在帮你吊销吗？</span></div>

            <div class="sx-demo-q">桌面上那堆文件，哪些该归档？</div>
            <div class="sx-demo-a">这周新增 14 个文件。建议归档：会议纪要_Q1.docx（87 天没打开）、设计稿_v3.fig（已有 v4 版本）。另外 <strong>config.env</strong> 检测到 API 密钥，已自动拦截上传。<span class="sx-demo-cite">${ic.cite}Guard 拦截</span></div>
          </div>
        </div>
      </section>

      <section class="sx-section" id="guard">
        <div class="sx-container">
          <div class="sx-head">
            <h2>同一份文件，往不同方向，判断不同</h2>
            <p>Guard 是文件的安检岗。它在文件被搬运之前先看一眼：该不该动、往这个方向动合不合适。凭据硬拦，隐私提醒。</p>
          </div>
          <div class="sx-guard-table">
            <div class="sx-guard-head">
              <span>文件</span><span>→ 带去公司</span><span>→ 带回家</span>
            </div>
            <div class="sx-guard-row">
              <span class="sx-guard-file">${ic.key}密钥 / .env / token</span>
              <span><span class="sx-guard-verdict sx-guard-block">${ic.block}拦截</span></span>
              <span><span class="sx-guard-verdict sx-guard-block">${ic.block}拦截</span></span>
            </div>
            <div class="sx-guard-row">
              <span class="sx-guard-file">${ic.doc}银行流水 / 体检报告</span>
              <span><span class="sx-guard-verdict sx-guard-warn">${ic.warn}提醒隐私</span></span>
              <span><span class="sx-guard-verdict sx-guard-pass">${ic.check}放行</span></span>
            </div>
            <div class="sx-guard-row">
              <span class="sx-guard-file">${ic.doc}公司合同 / 内部文档</span>
              <span><span class="sx-guard-verdict sx-guard-pass">${ic.check}放行</span></span>
              <span><span class="sx-guard-verdict sx-guard-warn">${ic.warn}提醒保密</span></span>
            </div>
            <div class="sx-guard-row">
              <span class="sx-guard-file">${ic.doc}普通笔记 / 资料</span>
              <span><span class="sx-guard-verdict sx-guard-pass">${ic.check}放行</span></span>
              <span><span class="sx-guard-verdict sx-guard-pass">${ic.check}放行</span></span>
            </div>
          </div>
        </div>
      </section>

      <section class="sx-section sx-section--soft" id="security">
        <div class="sx-container">
          <div class="sx-head">
            <h2>看完就走，这台电脑上没有你的文件</h2>
            <p>从落盘到传输到访问，每一层都有控制。不是喊口号，是实打实的机制。</p>
          </div>
          <div class="sx-list">
            <div class="sx-list-row"><div class="sx-list-ico">${ic.lock}</div><div><h3>落盘 · AES 加密</h3><p>文件、SQLite 数据库、Chroma 向量索引一体化 AES 加密。可选挂 LUKS/dm-crypt 加密卷，磁盘被偷也读不出内容。</p></div></div>
            <div class="sx-list-row"><div class="sx-list-ico">${ic.key}</div><div><h3>令牌 · 可远程吊销</h3><p>会话和设备令牌皆可单条或一键吊销，旧凭证立即失效。改密码后旧会话同步失效。离职换机，一个按钮切断全部。</p></div></div>
            <div class="sx-list-row"><div class="sx-list-ico">${ic.twofa}</div><div><h3>登录 · TOTP 双因子</h3><p>支持 TOTP 验证器（Google Authenticator 等），密码泄露也进不来。登录限流防爆破。</p></div></div>
            <div class="sx-list-row"><div class="sx-list-ico">${ic.trace}</div><div><h3>本地 · 默认不落盘</h3><p>浏览器端默认禁止下载，预览走 no-store。需要时验证密码后下载，可选单次或时间窗口。</p></div></div>
            <div class="sx-list-row"><div class="sx-list-ico">${ic.audit}</div><div><h3>审计 · 全量留痕</h3><p>登录、上传、删除、令牌操作全程记录。管理员后台可查，谁在什么时候干了什么一目了然。</p></div></div>
          </div>
        </div>
      </section>

      <section class="sx-section" id="access">
        <div class="sx-container">
          <div class="sx-head">
            <h2>三处出入，档案随行</h2>
            <p>家里守护、服务器归档、公司浏览器只看不留。不对称设计是这个产品的地基。</p>
          </div>
          <div class="sx-flow">
            <div class="sx-flow-node"><div class="sx-flow-ico">${ic.guard}</div><h3>家里</h3><p>守护进程自动监听文件夹，新增文件实时加密同步至档案室。可以装软件，你的地盘。</p></div>
            <div class="sx-flow-arrow">${ic.arrow}</div>
            <div class="sx-flow-node sx-flow-node--hub"><div class="sx-flow-ico">${ic.db}</div><h3>服务器</h3><p>你自己的机器上运行，文件加密归档、建立向量索引，只对你开放。</p></div>
            <div class="sx-flow-arrow">${ic.arrow}</div>
            <div class="sx-flow-node"><div class="sx-flow-ico">${ic.doc}</div><h3>公司</h3><p>浏览器即开即用，只看不留，离开一键吊销，如同从未存在。</p></div>
          </div>
        </div>
      </section>

      <section class="sx-section sx-section--soft" id="deploy">
        <div class="sx-container">
          <div class="sx-head">
            <h2>长在你自己的服务器上</h2>
            <p>Docker Compose 一键起，Caddy 自动签 HTTPS，SQLite + Chroma 嵌入式不用额外起数据库。一行命令跑起来。</p>
          </div>
          <div class="sx-deploy-grid">
            <div class="sx-terminal">
              <div class="sx-terminal-bar"><span></span><span></span><span></span></div>
<div class="sx-terminal-body"><span class="sx-comment"># 一行命令，自动下载、配置、启动</span>
<span class="sx-cmd">curl -fsSL</span> https://raw.githubusercontent.com/wupenghello/Suixingdang/main/install.sh | bash
<span class="sx-comment"># 脚本会问：域名、管理员密码（其余自动生成）</span>
<span class="sx-ok">✓</span> <span class="sx-comment">生成三把密钥 · 下载 compose/Caddyfile</span>
<span class="sx-ok">✓</span> <span class="sx-comment">Caddy 自动签发 HTTPS · 拉镜像启动容器</span>
<span class="sx-ok">✓</span> <span class="sx-comment">打开 https://你的域名 即可使用</span></div>
            </div>
            <div class="sx-deploy-facts">
              <div class="sx-fact"><div class="sx-fact-ico">${ic.docker}</div><div><h4>一键脚本</h4><p>自动下载 compose/Caddyfile、生成密钥、拉镜像启动，无需 clone 源码。也可 git clone 后 ./install.sh 从源码构建。</p></div></div>
              <div class="sx-fact"><div class="sx-fact-ico">${ic.ssl}</div><div><h4>Caddy 自动 HTTPS</h4><p>配置文件写上域名，自动签发和续期 Let's Encrypt 证书，零手动操作。</p></div></div>
              <div class="sx-fact"><div class="sx-fact-ico">${ic.db}</div><div><h4>零外部依赖</h4><p>SQLite (WAL) 做数据库，Chroma 嵌入式做向量库，不用额外起服务进程。</p></div></div>
              <div class="sx-fact"><div class="sx-fact-ico">${ic.chat}</div><div><h4>大模型按需配</h4><p>管理后台填 DeepSeek 或 OpenAI 的 API Key，Fernet 加密入库。不同用户可分配不同模型。</p></div></div>
            </div>
          </div>
        </div>
      </section>

      <section class="sx-outro">
        <div class="sx-outro-inner">
          <h2>把文件收回自己手里</h2>
          <p>部署在你自己的服务器上，数据落在你自己的磁盘上。不经过任何第三方云盘，不经过任何中间商。</p>
          <div class="sx-outro-cta">
            <button class="sx-btn sx-btn--lg" type="button" id="landing-cta-band" data-action="renderLogin">开始使用 <span class="sx-arrow">→</span></button>
            <a class="sx-outro-link" href="https://github.com/wupenghello/Suixingdang" target="_blank" rel="noopener">源码 ↗</a>
            <a class="sx-outro-link" href="#deploy">部署文档</a>
            <a class="sx-outro-link" href="#features">再看一眼功能</a>
          </div>
        </div>
      </section>

      <footer class="sx-foot">
        <div class="sx-foot-inner">
          <div class="sx-foot-brand"><span class="sx-mark sx-mark--sm">档</span> 随行档 · 私人文件中枢</div>
          <div class="sx-foot-links">
            <a href="/admin">管理后台</a>
            <a href="#" data-action="renderLogin">登录</a>
          </div>
          <span class="sx-foot-copy">© 2026 SXD</span>
        </div>
      </footer>
    </div>`;

  // 主 CTA:开放注册时改为「免费注册」→ renderRegister;查询失败则保持「立即使用/登录」
  fetch('/api/auth/register-status').then(r => r.json()).then(d => {
    if (!d.allow_register) return;
    const setText = (id, text) => { const el = document.getElementById(id); if (el) { el.textContent = text; el.dataset.action = 'renderRegister'; } };
    setText('landing-cta-nav', '免费注册');
    setText('landing-cta-hero', '免费注册');
    setText('landing-cta-band', '免费注册');
  }).catch(() => {});
}
window.renderLanding = renderLanding;


// ============ Login ============
function renderLogin() {
  document.body.classList.remove('view-shell');
  document.getElementById('app').innerHTML = loginShell(`
      <div class="login-card">
        <div class="login-logo" id="login-logo" title="返回官网">档</div>
        <h1>欢迎回来</h1>
        <p class="subtitle">登录你的私人档案室</p>
        <form id="login-form">
          <div class="form-group">
            <label>用户名</label>
            <input type="text" id="login-username" class="form-input" placeholder="用户名" autocomplete="username" autofocus>
          </div>
          <div class="form-group">
            <label>密码</label>
            <input type="password" id="login-password" class="form-input" placeholder="输入密码" autocomplete="current-password">
          </div>
          <div class="form-group" id="totp-group" style="display:none">
            <label>双因子验证码</label>
            <input type="text" id="login-totp" class="form-input" placeholder="6位数字">
          </div>
          <button type="submit" class="btn btn-primary btn-block" id="login-btn">登录</button>
        </form>
        <div id="auth-links" class="login-links">
          <a href="#" data-action="renderForgotPassword">忘记密码？</a>
          <a href="#" data-action="renderRegister" id="register-link">注册新账号</a>
        </div>
        <a class="login-back" href="/welcome">← 返回官网</a>
      </div>
    `);
  // 动态检查注册是否开放
  fetch('/api/auth/register-status').then(r => r.json()).then(d => {
    const link = document.getElementById('register-link');
    if (link) link.style.display = d.allow_register ? '' : 'none';
  }).catch(() => {});

  const loginLogo = document.getElementById('login-logo');
  if (loginLogo) { loginLogo.href = '/welcome'; loginLogo.removeAttribute('onclick'); }

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const totp_code = document.getElementById('login-totp').value;
    const btn = document.getElementById('login-btn');
    btn.disabled = true;
    btn.textContent = '登录中...';
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, totp_code }),
      });
      const data = await res.json();
      if (res.ok) {
        Toast.show('登录成功', 'success');
        App.init();
      } else {
        if (data.detail && data.detail.includes('双因子')) {
          document.getElementById('totp-group').style.display = 'block';
          document.getElementById('login-totp').focus();
        }
        Toast.show(data.detail || '登录失败', 'error');
      }
    } catch (err) {
      Toast.show('网络错误: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '登录';
    }
  });
}

// ============ File Browser ============
let currentDir = '';
let searchQuery = '';
let selectedGroup = '';  // 当前选中的分组 id（'' = 全部）
let selectedTag = '';    // 当前筛选的标签（'' = 全部）
let userGroups = [];    // 缓存当前用户的分组列表
let currentFileItems = [];               // 当前渲染的原始 items（供排序/选择重渲复用）
let fileSort = loadPref('fileSort', { key: 'name', dir: 'asc' });   // 排序偏好
let fileView = loadPref('fileView', 'list');                         // 视图：list | grid
let fileSelectMode = false;              // 是否处于批量选择模式
let fileSelection = new Set();           // 选中的 path 集合

async function renderFiles() {
  document.getElementById('main-content').innerHTML = `
    <div class="files-header">
      <div class="files-title">
        <h1>文件</h1>
        <span class="files-count" id="files-count"></span>
      </div>
      <div class="files-search search-box">${ICONS.search}<input type="text" id="search-input" placeholder="搜索文件名、类型…" value="${escapeHtml(searchQuery)}"></div>
      <div class="files-controls">
        <button class="btn btn-primary" id="btn-upload">${ICONS.upload}<span>上传</span></button>
        <button class="btn btn-secondary" id="btn-note">${ICONS.note}<span>新建笔记</span></button>
        <span class="files-divider"></span>
        <button class="btn btn-secondary btn-icon-only" id="btn-view" title="切换视图">${fileView === 'grid' ? LIST_ICON : GRID_ICON}</button>
        <button class="btn btn-secondary btn-icon-only" id="btn-sort" title="排序">${SORT_ICON}</button>
        <button class="btn btn-secondary btn-icon-only" id="btn-select" title="批量选择">${SELECT_ICON}</button>
       <button class="btn btn-secondary btn-icon-only" id="btn-groups" title="分组管理">${ICONS.groups}</button>
       <button class="btn btn-secondary btn-icon-only" id="btn-tags" title="标签筛选">${ICONS.tag}</button>
       <span class="files-divider"></span>
       <button class="btn btn-secondary btn-icon-only" id="btn-export" title="导出全部">${ICONS.export}</button>
       <button class="btn btn-secondary btn-icon-only" id="btn-refresh" title="刷新">${ICONS.refresh}</button>
      </div>
      <div id="quota-ring-slot" class="quota-ring" style="display:none"></div>
    </div>
    <div class="files-body">
      <aside class="files-groups" id="files-groups" aria-label="档案室分组"></aside>
      <div class="files-main">
        <div id="batch-bar" class="batch-bar" style="display:none"></div>
        <div class="breadcrumb" id="breadcrumb"></div>
        <div id="file-content"></div>
      </div>
    </div>
    <input type="file" id="file-input" style="display:none" multiple>
  `;
 document.getElementById('btn-refresh').addEventListener('click', () => { Toast.show('刷新中', 'info', 1000); loadFiles(); });
 document.getElementById('btn-export').addEventListener('click', () => {
   const gid = selectedGroup || '';
   exportAllFiles(gid);
 });
 document.getElementById('btn-groups').addEventListener('click', showGroupManager);
  document.getElementById('btn-tags').addEventListener('click', (e) => showTagFilterMenu(e));
  document.getElementById('btn-upload').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('btn-note').addEventListener('click', showNoteEditor);
  document.getElementById('file-input').addEventListener('change', (e) => { if (e.target.files.length) handleFilesUpload(e.target.files); e.target.value = ''; });
  document.getElementById('btn-sort').addEventListener('click', (e) => showSortMenu(e));
  document.getElementById('btn-view').addEventListener('click', () => {
    fileView = fileView === 'grid' ? 'list' : 'grid';
    savePref('fileView', fileView);
    const vb = document.getElementById('btn-view');
    if (vb) { vb.innerHTML = fileView === 'grid' ? LIST_ICON : GRID_ICON; vb.title = fileView === 'grid' ? '列表视图' : '网格视图'; }
    renderFileList(currentFileItems);
  });
  document.getElementById('btn-select').addEventListener('click', () => {
    if (fileSelectMode) exitSelectMode(); else enterSelectMode();
  });

  // 存储配额环：异步取 /api/files/stats 渲染到 header 右端（失败静默）
  (async () => {
    try {
      const s = await API.get('/api/files/stats'); if (!s.ok) return;
      const d = await s.json();
      const slot = document.getElementById('quota-ring-slot');
      if (!slot || !d.quota_mb) return;
      slot.innerHTML = _quotaRing(d.total_size_mb, d.quota_mb);
      slot.style.display = '';
    } catch { /* 配额环不影响主功能 */ }
  })();

  const searchInput = document.getElementById('search-input');
  let debounceTimer;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { searchQuery = e.target.value; loadFiles(); }, 300);
    if (e.target.value) selectedTag = '';
  });
  await loadGroups();
  loadFiles();
}


// 笔记视图：只列出 .md 笔记（对齐落地页 nav 的「笔记」入口，笔记不再混在文件库）
async function renderNotes() {
  document.getElementById('main-content').innerHTML = `
    <div class="files-header">
      <div class="files-title"><h1>笔记</h1><span class="files-count" id="files-count"></span></div>
      <div class="files-controls"><button class="btn btn-primary" id="btn-note-new">${ICONS.note}<span>新建笔记</span></button></div>
    </div>
    <div class="files-body"><div class="files-main"><div id="file-content"></div></div></div>`;
  document.getElementById('btn-note-new').addEventListener('click', showNoteEditor);
  const content = document.getElementById('file-content');
  const cntEl = document.getElementById('files-count');
  content.innerHTML = `<div class="file-table"><div class="empty-state">${ICONS.refresh}<div class="empty-title">加载中…</div></div></div>`;
  let notes = [];
  try {
    const res = await API.get('/api/files?limit=500');
    if (res && res.ok) {
      const data = await res.json();
      const list = data.items || data.files || data || [];
      notes = list.filter(f => f && /\.(md|markdown|mdown|mkd)$/i.test(f.name || ''));
    }
  } catch { notes = []; }
  if (cntEl) cntEl.textContent = notes.length ? `${notes.length} 篇` : '';
  if (!notes.length) {
    content.innerHTML = `<div class="file-table"><div class="empty-state">${ICONS.note}<div class="empty-title">还没有笔记</div><div class="empty-desc">点击「新建笔记」开始记录，用 [[页面名]] 建立双向链接</div></div></div>`;
    return;
  }
  content.innerHTML = `<div class="notes-grid">${notes.map(item => {
    const title = escapeHtml(stripExt(item.name) || '未命名笔记');
    const excerpt = escapeHtml(item.summary || item.excerpt || '');
    const dateStr = item.modified ? formatDate(item.modified) : '';
    const sizeStr = (!item.is_dir && item.size != null && item.size > 0) ? formatSize(item.size) : '';
    const meta = [sizeStr, dateStr].filter(Boolean).join(' · ') || '—';
    const pinHtml = item.pinned ? '<span class="note-card-pin">${ICONS.pin}置顶</span>' : '';
    const tags = Array.isArray(item.tags) ? item.tags.slice(0, 3) : [];
    const tagsHtml = tags.length ? '<div class="note-card-tags">' + tags.map(t => '<span class="note-card-tag">' + escapeHtml(t) + '</span>').join('') + '</div>' : '';
    return `<div class="note-card" data-path="${escapeHtml(item.path)}" data-file-id="${escapeHtml(item.file_id || '')}" data-name="${escapeHtml(item.name)}">
      <div class="note-card-title">${title}</div>
      ${excerpt ? '<div class="note-card-excerpt">' + excerpt + '</div>' : ''}
      ${tagsHtml}
      <div class="note-card-meta"><div class="note-card-meta-left">${pinHtml}<span>${meta}</span></div></div>
    </div>`;
  }).join('')}</div>`;
  content.querySelectorAll('.note-card').forEach(card => {
    card.addEventListener('click', () => openNoteEditor({ path: card.dataset.path, fileId: card.dataset.fileId, name: card.dataset.name }));
  });
}

function showNoteEditor() { openNoteEditor(); }

// 笔记编辑器 v2：全屏模式 / 侧边 TOC / 扩展快捷键 / 导出 HTML / KaTeX + Mermaid / 分屏预览 / 草稿自动保存 / 标签 / AI 整理 / 置顶
async function openNoteEditor(opts = {}) {
  const editPath = opts.path || '';
  const editFileId = opts.fileId || '';
  const editName = opts.name || '';
  const isEdit = !!(editPath || editFileId);
  const draftKey = 'sxd_draft_note_' + (editPath || 'new');
  const { modal, close } = openModal({ width: 1080, onDismiss: () => close() });
  modal.classList.add('note-editor-modal');
  modal.innerHTML = `
    <div class="note-editor-top">
      <div class="note-editor-top-left">
        <button class="tb-icon-btn" id="btn-note-toc" title="目录 (Ctrl+\\)">${ICONS.toc}</button>
        <h3>${isEdit ? '编辑笔记' : '新建笔记'}</h3>
      </div>
      <div class="note-editor-top-actions">
        <button class="tb-icon-btn" id="btn-note-pin" title="置顶/收藏">${ICONS.pin}</button>
        <button class="tb-icon-btn" id="btn-note-fullscreen" title="全屏 (F11)">${ICONS.fullscreen}</button>
        <button class="tb-icon-btn" id="btn-note-export" title="导出 HTML">${ICONS.export}</button>
        <button class="btn btn-secondary btn-sm" id="btn-note-ai" title="AI 整理：自动摘要+标签">${ICONS.ai}<span>AI 整理</span></button>
      </div>
    </div>
    <input type="text" class="form-input note-title-input" placeholder="笔记标题（可选，默认「未命名笔记」）" maxlength="80" value="${escapeHtml(stripExt(editName))}">
    <div class="input-error-msg" id="note-error"></div>
    <div class="note-editor-body" id="note-editor-body">
      <aside class="note-toc-pane" id="note-toc-pane">
        <div class="note-toc-header">目录</div>
        <div class="note-toc-list" id="note-toc-list"></div>
      </aside>
      <div class="note-editor-main">
        <div class="note-toolbar" id="note-toolbar">
          <button class="tb-btn" data-md="bold" title="加粗 (Ctrl+B)">${ICONS.tbBold}</button>
          <button class="tb-btn" data-md="italic" title="斜体 (Ctrl+I)">${ICONS.tbItalic}</button>
          <button class="tb-btn" data-md="strike" title="删除线">${ICONS.tbStrike}</button>
          <span class="tb-sep"></span>
          <button class="tb-btn" data-md="h1" title="一级标题">${ICONS.tbH1}</button>
          <button class="tb-btn" data-md="h2" title="二级标题">${ICONS.tbH2}</button>
          <button class="tb-btn" data-md="h3" title="三级标题">${ICONS.tbH3}</button>
          <span class="tb-sep"></span>
          <button class="tb-btn" data-md="ul" title="无序列表">${ICONS.tbUL}</button>
          <button class="tb-btn" data-md="ol" title="有序列表">${ICONS.tbOL}</button>
          <button class="tb-btn" data-md="quote" title="引用">${ICONS.tbQuote}</button>
          <button class="tb-btn" data-md="task" title="任务列表">${ICONS.tbTask}</button>
          <span class="tb-sep"></span>
          <button class="tb-btn" data-md="code" title="行内代码">${ICONS.tbCode}</button>
          <button class="tb-btn" data-md="codeblock" title="代码块">${ICONS.fileCode}</button>
          <button class="tb-btn" data-md="math" title="数学公式 (Ctrl+M)">${ICONS.math}</button>
          <span class="tb-sep"></span>
          <button class="tb-btn" data-md="link" title="链接 (Ctrl+K)">${ICONS.tbLink}</button>
          <button class="tb-btn" data-md="image" title="图片">${ICONS.fileImage}</button>
          <button class="tb-btn" data-md="hr" title="分割线">${ICONS.tbHr}</button>
          <button class="tb-btn" data-md="table" title="表格">${ICONS.tbTable}</button>
        </div>
        <div class="note-editor-split" id="note-split">
          <div class="note-editor-pane">
            <textarea class="note-content-input" id="note-textarea" placeholder="支持 Markdown 语法，回车换行…&#10;可拖拽或粘贴图片自动上传&#10;支持 $LaTeX$ 公式和 mermaid 图表" spellcheck="false"></textarea>
            <div class="note-status-bar" id="note-status-bar">
              <span class="nsb-item" id="nsb-words">0 字</span>
              <span class="nsb-item" id="nsb-chars">0 字符</span>
              <span class="nsb-item" id="nsb-reading">约 1 分钟</span>
              <span class="nsb-spacer"></span>
              <span class="nsb-mode" id="nsb-mode"></span>
              <span class="nsb-draft" id="nsb-draft"></span>
            </div>
          </div>
          <div class="note-preview-pane" id="note-preview-pane">
            <article class="markdown-body" id="note-preview"></article>
          </div>
        </div>
      </div>
    </div>
    <div class="note-editor-meta">
      <div class="note-backlinks-row" id="note-backlinks-row" style="display:none">
        ${ICONS.link}<span class="note-backlinks-label">反向链接</span>
        <div class="note-backlinks-list" id="note-backlinks"></div>
      </div>
      <div class="note-tags-row">
        ${ICONS.tag}<span class="note-tags-label">标签</span>
        <div class="note-tags-input" id="note-tags-input"></div>
      </div>
      <div class="note-summary-row" id="note-summary-row" style="display:none">
        ${ICONS.ai}<span class="note-summary-text" id="note-summary-text"></span>
      </div>
      <div class="note-draft-hint" id="note-draft-hint"></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="btn-note-view" title="切换视图 (Ctrl+P)">${ICONS.split}<span>分屏</span></button>
      <span class="modal-spacer"></span>
      <button class="btn btn-secondary" id="btn-note-cancel">取消</button>
      <button class="btn btn-primary" id="btn-note-save">保存</button>
    </div>`;

  const titleEl = modal.querySelector('.note-title-input');
  const ta = modal.querySelector('#note-textarea');
  const errEl = modal.querySelector('#note-error');
  const saveBtn = modal.querySelector('#btn-note-save');
  const previewEl = modal.querySelector('#note-preview');
  const splitEl = modal.querySelector('#note-split');
  const viewBtn = modal.querySelector('#btn-note-view');
  const tagsInputEl = modal.querySelector('#note-tags-input');
  const aiBtn = modal.querySelector('#btn-note-ai');
  const pinBtn = modal.querySelector('#btn-note-pin');
  const fullscreenBtn = modal.querySelector('#btn-note-fullscreen');
  const exportBtn = modal.querySelector('#btn-note-export');
  const tocBtn = modal.querySelector('#btn-note-toc');
  const tocPane = modal.querySelector('#note-toc-pane');
  const tocList = modal.querySelector('#note-toc-list');
  const editorBody = modal.querySelector('#note-editor-body');
  const summaryRow = modal.querySelector('#note-summary-row');
  const summaryText = modal.querySelector('#note-summary-text');
  const draftHint = modal.querySelector('#note-draft-hint');

  // 反向链接（编辑已有笔记时加载"谁链接了我"，对齐落地页双链核心卖点）
  const backlinksRow = modal.querySelector('#note-backlinks-row');
  const backlinksEl = modal.querySelector('#note-backlinks');
  if (editPath && backlinksEl) {
    API.get('/api/files/backlinks?path=' + encodeURIComponent(editPath)).then(async (res) => {
      if (!res || !res.ok) return;
      const data = await res.json();
      const links = data.backlinks || [];
      if (!links.length) return;
      backlinksRow.style.display = '';
      backlinksEl.innerHTML = links.map((b) =>
        `<div class="backlink-item" data-path="${escapeHtml(b.path || '')}"><span class="backlink-name">${ICONS.note}${escapeHtml(stripExt(b.name || '') || '未命名笔记')}</span>${b.snippet ? `<span class="backlink-snippet">${escapeHtml(b.snippet)}</span>` : ''}</div>`
      ).join('');
      backlinksEl.querySelectorAll('.backlink-item').forEach((el) => {
        el.addEventListener('click', () => { const p = el.dataset.path; close(); openNoteEditor({ path: p, name: p.split('/').pop() }); });
      });
    }).catch(() => {});
  }

  const nsbWords = modal.querySelector('#nsb-words');
  const nsbChars = modal.querySelector('#nsb-chars');
  const nsbReading = modal.querySelector('#nsb-reading');
  const nsbMode = modal.querySelector('#nsb-mode');
  const nsbDraft = modal.querySelector('#nsb-draft');

 let saving = false;
 let autoSaveTimer = null;
 let isDirty = false;  // 是否有未保存到服务端的修改
 let lastAutoSaveTs = 0;
 let viewMode = loadPref('noteViewMode', 'split');
  let noteTags = [];
  let notePinned = false;
  let draftTimer = null;
  let previewTimer = null;
  let tocTimer = null;
  let lastSavedPath = '';
  let isFullscreen = false;
  let tocVisible = loadPref('noteTocVisible', false);

  // ---- 底部状态栏：字数 / 字符 / 阅读时间 / 模式 ----
  function countWords(text) {
    if (!text) return 0;
    const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
    const en = (text.replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, ' ').match(/[a-zA-Z0-9]+/g) || []).length;
    return cjk + en;
  }
  function updateStatusBar() {
    const text = ta.value;
    const words = countWords(text);
    const chars = text.length;
    if (nsbWords) nsbWords.textContent = words + ' 字';
    if (nsbChars) nsbChars.textContent = chars + ' 字符';
    if (nsbReading) nsbReading.textContent = words === 0 ? '不足 1 分钟' : '约 ' + Math.max(1, Math.round(words / 300)) + ' 分钟';
  }

  // ---- 视图模式：编辑 / 分屏 / 预览 ----
  function applyViewMode() {
    splitEl.classList.remove('mode-edit', 'mode-split', 'mode-preview');
    splitEl.classList.add('mode-' + viewMode);
    const labels = { edit: '仅编辑', split: '分屏', preview: '仅预览' };
    viewBtn.querySelector('span').textContent = labels[viewMode];
    if (nsbMode) nsbMode.textContent = labels[viewMode];
    if (viewMode !== 'edit') { updatePreview(); updateToc(); }
    updateStatusBar();
  }
  viewBtn.addEventListener('click', () => {
    viewMode = viewMode === 'edit' ? 'split' : viewMode === 'split' ? 'preview' : 'edit';
    savePref('noteViewMode', viewMode);
    applyViewMode();
  });

  // ---- 全屏模式 ----
  function applyFullscreen() {
    modal.classList.toggle('is-fullscreen', isFullscreen);
    fullscreenBtn.innerHTML = isFullscreen ? ICONS.fullscreenExit : ICONS.fullscreen;
  }
  fullscreenBtn.addEventListener('click', () => {
    isFullscreen = !isFullscreen;
    applyFullscreen();
  });

  // ---- TOC 侧边栏 ----
  function applyTocVisible() {
    editorBody.classList.toggle('toc-visible', tocVisible);
  }
  tocBtn.addEventListener('click', () => {
    tocVisible = !tocVisible;
    savePref('noteTocVisible', tocVisible);
    applyTocVisible();
    if (tocVisible) updateToc();
  });
  function updateToc() {
    if (viewMode === 'edit' || !tocVisible) return;
    const r = renderNoteMarkdown(ta.value);
    if (r.toc.length <= 1) { tocList.innerHTML = '<div class="note-toc-empty">添加标题以生成目录</div>'; return; }
    tocList.innerHTML = r.toc.map(t =>
      '<a class="note-toc-item toc-l' + t.level + '" data-toc-id="' + escapeHtml(t.id) + '">' + escapeHtml(t.text) + '</a>'
    ).join('');
    tocList.querySelectorAll('.note-toc-item').forEach(a => {
      a.addEventListener('click', () => {
        const el = previewEl.querySelector('#' + CSS.escape(a.dataset.tocId));
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  // ---- 导出 HTML ----
  exportBtn.addEventListener('click', () => {
    const r = renderNoteMarkdown(ta.value);
    const title = titleEl.value.trim() || '未命名笔记';
    const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github.min.css">
<style>
body{max-width:760px;margin:40px auto;padding:0 20px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Segoe UI',system-ui,sans-serif;line-height:1.8;color:#1F2329;font-size:16px}
h1{font-size:2em;border-bottom:2px solid #E5E6EB;padding-bottom:.3em}
h2{font-size:1.5em;border-bottom:1px solid #E5E6EB;padding-bottom:.3em}
h3{font-size:1.25em}
pre{background:#F2F3F5;padding:14px;border-radius:6px;overflow-x:auto}
code{font-family:ui-monospace,SF Mono,monospace}
p code,li code{background:#F2F3F5;padding:2px 6px;border-radius:3px;font-size:.9em}
blockquote{border-left:4px solid #3370FF;margin:0;padding:8px 16px;background:#E8F1FF;border-radius:0 6px 6px 0}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #E5E6EB;padding:8px 12px}
th{background:#F2F3F5}
img{max-width:100%;border-radius:6px}
a{color:#3370FF}
hr{border:none;border-top:1px solid #E5E6EB;margin:24px 0}
</style></head><body>
<h1>${escapeHtml(title)}</h1>
${r.html}
</body></html>`;
    const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = title.replace(/[\/\\:*?"<>|]/g, '_') + '.html';
    a.click();
    URL.revokeObjectURL(url);
    Toast.show('已导出 HTML', 'success');
  });

  // ---- 工具栏：插入 Markdown 语法 ----
  function wrapSelection(before, after, placeholder) {
    const start = ta.selectionStart, end = ta.selectionEnd;
    const sel = ta.value.slice(start, end) || placeholder || '';
    ta.value = ta.value.slice(0, start) + before + sel + (after || '') + ta.value.slice(end);
    const newStart = start + before.length;
    ta.selectionStart = newStart;
    ta.selectionEnd = newStart + sel.length;
    ta.focus(); updatePreview();
  }
  function insertLinePrefix(prefix) {
    const start = ta.selectionStart;
    const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
    ta.value = ta.value.slice(0, lineStart) + prefix + ta.value.slice(lineStart);
    ta.selectionStart = ta.selectionEnd = start + prefix.length;
    ta.focus(); updatePreview();
  }
  function insertBlock(text) {
    const start = ta.selectionStart;
    const prefix = (start > 0 && ta.value[start - 1] !== '\n') ? '\n' : '';
    ta.value = ta.value.slice(0, start) + prefix + text + ta.value.slice(start);
    ta.selectionStart = ta.selectionEnd = start + prefix.length + text.length;
    ta.focus(); updatePreview();
  }
  modal.querySelector('#note-toolbar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-md]'); if (!btn) return;
    e.preventDefault();
    switch (btn.dataset.md) {
      case 'bold': wrapSelection('**', '**', '加粗文字'); break;
      case 'italic': wrapSelection('*', '*', '斜体文字'); break;
      case 'strike': wrapSelection('~~', '~~', '删除文字'); break;
      case 'h1': insertLinePrefix('# '); break;
      case 'h2': insertLinePrefix('## '); break;
      case 'h3': insertLinePrefix('### '); break;
      case 'ul': insertLinePrefix('- '); break;
      case 'ol': insertLinePrefix('1. '); break;
      case 'quote': insertLinePrefix('> '); break;
      case 'code': wrapSelection('`', '`', '代码'); break;
      case 'codeblock': insertBlock('\n```\n代码\n```\n'); break;
      case 'math': wrapSelection('$$', '$$', 'E=mc^2'); break;
      case 'link': wrapSelection('[', '](https://)', '链接文字'); break;
      case 'image': insertImage(); break;
      case 'hr': insertBlock('\n---\n'); break;
      case 'task': insertLinePrefix('- [ ] '); break;
      case 'table': insertBlock('\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n'); break;
    }
  });

  // ---- 图片：粘贴 / 拖拽 / 工具栏 ----
  async function uploadImage(file) {
    const formData = new FormData();
    formData.append('file', file);
    const dir = editPath ? editPath.split('/').slice(0, -1).join('/') : (currentDir || '');
    const res = await API.postForm(`/api/files/upload?directory=${encodeURIComponent(dir)}&source=note`, formData);
    if (!res.ok) { const d = await res.json().catch(() => ({})); Toast.show(d.detail || '图片上传失败', 'error'); return null; }
    const data = await res.json();
    return `/api/files/preview?path=${encodeURIComponent(data.path)}`;
  }
  async function insertImage() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      if (!input.files.length) return;
      const url = await uploadImage(input.files[0]);
      if (url) wrapSelection('![', '](' + url + ')', '图片描述');
    };
    input.click();
  }
  ta.addEventListener('paste', async (e) => {
    const items = e.clipboardData && e.clipboardData.items ? e.clipboardData.items : [];
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile(); if (!file) continue;
        const url = await uploadImage(file);
        if (url) wrapSelection('![', '](' + url + ')', '图片描述');
        return;
      }
    }
  });
  ta.addEventListener('drop', async (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    const imgs = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (!imgs.length) return;
    e.preventDefault();
    for (const file of imgs) {
      const url = await uploadImage(file);
      if (url) wrapSelection('![', '](' + url + ')', '图片描述');
    }
  });
  ta.addEventListener('dragover', (e) => { if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) e.preventDefault(); });

  // ---- 实时预览（防抖）----
  function updatePreview() {
    if (viewMode === 'edit') return;
    const r = renderNoteMarkdown(ta.value);
    previewEl.innerHTML = r.html;
  }
  function updateTocDebounced() {
    clearTimeout(tocTimer);
    tocTimer = setTimeout(updateToc, 250);
  }
 ta.addEventListener('input', () => {
   clearTimeout(previewTimer);
   previewTimer = setTimeout(updatePreview, 200);
   updateTocDebounced();
   updateStatusBar();
   scheduleDraft();
   scheduleAutoSave();
 });
 // 标题输入也触发自动保存
 titleEl.addEventListener('input', () => { scheduleDraft(); scheduleAutoSave(); });

  // ---- 工具栏激活态：根据光标位置检测当前 Markdown 格式上下文 ----
  function updateToolbarActiveStates() {
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const after = ta.value.slice(pos);
    const lineStart = before.lastIndexOf('\n') + 1;
    const line = ta.value.slice(lineStart, pos) + after.slice(0, after.indexOf('\n') >= 0 ? after.indexOf('\n') : undefined);

    function isActive(md) {
      switch (md) {
        case 'bold': return /\*\*[^*]+\*\*$/.test(before.slice(before.lastIndexOf(' '))) || /\*\*\S/.test(after.slice(0, 2));
        case 'italic': return /(^|[^*])\*[^*]+\*$/.test(before.slice(Math.max(0, before.length - 30)));
        case 'strike': return /~~[^~]+~~$/.test(before.slice(Math.max(0, before.length - 30)));
        case 'h1': return /^#\s/.test(line);
        case 'h2': return /^##\s/.test(line);
        case 'h3': return /^###\s/.test(line);
        case 'ul': return /^[-*+]\s/.test(line);
        case 'ol': return /^\d+\.\s/.test(line);
        case 'quote': return /^>\s/.test(line);
        case 'task': return /^[-*+]\s\[[ x]\]\s/.test(line);
        default: return false;
      }
    }
    modal.querySelectorAll('#note-toolbar [data-md]').forEach(btn => {
      btn.classList.toggle('is-active', isActive(btn.dataset.md));
    });
  }
  ta.addEventListener('keyup', updateToolbarActiveStates);
  ta.addEventListener('click', updateToolbarActiveStates);
  ta.addEventListener('focus', updateToolbarActiveStates);

  // ---- 草稿自动保存 ----
  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 1500);
  }
 function saveDraft() {
   if (!ta.value.trim() && !titleEl.value.trim()) { localStorage.removeItem(draftKey); draftHint.textContent = ''; if (nsbDraft) nsbDraft.textContent = ''; return; }
   try {
     localStorage.setItem(draftKey, JSON.stringify({ title: titleEl.value, content: ta.value, tags: noteTags, pinned: notePinned, ts: Date.now() }));
     draftHint.textContent = '草稿已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
     if (nsbDraft) nsbDraft.textContent = '已保存草稿';
   } catch {}
 }
 function loadDraft() {
   try { const raw = localStorage.getItem(draftKey); return raw ? JSON.parse(raw) : null; } catch { return null; }
 }

  // ---- 自动保存到服务器 ----
  // 已有笔记（编辑模式）或新建笔记首次保存后，停止输入 3s 自动保存到服务端。
  // 新建笔记未保存前只走 localStorage 草稿，避免空标题/空内容创建垃圾笔记。
  function scheduleAutoSave() {
    isDirty = true;
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      if (!isDirty || saving) return;
      if (!ta.value.trim()) return;  // 空内容不自动保存
      doAutoSave();
    }, 3000);
  }
  async function doAutoSave() {
    const prev = saving;
    if (prev) return;
    const result = await doSave(true);  // silent save
    if (result) {
      isDirty = false;
      lastAutoSaveTs = Date.now();
      if (nsbDraft) nsbDraft.textContent = '已自动保存 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
  }
  // beforeunload：有未保存修改时提示（非 SPA 导航场景）
  function beforeUnloadGuard(e) {
    if (isDirty) { e.preventDefault(); e.returnValue = ''; }
  }
 window.addEventListener('beforeunload', beforeUnloadGuard);
  function closeEditor() {
   clearTimeout(autoSaveTimer);
   window.removeEventListener('beforeunload', beforeUnloadGuard);
   close();
 };

  // ---- 标签输入 ----
  function renderTags() {
    tagsInputEl.innerHTML = noteTags.map((t, i) =>
      '<span class="note-tag-chip">' + escapeHtml(t) + '<button class="note-tag-remove" data-idx="' + i + '">×</button></span>'
    ).join('') + '<input class="note-tag-field" placeholder="输入标签后回车" maxlength="30">';
    const field = tagsInputEl.querySelector('.note-tag-field');
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const v = field.value.trim();
        if (v && !noteTags.includes(v) && noteTags.length < 20) { noteTags.push(v); renderTags(); scheduleDraft(); }
        else field.value = '';
      } else if (e.key === 'Backspace' && !field.value && noteTags.length) {
        noteTags.pop(); renderTags(); scheduleDraft();
      }
    });
    tagsInputEl.querySelectorAll('.note-tag-remove').forEach(btn => {
      btn.addEventListener('click', () => { noteTags.splice(parseInt(btn.dataset.idx), 1); renderTags(); scheduleDraft(); });
    });
  }
  renderTags();

  // ---- 置顶 ----
  pinBtn.addEventListener('click', () => {
    notePinned = !notePinned;
    pinBtn.classList.toggle('is-active', notePinned);
  });

  // ---- AI 整理：摘要 + 标签 ----
  aiBtn.addEventListener('click', async () => {
    if (!ta.value.trim()) { Toast.show('请先输入内容', 'info'); return; }
    let targetPath = editPath;
    if (!targetPath) { const ok = await doSave(true); if (!ok) return; targetPath = lastSavedPath; }
    aiBtn.disabled = true; aiBtn.querySelector('span').textContent = '分析中…';
    try {
      const res = await API.post('/api/files/ai-enhance?path=' + encodeURIComponent(targetPath));
      if (!res.ok) { const d = await res.json().catch(() => ({})); Toast.show(d.detail || 'AI 整理失败', 'error'); return; }
      const data = await res.json();
      if (data.summary) { summaryRow.style.display = ''; summaryText.textContent = data.summary || ''; }
      if (data.tags && data.tags.length) {
        data.tags.forEach(t => { if (!noteTags.includes(t)) noteTags.push(t); });
        renderTags();
      }
      Toast.show('AI 整理完成', 'success');
    } catch (err) { Toast.show('AI 整理出错: ' + err.message, 'error'); }
    finally { aiBtn.disabled = false; aiBtn.querySelector('span').textContent = 'AI 整理'; }
  });

  // ---- 保存 ----
  async function doSave(silent) {
    if (saving) return false;
    const content = ta.value;
    if (!content.trim()) { if (!silent) errEl.textContent = '内容不能为空'; return false; }
    errEl.textContent = '';
    saving = true; saveBtn.disabled = true; saveBtn.textContent = '保存中…';
    try {
      const res = await API.post('/api/files/note', {
        name: titleEl.value.trim(), content,
        directory: currentDir || '', group_id: selectedGroup || '',
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); errEl.textContent = d.detail || '保存失败'; return false; }
      const data = await res.json();
      lastSavedPath = data.path;
      await Promise.all([
        API.put('/api/files/tags', { path: data.path, tags: noteTags }),
        API.put('/api/files/pin', { path: data.path, pinned: notePinned }),
      ]);
     localStorage.removeItem(draftKey);
     isDirty = false;
     if (!silent) Toast.show(data.guard_status === 'warning' ? '笔记已保存（Guard 提醒：可能含敏感内容）' : '笔记已保存', 'success');
      return true;
    } catch (err) { errEl.textContent = '保存失败: ' + (err.message || '未知错误'); return false; }
    finally { saving = false; saveBtn.disabled = false; saveBtn.textContent = '保存'; }
  }
 async function save() { const ok = await doSave(false); if (ok) { closeEditor(); loadFiles(); } }
 
  modal.querySelector('#btn-note-cancel').addEventListener('click', confirmClose);
  saveBtn.addEventListener('click', save);
 // 拦截弹窗 dismiss（遮罩/ESC）和取消按钮：有未保存修改时先确认
 async function confirmClose() {
   if (isDirty && ta.value.trim()) {
     const ok = await confirmDialog({ title: '有未保存的修改', message: '笔记内容尚未保存到服务器，确定关闭？', confirmText: '关闭', danger: true });
     if (!ok) return;
   }
   closeEditor();
 }

  // ---- 扩展快捷键体系 ----
  ta.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'Enter') { e.preventDefault(); save(); }
    else if (mod && e.key === 'b') { e.preventDefault(); wrapSelection('**', '**', '加粗文字'); }
    else if (mod && e.key === 'i') { e.preventDefault(); wrapSelection('*', '*', '斜体文字'); }
    else if (mod && e.key === 'k') { e.preventDefault(); wrapSelection('[', '](https://)', '链接文字'); }
    else if (mod && e.key === 'm') { e.preventDefault(); wrapSelection('$$', '$$', 'E=mc^2'); }
    else if (mod && e.key === 'p') { e.preventDefault(); viewBtn.click(); }
    else if (mod && e.key === 's') { e.preventDefault(); doSave(false).then(ok => { if (ok) loadFiles(); }); }
    else if (mod && e.key === '/') { e.preventDefault(); insertBlock('\n```\n代码\n```\n'); }
    else if (e.key === 'Escape' && isFullscreen) { e.stopPropagation(); isFullscreen = false; applyFullscreen(); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        // 逆序缩进：删除行首空格
        const start = ta.selectionStart;
        const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
        if (ta.value.slice(lineStart, lineStart + 2) === '  ') {
          ta.value = ta.value.slice(0, lineStart) + ta.value.slice(lineStart + 2);
          ta.selectionStart = ta.selectionEnd = start - 2;
        }
      } else {
        insertLinePrefix('  ');
      }
    }
  });
  // F11 切换全屏
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'F11') { e.preventDefault(); isFullscreen = !isFullscreen; applyFullscreen(); }
  });

  // ---- 初始化加载 ----
  applyViewMode();
  applyTocVisible();
  if (isEdit) {
    const draft = loadDraft();
    if (draft) {
      titleEl.value = draft.title || titleEl.value;
      ta.value = draft.content || '';
      noteTags = draft.tags || [];
      notePinned = !!draft.pinned;
      if (notePinned) pinBtn.classList.add('is-active');
      renderTags(); updatePreview(); updateToc();
      draftHint.innerHTML = '已恢复未保存草稿（' + new Date(draft.ts).toLocaleString('zh-CN') + '） <a href="#" id="draft-discard">丢弃草稿</a>';
      const disc = modal.querySelector('#draft-discard');
      if (disc) disc.addEventListener('click', (e) => { e.preventDefault(); localStorage.removeItem(draftKey); loadRemote(); });
    } else { await loadRemote(); }
  } else {
    const draft = loadDraft();
    if (draft) {
      titleEl.value = draft.title || '';
      ta.value = draft.content || '';
      noteTags = draft.tags || [];
      renderTags();
      draftHint.innerHTML = '已恢复未保存草稿（' + new Date(draft.ts).toLocaleString('zh-CN') + '） <a href="#" id="draft-discard">丢弃草稿</a>';
      const disc = modal.querySelector('#draft-discard');
      if (disc) disc.addEventListener('click', (e) => { e.preventDefault(); localStorage.removeItem(draftKey); titleEl.value = ''; ta.value = ''; noteTags = []; renderTags(); updatePreview(); draftHint.textContent = ''; });
    }
    titleEl.focus();
  }
  updatePreview();
  updateStatusBar();

  async function loadRemote() {
    try {
      const noteQuery = editFileId
        ? 'file_id=' + encodeURIComponent(editFileId)
        : 'path=' + encodeURIComponent(editPath);
      const res = await API.get('/api/files/note-content?' + noteQuery);
      if (!res.ok) { errEl.textContent = '加载笔记失败'; return; }
      const data = await res.json();
      ta.value = data.content || '';
      titleEl.value = stripExt(data.name || editName);
      noteTags = data.tags || [];
      notePinned = !!data.pinned;
      if (notePinned) pinBtn.classList.add('is-active');
      if (data.summary) { summaryRow.style.display = ''; summaryText.textContent = data.summary || ''; }
      noteTags = data.tags || [];
      notePinned = !!data.pinned;
      if (notePinned) pinBtn.classList.add('is-active');
      if (data.summary) { summaryRow.style.display = ''; summaryText.textContent = data.summary || ''; }
      renderTags(); updatePreview(); updateToc(); ta.focus();
    } catch (err) { errEl.textContent = '加载失败: ' + err.message; }
  }
}

// ============ Modal primitive ============

// ============ Wikilink navigation ============
async function handleWikilinkClick(el) {
  const name = el.dataset.wikilink;
  if (!name) return;
  try {
    const res = await API.get('/api/files/resolve-wikilink?name=' + encodeURIComponent(name));
    if (res.ok) {
      const data = await res.json();
      // 关闭当前预览弹窗（如果有）
      const preview = document.querySelector('.preview-overlay');
      if (preview) preview.remove();
      const isNote = /\.(md|markdown|mdown|mkd)$/i.test(data.name);
      if (isNote) {
        openNoteEditor({ path: data.path, fileId: data.file_id, name: data.name });
      } else {
        previewFile(data.path, data.name, { fileId: data.file_id });
      }
    } else {
      Toast.show('未找到笔记：' + name, 'info');
    }
  } catch { Toast.show('解析链接失败', 'error'); }
}

async function loadBacklinks(filePath, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  try {
    const res = await API.get('/api/files/backlinks?path=' + encodeURIComponent(filePath));
    if (!res.ok) return;
    const data = await res.json();
    const links = data.backlinks || [];
    if (!links.length) { container.innerHTML = ''; return; }
    container.innerHTML = `
      <div class="backlinks-title">反向链接 (${links.length})</div>
      <div class="backlinks-list">${links.map(bl => `
        <div class="backlink-item" data-backlink-path="${escapeHtml(bl.path)}" data-backlink-file-id="${escapeHtml(bl.file_id)}" data-backlink-name="${escapeHtml(bl.name)}">
          <span class="backlink-name">${ICONS.note}${escapeHtml(stripExt(bl.name) || '未命名笔记')}</span>
          ${bl.snippet ? `<span class="backlink-snippet">${escapeHtml(bl.snippet)}</span>` : ''}
        </div>
      `).join('')}</div>`;
    container.querySelectorAll('.backlink-item').forEach(el => {
      el.addEventListener('click', () => {
        const preview = document.querySelector('.preview-overlay');
        if (preview) preview.remove();
        const name = el.dataset.backlinkName;
        const fid = el.dataset.backlinkFileid;
        const isNote = /\.(md|markdown|mdown|mkd)$/i.test(name);
        if (isNote) openNoteEditor({ path: el.dataset.backlinkPath, fileId: fid, name });
        else previewFile(el.dataset.backlinkPath, name, { fileId: fid });
      });
    });
 } catch { /* 静默失败，不影响预览 */ }
}

// ============ Command Palette (Cmd+K) ============
let _cmdPaletteOpen = false;
function openCommandPalette() {
  if (_cmdPaletteOpen) return;
  _cmdPaletteOpen = true;
  const overlay = document.createElement('div');
  overlay.className = 'cmd-overlay';
  overlay.innerHTML = `
    <div class="cmd-palette">
      <div class="cmd-input-wrap">${ICONS.search}
        <input type="text" class="cmd-input" placeholder="搜索文件、笔记、标签…" autocomplete="off" spellcheck="false">
        <span class="cmd-hint">ESC 关闭</span>
      </div>
      <div class="cmd-results" id="cmd-results"></div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const input = overlay.querySelector('.cmd-input');
  const resultsEl = overlay.querySelector('#cmd-results');
  let results = [];
  let selectedIdx = 0;
  let lastQuery = '';
  let debounceTimer = null;

  function closePalette() {
    _cmdPaletteOpen = false;
    overlay.remove();
    document.body.style.overflow = '';
  }

  function hl(text, q) {
    if (!text) return '';
    const esc = escapeHtml(text);
    if (!q) return esc;
    const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return esc.replace(re, '<mark class="search-hit">$1</mark>');
  }

  function renderResults() {
    if (!results.length) {
      resultsEl.innerHTML = '<div class="cmd-empty">输入关键词搜索…</div>';
      return;
    }
    resultsEl.innerHTML = results.map((r, i) => {
      const isAction = r.type === 'action';
      const displayIcon = isAction ? (r.icon || ICONS.file) : getFileIcon(r.name || r.path || '', false).icon;
      const displayName = r.label || r.name || r.path || '';
      const detail = r.snippet ? hl(r.snippet, lastQuery) : escapeHtml(r.detail || '');
      const score = (!isAction && r.score != null) ? `<span class="cmd-item-score">${Number(r.score).toFixed(2)}</span>` : '';
      return `<div class="cmd-item${i === selectedIdx ? ' is-selected' : ''}" data-idx="${i}">
        <span class="cmd-item-icon">${displayIcon}</span>
        <span class="cmd-item-info">
          <span class="cmd-item-name">${escapeHtml(displayName)}</span>
          ${detail ? `<span class="cmd-item-detail">${detail}</span>` : ''}
        </span>
        ${score}
      </div>`;
    }).join('');
    resultsEl.querySelectorAll('.cmd-item').forEach(el => {
      el.addEventListener('click', () => { selectItem(parseInt(el.dataset.idx)); });
    });
    const sel = resultsEl.querySelector('.cmd-item.is-selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function selectItem(idx) {
    if (idx < 0 || idx >= results.length) return;
    const r = results[idx];
    closePalette();
    if (r.onClick) { r.onClick(); return; }
    const name = r.name || r.path || '';
    const isNote = /\.(md|markdown|mdown|mkd)$/i.test(name);
    if (isNote) openNoteEditor({ path: r.path || '', fileId: r.file_id || '', name });
    else previewFile(r.path, name, { fileId: r.file_id });
  }

  async function doSearch(q) {
    lastQuery = q.trim();
    if (!lastQuery) { results = getQuickActions(); selectedIdx = 0; renderResults(); return; }
    try {
      const res = await API.get('/api/files/search?q=' + encodeURIComponent(q) + '&limit=15');
      if (!res.ok) { results = []; renderResults(); return; }
      const data = await res.json();
      results = (data.results || []).map(r => ({ ...r, type: 'file' }));
      selectedIdx = 0;
      renderResults();
    } catch { results = []; renderResults(); }
  }

  function getQuickActions() {
    const actions = [
      { type: 'action', label: '新建笔记', icon: ICONS.note, detail: '创建新的 Markdown 笔记', onClick: () => { if (App.currentView !== 'files') App.navigate('files'); setTimeout(() => showNoteEditor(), 50); } },
      { type: 'action', label: '上传文件', icon: ICONS.upload, detail: '上传文件到当前目录', onClick: () => { if (App.currentView !== 'files') App.navigate('files'); setTimeout(() => document.getElementById('file-input')?.click(), 100); } },
      { type: 'action', label: 'AI 对话', icon: ICONS.chat, detail: '打开 AI 助手对话', onClick: () => App.navigate('chat') },
      { type: 'action', label: '传输助手', icon: ICONS.transfer, detail: '打开文件传输助手', onClick: () => App.navigate('transfer') },
      { type: 'action', label: '导出全部文件', icon: ICONS.export, detail: '下载所有文件为 ZIP', onClick: () => exportAllFiles() },
      { type: 'action', label: '设置', icon: ICONS.settings, detail: '打开设置页', onClick: () => App.navigate('settings') },
      { type: 'action', label: '快捷键帮助', icon: ICONS.keyboard, detail: '查看所有键盘快捷键', onClick: () => showShortcutHelp() },
    ];
    return actions.filter(a => !(a.label === 'AI 对话' && !(App.currentUser && App.currentUser.ai_enabled)));
  }

  input.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => doSearch(e.target.value), 200);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closePalette(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, results.length - 1); renderResults(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); renderResults(); }
    else if (e.key === 'Enter') { e.preventDefault(); selectItem(selectedIdx); }
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closePalette(); });
  results = getQuickActions();
  renderResults();
  setTimeout(() => input.focus(), 0);
}

// 统一弹窗生命周期：创建遮罩/弹窗、点击遮罩与 ESC 撤销、幂等 close、移除 keydown 监听。
// opts.width 设置 .modal 宽度；opts.onDismiss 在用户以遮罩点击/ESC 撤销时触发一次（用于 resolve 取消值）。
// 返回 { overlay, modal, close }；close 幂等，调用方填充 modal 内容并绑定按钮（按钮内自行 resolve 后调 close）。
function openModal({ width, onDismiss } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal';
  if (width) modal.style.width = typeof width === 'number' ? width + 'px' : width;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', escHandler);
    overlay.remove();
  }
  // 撤销路径（遮罩点击 / ESC）：先通知调用方（如 resolve(null)），再拆除弹窗
  function dismiss() {
    if (closed) return;
    if (onDismiss) onDismiss();
    close();
  }
  const escHandler = (e) => { if (e.key === 'Escape') dismiss(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
  document.addEventListener('keydown', escHandler);
  return { overlay, modal, close };
}

// ============ Input Dialog (prompt replacement) ============
function showInputDialog({ title, value = '', placeholder = '', maxlength = 50, confirmText = '确定', validate }) {
  return new Promise((resolve) => {
    const { modal, close } = openModal({ width: 420, onDismiss: () => resolve(null) });
    modal.innerHTML = `
      <h3></h3>
      <input type="text" class="form-input">
      <div class="input-error-msg"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary">取消</button>
        <button class="btn btn-primary"></button>
      </div>`;
    const input = modal.querySelector('input');
    const errEl = modal.querySelector('.input-error-msg');
    const confirmBtn = modal.querySelector('.btn-primary');
    // 用户可控值用属性赋值，避免引号破坏 HTML
    modal.querySelector('h3').textContent = title;
    input.placeholder = placeholder;
    input.maxLength = maxlength;
    input.value = value;
    confirmBtn.textContent = confirmText;

    const finish = (result) => { resolve(result); close(); };
    const check = () => syncInputValidation(input, errEl, confirmBtn, validate);
    input.addEventListener('input', check);
    input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') { e.preventDefault(); if (!confirmBtn.disabled) finish(input.value.trim()); }
    });
    modal.querySelector('.btn-secondary').addEventListener('click', () => finish(null));
    confirmBtn.addEventListener('click', () => { if (!confirmBtn.disabled) finish(input.value.trim()); });

    check();
    input.focus();
    input.select();
  });
}

// ============ Confirm Dialog (confirm replacement) ============
// 用自定义 modal 替代原生 confirm()，与项目其他弹窗风格一致；返回 Promise<boolean>
function confirmDialog({ title, message, confirmText = '确定', cancelText = '取消', danger = false, inputConfirm = '', inputConfirmLabel = '请输入上方确认词以继续' }) {
  return new Promise((resolve) => {
    const { modal, close } = openModal({ width: 420, onDismiss: () => resolve(false) });
    const hasInput = !!inputConfirm;
    modal.innerHTML = `
      <h3></h3>
      <p class="confirm-message"></p>
      ${hasInput ? `<p class="confirm-input-hint" style="font-size:13px;color:var(--text-secondary);margin:-6px 0 8px"></p>
        <input type="text" class="form-input confirm-input" placeholder="${escapeHtml(inputConfirmLabel)}" autocomplete="off">` : ''}
      <div class="modal-actions">
        <button class="btn btn-secondary"></button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" ${hasInput ? 'disabled' : ''}></button>
      </div>`;
    modal.querySelector('h3').textContent = title;
    modal.querySelector('.confirm-message').textContent = message; // textContent 防 XSS
    const cancelBtn = modal.querySelector('.btn-secondary');
    const okBtn = modal.querySelector(danger ? '.btn-danger' : '.btn-primary');
    cancelBtn.textContent = cancelText;
    okBtn.textContent = confirmText;
    cancelBtn.addEventListener('click', () => { resolve(false); close(); });
    okBtn.addEventListener('click', () => { resolve(true); close(); });
    if (hasInput) {
      const inp = modal.querySelector('.confirm-input');
      const hint = modal.querySelector('.confirm-input-hint');
      hint.innerHTML = `此操作不可逆,请输入 <code style="background:var(--bg-sunken);padding:1px 6px;border-radius:4px;font-family:var(--font-mono)">${escapeHtml(inputConfirm)}</code> 确认`;
      inp.addEventListener('input', () => { okBtn.disabled = inp.value !== inputConfirm; });
    }
    setTimeout(() => { (hasInput ? inp : okBtn).focus(); }, 0);
  });
}

// ============ Clipboard ============
// ============ Export (#11) ============
async function exportAllFiles(groupId = '') {
  Toast.show('正在打包导出…', 'info', 2000);
  try {
    const params = groupId ? '?group_id=' + encodeURIComponent(groupId) : '';
    const res = await API.get('/api/files/export' + params);
    if (!res || !res.ok) { Toast.show('导出失败', 'error'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cd = res.headers.get('content-disposition') || '';
    const m = cd.match(/filename="?(.+?)"?$/);
    a.download = m ? m[1] : 'export.zip';
    a.click();
    URL.revokeObjectURL(url);
    Toast.show('导出完成', 'success');
  } catch (err) { Toast.show('导出出错: ' + err.message, 'error'); }
}

// ============ Shortcut Help (#13) ============
function showShortcutHelp() {
  const { modal, close } = openModal({ width: 560, onDismiss: () => close() });
  const shortcuts = [
    { group: '全局', items: [
      { key: 'Ctrl/Cmd + K', desc: '打开快速搜索（命令面板）' },
      { key: 'Ctrl/Cmd + N', desc: '新建笔记' },
      { key: 'Ctrl/Cmd + E', desc: '跳转到文件列表' },
      { key: 'Ctrl/Cmd + ,', desc: '打开设置' },
      { key: 'Alt + 1/2/3/4', desc: '切换视图（传输/AI/文件/设置）' },
      { key: '?', desc: '显示此快捷键帮助' },
    ]},
    { group: '笔记编辑器', items: [
      { key: 'Ctrl/Cmd + S', desc: '保存（不关闭）' },
      { key: 'Ctrl/Cmd + Enter', desc: '保存并关闭' },
      { key: 'Ctrl/Cmd + B', desc: '加粗' },
      { key: 'Ctrl/Cmd + I', desc: '斜体' },
      { key: 'Ctrl/Cmd + K', desc: '插入链接' },
      { key: 'Ctrl/Cmd + M', desc: '插入数学公式' },
      { key: 'Ctrl/Cmd + P', desc: '切换编辑/分屏/预览' },
      { key: 'Ctrl/Cmd + \\', desc: '切换目录侧栏' },
      { key: 'Ctrl/Cmd + /', desc: '插入代码块' },
      { key: 'F11', desc: '全屏编辑' },
      { key: 'Tab / Shift+Tab', desc: '缩进 / 取消缩进' },
    ]},
    { group: '笔记语法', items: [
      { key: '[[笔记名]]', desc: '插入笔记间双向链接' },
      { key: '[[笔记名|别名]]', desc: '带别名的双向链接' },
    ]},
  ];
  modal.innerHTML = `
    <h3>键盘快捷键</h3>
    <div class="shortcut-help-body">
      ${shortcuts.map(s => `
        <div class="shortcut-group">
          <div class="shortcut-group-title">${escapeHtml(s.group)}</div>
          ${s.items.map(it => `
            <div class="shortcut-row">
              <kbd class="shortcut-key">${escapeHtml(it.key)}</kbd>
              <span class="shortcut-desc">${escapeHtml(it.desc)}</span>
            </div>
          `).join('')}
        </div>
      `).join('')}
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" id="btn-close-shortcuts">知道了</button>
    </div>`;
  modal.querySelector('#btn-close-shortcuts').addEventListener('click', close);
}

// ============ Global Keyboard Shortcuts (#13) ============
function setupGlobalShortcuts() {
  document.addEventListener('keydown', (e) => {
    const hasModal = document.querySelector('.modal-overlay, .preview-overlay, .cmd-overlay');
    if (hasModal) return;
    const tag = (e.target.tagName || '').toLowerCase();
    const inInput = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key === 'k') { e.preventDefault(); if (!_cmdPaletteOpen) openCommandPalette(); return; }
    if (inInput && !mod) return;

    if (mod && e.key === 'n') {
      e.preventDefault();
      if (App.currentView !== 'files') App.navigate('files');
      setTimeout(() => showNoteEditor(), 50);
      return;
    }
    if (mod && e.key === 'e') { e.preventDefault(); App.navigate('files'); return; }
    if (mod && e.key === ',') { e.preventDefault(); App.navigate('settings'); return; }
    if (e.altKey && !mod) {
      const views = ['transfer', 'chat', 'files', 'settings'];
      const idx = parseInt(e.key) - 1;
      if (idx >= 0 && idx < views.length) {
        e.preventDefault();
        if (views[idx] === 'chat' && !(App.currentUser && App.currentUser.ai_enabled)) return;
        App.navigate(views[idx]);
        return;
      }
    }
    if (!inInput && !mod && e.shiftKey && e.key === '/') { e.preventDefault(); showShortcutHelp(); return; }
  });
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  // 回退：临时 textarea + execCommand（非 HTTPS 或旧浏览器）
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

function validateGroupName(name, { excludeId } = {}) {
  if (!name) return { ok: false, msg: '' };
  if (name.length > 50) return { ok: false, msg: '名称不能超过 50 个字符' };
  if (userGroups.some(g => g.name === name && g.id !== excludeId)) return { ok: false, msg: '已有同名分组' };
  return { ok: true };
}

function syncInputValidation(input, errEl, btn, validate) {
  const v = input.value.trim();
  if (!v) { errEl.textContent = ''; input.classList.remove('error'); btn.disabled = true; return; }
  if (validate) {
    const r = validate(v);
    if (!r.ok) { errEl.textContent = r.msg || ''; input.classList.add('error'); btn.disabled = true; return; }
  }
  errEl.textContent = ''; input.classList.remove('error'); btn.disabled = false;
}

// ============ Groups ============
async function loadGroups() {
  try {
    const res = await API.get('/api/files/groups');
    const data = await res.json();
    userGroups = data.groups || [];
  } catch { userGroups = []; }
  return userGroups;
}

// 档案室分组侧栏：左侧持久分组导航（对齐落地页 Hero 的档案室侧栏）
function renderGroupsSidebar() {
  const el = document.getElementById('files-groups');
  if (!el) return;
  const allActive = !selectedGroup && !currentDir && !searchQuery;
  const allItem = `<button class="group-item${allActive ? ' active' : ''}" data-action="group-all" aria-label="全部文件">${ICONS.files}<span class="group-item-name">全部文件</span></button>`;
  const groupItems = userGroups.map(g =>
    `<button class="group-item${selectedGroup === g.id ? ' active' : ''}" data-gid="${escapeHtml(g.id)}" aria-label="分组 ${escapeHtml(g.name)}"><span class="group-item-name">${escapeHtml(g.name)}</span><span class="group-count">${g.file_count || 0}</span></button>`
  ).join('');
  el.innerHTML = `<div class="group-item-h">档案室</div>${allItem}${groupItems}`;
  el.querySelectorAll('.group-item').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.action === 'group-all') { selectedGroup = ''; currentDir = ''; }
      else { selectedGroup = btn.dataset.gid || ''; currentDir = ''; }
      searchQuery = '';
      const si = document.getElementById('search-input'); if (si) si.value = '';
      loadFiles();
    });
  });
}

function showGroupManager() {
  if (document.querySelector('[data-group-manager]')) return; // 避免重复打开导致重复 id
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.groupManager = '1';
  overlay.innerHTML = `
    <div class="modal" style="width:480px">
      <h3>分组管理</h3>
      <div style="margin-bottom:16px">
        <div style="display:flex;gap:8px">
          <input type="text" id="new-group-name" class="form-input" placeholder="新分组名称" maxlength="50" style="flex:1">
          <button class="btn btn-primary" id="btn-create-group" disabled>${ICONS.add} 创建</button>
        </div>
        <div class="input-error-msg" id="new-group-error"></div>
      </div>
      <div id="group-list" style="max-height:320px;overflow:auto">加载中...</div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="btn-close-groups">关闭</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const input = document.getElementById('new-group-name');
  const createBtn = document.getElementById('btn-create-group');
  const errEl = document.getElementById('new-group-error');
  const checkNewGroup = () => syncInputValidation(input, errEl, createBtn, validateGroupName);
  input.addEventListener('input', checkNewGroup);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  createBtn.addEventListener('click', createGroup);
  input.addEventListener('keydown', (e) => { if (e.isComposing || e.keyCode === 229) return; if (e.key === 'Enter' && !createBtn.disabled) createGroup(); });
  document.getElementById('btn-close-groups').addEventListener('click', () => overlay.remove());
  document.getElementById('group-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const g = userGroups.find(x => x.id === btn.dataset.id);
    if (!g) return;
    if (btn.dataset.action === 'rename') renameGroup(g.id, g.name);
    else if (btn.dataset.action === 'delete') deleteGroup(g.id, g.name);
  });
  renderGroupManagerList();
  input.focus();
}

function renderGroupManagerList() {
  const el = document.getElementById('group-list');
  if (!el) return;
  if (!userGroups.length) {
    el.innerHTML = '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:16px 0">还没有分组，在上方创建一个吧</p>';
    return;
  }
  el.innerHTML = `<table class="data-table"><thead><tr><th>名称</th><th>文件数</th><th>大小</th><th>操作</th></tr></thead><tbody>
    ${userGroups.map(g => `<tr>
      <td><strong>${escapeHtml(g.name)}</strong></td>
      <td>${g.file_count}</td>
      <td>${formatSize(g.size)}</td>
      <td>
        <button class="btn btn-secondary btn-sm" data-action="rename" data-id="${escapeHtml(g.id)}" aria-label="重命名分组 ${escapeHtml(g.name)}">重命名</button>
        <button class="btn btn-danger btn-sm" data-action="delete" data-id="${escapeHtml(g.id)}" aria-label="删除分组 ${escapeHtml(g.name)}">删除</button>
      </td>
    </tr>`).join('')}
  </tbody></table>`;
}

async function createGroup() {
  const input = document.getElementById('new-group-name');
  const createBtn = document.getElementById('btn-create-group');
  const errEl = document.getElementById('new-group-error');
  const name = input.value.trim();
  if (!name || createBtn.disabled) return;
  createBtn.disabled = true;
  try {
    const res = await API.post('/api/files/groups', { name });
    if (!res.ok) { const d = await res.json(); Toast.show(d.detail || '创建失败', 'error'); return; }
    input.value = '';
    Toast.show('分组已创建', 'success');
    await loadGroups();
    renderGroupManagerList();
    input.focus();
  } catch { Toast.show('创建失败', 'error'); }
  finally { syncInputValidation(input, errEl, createBtn, validateGroupName); }
}

async function renameGroup(id, oldName) {
  const name = await showInputDialog({
    title: '重命名分组',
    value: oldName,
    confirmText: '保存',
    validate: v => validateGroupName(v, { excludeId: id }),
  });
  if (name === null || name === oldName.trim()) return;
  try {
    const res = await API.put(`/api/files/groups/${id}`, { name });
    if (!res.ok) { const d = await res.json(); Toast.show(d.detail || '重命名失败', 'error'); return; }
    Toast.show('已重命名', 'success');
    await loadGroups();
    renderGroupManagerList();
    loadFiles();
  } catch { Toast.show('重命名失败', 'error'); }
}

async function deleteGroup(id, name) {
  if (!await confirmDialog({ title: '删除分组', message: `确定删除分组「${name}」？分组内的文件不会被删除，仅移出分组。`, confirmText: '删除', danger: true })) return;
  try {
    const res = await API.del(`/api/files/groups/${id}`);
    if (!res.ok) { const d = await res.json(); Toast.show(d.detail || '删除失败', 'error'); return; }
    Toast.show('分组已删除', 'success');
    if (selectedGroup === id) selectedGroup = '';
    await loadGroups();
    renderGroupManagerList();
    loadFiles();
  } catch { Toast.show('删除失败', 'error'); }
}

function showGroupFolderMenu(eventOrX, y, gid, name) {
  let x;
  if (eventOrX && eventOrX.clientX !== undefined) { x = eventOrX.clientX; y = eventOrX.clientY; }
  else { x = eventOrX; }
  const items = [
    { action: 'open', label: '打开', icon: ICONS.folder, onClick: () => {
      selectedGroup = gid; currentDir = ''; searchQuery = '';
      const si = document.getElementById('search-input'); if (si) si.value = '';
      loadFiles();
    }},
    { action: 'rename', label: '重命名', icon: ICONS.rename, onClick: () => renameGroup(gid, name) },
    { action: 'delete', label: '删除分组', icon: ICONS.trash, danger: true, onClick: () => deleteGroup(gid, name) },
  ];
  showContextMenu(x, y, items);
}

function showMoveToGroupMenu(x, y, path) {
  const items = [];
  if (userGroups.length) {
    userGroups.forEach(g => {
      items.push({ action: 'g_' + g.id, label: g.name, icon: ICONS.folder, onClick: async () => {
        const r = await moveFileToGroup(path, g.id, g.name);
        if (r.ok) Toast.show(`已移入「${g.name}」`, 'success'); else Toast.show(r.detail, 'error');
      }});
    });
    items.push({ divider: true });
  }
  items.push({ action: 'new_group', label: '新建分组…', icon: ICONS.add, onClick: () => quickCreateGroupAndMove(path) });
  items.push({ action: 'remove', label: '移出分组', icon: ICONS.close, onClick: async () => {
    const r = await moveFileToGroup(path, '', '');
    if (r.ok) Toast.show('已移出分组', 'success'); else Toast.show(r.detail, 'error');
  }});
  showContextMenu(x, y, items);
}

// 纯操作：执行移动并刷新列表，返回 { ok, detail }；由调用方决定如何提示
async function moveFileToGroup(path, groupId, groupName) {
  try {
    const res = await API.post(`/api/files/move-to-group?path=${encodeURIComponent(path)}&group_id=${encodeURIComponent(groupId)}`);
    if (!res.ok) { let detail = '移动失败'; try { detail = (await res.json()).detail || detail; } catch {} return { ok: false, detail }; }
    // 必须先 loadGroups 再 loadFiles：根目录渲染依赖 userGroups（分组文件夹的文件数/大小），并行会导致旧计数
    await loadGroups();
    loadFiles();
    return { ok: true };
  } catch { return { ok: false, detail: '移动失败' }; }
}

async function quickCreateGroupAndMove(path) {
  const fileName = path.split('/').pop();
  const name = await showInputDialog({
    title: `新建分组并移入「${fileName}」`,
    placeholder: '新分组名称',
    confirmText: '创建并移入',
    validate: v => validateGroupName(v),
  });
  if (name === null) return;
  try {
    const res = await API.post('/api/files/groups', { name });
    if (!res.ok) { const d = await res.json(); Toast.show(d.detail || '创建失败', 'error'); return; }
    const data = await res.json();
    const r = await moveFileToGroup(path, data.id, data.name);
    Toast.show(r.ok ? `已创建「${data.name}」并移入文件` : `已创建「${data.name}」，移动失败（${r.detail}）`, r.ok ? 'success' : 'warning');
  } catch { Toast.show('创建失败', 'error'); }
}

function renderBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  if (!bc) return;
  // 分组视图：主目录 / [分组名]
  if (selectedGroup) {
    const g = userGroups.find(x => x.id === selectedGroup);
    const name = g ? g.name : '分组';
    bc.innerHTML = `<span class="breadcrumb-item" data-dir="" data-action="root">主目录</span><span class="breadcrumb-sep">/</span><span class="breadcrumb-item current">${ICONS.groups}${escapeHtml(name)}</span>`;
    bc.querySelectorAll('.breadcrumb-item').forEach(el => {
      el.addEventListener('click', () => {
        if (el.dataset.action === 'root') {
          selectedGroup = '';
          currentDir = '';
          loadFiles();
        }
      });
    });
    return;
  }
  // 目录视图
  const parts = currentDir ? currentDir.split('/') : [];
  let html = `<span class="breadcrumb-item${!currentDir ? ' current' : ''}" data-dir="">主目录</span>`;
  let path = '';
  for (let i = 0; i < parts.length; i++) {
    path += (i > 0 ? '/' : '') + parts[i];
    const isLast = i === parts.length - 1;
    html += `<span class="breadcrumb-sep">/</span><span class="breadcrumb-item${isLast ? ' current' : ''}" data-dir="${path}">${escapeHtml(parts[i])}</span>`;
  }
  bc.innerHTML = html;
  bc.querySelectorAll('.breadcrumb-item').forEach(el => {
    el.addEventListener('click', () => {
      currentDir = el.dataset.dir; selectedGroup = ''; searchQuery = ''; selectedTag = '';
      const si = document.getElementById('search-input');
      if (si) si.value = '';
      loadFiles();
    });
  });
  // 标签筛选指示器
  if (selectedTag) {
    bc.innerHTML += `<span class="breadcrumb-sep">·</span><span class="breadcrumb-tag-filter">#${escapeHtml(selectedTag)} <a href="#" id="bc-clear-tag">×</a></span>`;
    const clr = document.getElementById('bc-clear-tag');
    if (clr) clr.addEventListener('click', (e) => { e.preventDefault(); selectedTag = ''; loadFiles(); });
  }
}

async function loadFiles() {
  const content = document.getElementById('file-content');
  if (!content) return;
  const fail = (msg) => renderErrorState(content, msg, () => loadFiles());
  // 搜索结果不走 renderFileList；若处于选择模式则先退出，避免选中态错乱
  if (searchQuery && fileSelectMode) { fileSelectMode = false; fileSelection.clear(); updateBatchBar(); }
  if (searchQuery) {
    content.innerHTML = '<div class="empty-state">搜索中...</div>';
    try {
      const res = await API.get(`/api/files/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      renderSearchResults(data.results || []);
    } catch { fail('搜索失败'); }
  } else if (selectedGroup) {
    // 分组视图：展示该分组全部文件
    renderBreadcrumb();
    content.innerHTML = skeletonHTML(6);
    try {
      const res = await API.get(`/api/files/list?group_id=${encodeURIComponent(selectedGroup)}`);
      const data = await res.json();
      renderFileList(data.items || []);
    } catch { fail('加载失败'); }
  } else {
    renderBreadcrumb();
    content.innerHTML = skeletonHTML(6);
    try {
      const res = await API.get(`/api/files/list?directory=${encodeURIComponent(currentDir)}`);
      const data = await res.json();
      let items = data.items || [];
      // 标签筛选：在前端过滤（标签数据已随 list 返回）
      if (selectedTag) items = items.filter(i => i.tags && i.tags.includes(selectedTag));
      renderFileList(items);
    } catch { fail('加载失败'); }
  }
}

function sortItems(items) {
  const { key, dir } = fileSort;
  const mul = dir === 'desc' ? -1 : 1;
  return [...items].sort((a, b) => {
    // 置顶项始终排在最前（不受排序方向影响）
    const pa = a.pinned ? 1 : 0, pb = b.pinned ? 1 : 0;
    if (pa !== pb) return pb - pa;
    if (key === 'size') return mul * ((a.size || 0) - (b.size || 0));
    if (key === 'modified') return mul * ((a.modified || 0) - (b.modified || 0));
    return mul * String(a.name || '').localeCompare(String(b.name || ''), 'zh');
  });
}

function renderFileList(items) {
  currentFileItems = items;
  renderGroupsSidebar();
  const content = document.getElementById('file-content');
  if (!content) return;
  // 分组已迁移到左侧档案室侧栏（renderGroupsSidebar）；列表只显示文件/目录
  const isRoot = !currentDir && !selectedGroup && !searchQuery;
  const displayItems = sortItems(items);

  const realItems = displayItems.filter(i => !i.is_group);
  const bytes = displayItems.filter(i => !i.is_dir && !i.is_group).reduce((s, i) => s + (i.size || 0), 0);
  const cntEl = document.getElementById('files-count');
  if (cntEl) cntEl.textContent = realItems.length ? `${realItems.length} 项${bytes ? ' · ' + formatSize(bytes) : ''}` : '';

  if (!displayItems.length) {
    let card;
    if (selectedGroup) {
      card = `<div class="empty-card" role="status">
        <div class="empty-illust">${ICONS.groups}</div>
        <div class="empty-title">该分组暂无文件</div>
        <div class="empty-desc">点击下方按钮将文件加入「${escapeHtml(selectedGroup ? '' : '')}」分组</div>
        <div class="empty-actions"><button class="btn btn-primary" id="btn-empty-upload">${ICONS.upload}<span>上传文件到本组</span></button></div>
      </div>`;
    } else if (isRoot) {
      card = `<div class="empty-card" role="status">
        <div class="empty-illust">${ICONS.files}</div>
        <div class="empty-title">还没有分组或文件</div>
        <div class="empty-desc">上传文件开始归档，或先写一篇笔记记录灵感</div>
        <div class="empty-actions"><button class="btn btn-primary" id="btn-empty-upload">${ICONS.upload}<span>上传文件</span></button><button class="btn btn-secondary" id="btn-empty-note">${ICONS.note}<span>新建笔记</span></button></div>
      </div>`;
    } else {
      card = `<div class="empty-card" role="status">
        <div class="empty-illust">${ICONS.folder}</div>
        <div class="empty-title">这个目录是空的</div>
        <div class="empty-desc">拖拽文件到这里，或点击下方按钮上传</div>
        <div class="empty-actions"><button class="btn btn-primary" id="btn-empty-upload">${ICONS.upload}<span>上传文件</span></button></div>
      </div>`;
    }
    content.innerHTML = `<div class="file-table">${card}</div>`;
    const up = content.querySelector('#btn-empty-upload');
    if (up) up.addEventListener('click', () => document.getElementById('file-input').click());
    const note = content.querySelector('#btn-empty-note');
    if (note) note.addEventListener('click', showNoteEditor);
    updateBatchBar();
    return;
  }
  if (fileView === 'grid') {
    content.innerHTML = `<div class="file-grid">${displayItems.map(item => fileItemHTML(item)).join('')}</div>`;
  } else {
    content.innerHTML = `<div class="file-table">
      <div class="file-table-head">
        <span class="file-cell file-cell--name">名称</span>
        <span class="file-cell file-cell--size">大小</span>
        <span class="file-cell file-cell--date">修改</span>
        <span class="file-cell file-cell--actions"></span>
      </div>${displayItems.map(item => fileItemHTML(item)).join('')}
    </div>`;
  }
  bindFileItems(content);
  updateBatchBar();
}

// badge 行折叠：pin + group + guard + tags 最多共 3 个，超出为 +N；避免一行被徽章挤爆（P0 L0.1 / S9）
function _badgeCap(pinHtml, groupHtml, guardHtml, tagsHtml, _isDir) {
  const parts = [pinHtml, groupHtml, guardHtml].filter(Boolean);
  const tags = tagsHtml ? [tagsHtml] : [];
  if (parts.length <= 2) return parts.concat(tags).join('');
  const shown = parts.slice(0, 2);
  const rest = parts.length - 2 + (tagsHtml ? 1 : 0);
  return shown.join('') + `<span class="badge badge-more" title="更多徽章">+${rest}</span>` + (tagsHtml ? tagsHtml : '');
}

function _sourceBadge(source) {
  const map = { sync: '同步', note: '笔记', transfer: '传输' };
  const label = map[String(source || '').toLowerCase()];
  return label ? `<span class="source-badge">${label}</span>` : '';
}

// 存储配额环 SVG（顶部 header 右端，P0 F）
function _quotaRing(usedMb, quotaMb) {
  if (!quotaMb || quotaMb <= 0) return '';
  const pct = Math.min(100, Math.round((usedMb / quotaMb) * 100));
  const R = 15, C = 2 * Math.PI * R;
  const offset = C * (1 - pct / 100);
  const cls = pct >= 90 ? 'is-danger' : pct >= 70 ? 'is-warn' : '';
  return `<div class="quota-ring ${cls}" title="${usedMb.toFixed(1)}/${quota_mb_mb(quotaMb)} (${pct}%)" aria-label="存储已用 ${pct}%">
    <svg viewBox="0 0 36 36"><circle class="q-bg" cx="18" cy="18" r="${R}"/><circle class="q-fg" cx="18" cy="18" r="${R}" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"/></svg>
    <div class="q-text">${pct}%</div>
  </div>`;
}
function quota_mb_mb(mb) { return mb >= 1024 ? (mb / 1024).toFixed(1) + 'GB' : mb + 'MB'; }

function fileItemHTML(item) {
  const isSel = fileSelection.has(item.path);
  const tb = fileTypeBadge(item.name);
  if (item.is_group) {
    const cnt = item.file_count > 0 ? `${item.file_count} 项` : '空';
    if (fileView === 'grid') {
      return `<div class="file-card group-folder" data-gid="${escapeHtml(item.group_id)}" data-isgroup="true" data-name="${escapeHtml(item.name)}">
        <div class="file-icon folder">${ICONS.groups}</div>
        <div class="file-name">${escapeHtml(item.name)}</div>
        <div class="file-card-meta"><span class="badge badge-group">${cnt}</span></div>
      </div>`;
    }
    return `<div class="file-row group-folder" data-gid="${escapeHtml(item.group_id)}" data-isgroup="true" data-name="${escapeHtml(item.name)}" role="row" aria-label="分组 ${escapeHtml(item.name)}">
      <div class="file-cell file-cell--name" role="gridcell">
        <span class="file-icon folder">${ICONS.groups}</span>
        <span class="file-name">${escapeHtml(item.name)}</span>
      </div>
      <div class="file-cell file-cell--type" role="gridcell"><span class="type-badge type-md">分组</span></div>
      <div class="file-cell file-cell--size" role="gridcell">${cnt}</div>
      <div class="file-cell file-cell--date" role="gridcell">—</div>
      <div class="file-cell file-cell--actions file-actions" role="gridcell"><button class="icon-btn" data-action="group-menu" title="更多" aria-label="分组更多操作">${ICONS.more}</button></div>
    </div>`;
  }
  const icon = getFileIcon(item.name, item.is_dir);
  const groupHtml = (!selectedGroup && item.group_name) ? `<span class="badge badge-group">${escapeHtml(item.group_name)}</span>` : '';
  const guardHtml = item.guard_status === 'warning' ? '<span class="badge badge-warning">注意</span>' : item.guard_status === 'blocked' ? '<span class="badge badge-danger">敏感</span>' : '';
  const pinHtml = item.pinned ? '<span class="badge badge-pin" title="已置顶">★</span>' : '';
  const tagsHtml = (item.tags && item.tags.length) ? item.tags.slice(0, 3).map(t => `<span class="badge badge-tag">#${escapeHtml(t)}</span>`).join('') + (item.tags.length > 3 ? `<span class="badge badge-tag">+${item.tags.length - 3}</span>` : '') : '';
  const isNote = /\.(md|markdown|mdown|mkd)$/i.test(item.name);
  const checkHtml = (fileSelectMode && !item.is_dir) ? `<input type="checkbox" class="file-check ${isSel ? 'is-checked' : ''}" data-action="toggle-select" role="checkbox" aria-checked="${isSel ? 'true' : 'false'}" aria-label="选择 ${escapeHtml(item.name)}" ${isSel ? 'checked' : ''}>` : '';
  const selCls = isSel ? ' is-selected' : '';
  const ariaLabel = `${escapeHtml(item.name)}, 类型 ${tb.label}${item.is_dir ? ' 文件夹' : ''}${item.pinned ? ' 已置顶' : ''}`;
  const snippetHtml = item._snippetHighlight ? `<div class="file-snippet">${item._snippetHighlight}</div>` : '';
  if (fileView === 'grid') {
    return `<div class="file-card${selCls}${item.pinned ? ' is-pinned' : ''}" data-path="${escapeHtml(item.path)}" data-isdir="${item.is_dir}" data-name="${escapeHtml(item.name)}" data-file-id="${escapeHtml(item._fileId || item.file_id || '')}" data-pinned="${item.pinned ? 'true' : 'false'}" role="gridcell" aria-label="${ariaLabel}">
      ${checkHtml}
      ${pinHtml ? `<span class="file-card-pin">${ICONS.pin}</span>` : ''}
      <div class="file-icon ${icon.cls}">${icon.icon}</div>
      <div class="file-name">${escapeHtml(item.name)}</div>
      <div class="file-card-meta"><span>${item.is_dir ? '文件夹' : formatSize(item.size)}</span>${_sourceBadge(item.source)}${tagsHtml}</div>
    </div>`;
  }
  return `<div class="file-row${selCls}${item.pinned ? ' is-pinned' : ''}" data-path="${escapeHtml(item.path)}" data-isdir="${item.is_dir}" data-name="${escapeHtml(item.name)}" data-file-id="${escapeHtml(item._fileId || item.file_id || '')}" data-pinned="${item.pinned ? 'true' : 'false'}" role="row" aria-label="${ariaLabel}">
    <div class="file-cell file-cell--name" role="gridcell">
      ${checkHtml}
      <span class="file-icon ${icon.cls}">${icon.icon}</span>
      <div class="file-name-info"><span class="file-name">${escapeHtml(item.name)}</span>${snippetHtml}</div>
      ${_badgeCap(pinHtml, groupHtml, guardHtml, tagsHtml, item.is_dir)}
    </div>
    <div class="file-cell file-cell--type" role="gridcell">${item.is_dir ? `<span class="type-badge type-md">文件夹</span>` : `<span class="type-badge ${tb.cls}" title="${tb.label}">${tb.label}</span>`}</div>
    <div class="file-cell file-cell--size" role="gridcell">${item.is_dir ? '-' : formatSize(item.size)}</div>
    <div class="file-cell file-cell--date" role="gridcell">${item.modified ? formatDate(item.modified) : '-'}</div>
    <div class="file-cell file-cell--actions file-actions" role="gridcell">
      ${isNote ? `<button class="icon-btn" data-action="edit" title="编辑" aria-label="编辑 ${escapeHtml(item.name)}">${ICONS.edit}</button>` : ''}
      ${!item.is_dir ? `<button class="icon-btn" data-action="preview" title="预览" aria-label="预览 ${escapeHtml(item.name)}">${ICONS.eye}</button>` : ''}
      ${!item.is_dir ? `<button class="icon-btn" data-action="download" title="下载" aria-label="下载 ${escapeHtml(item.name)}">${ICONS.download}</button>` : ''}
      <button class="icon-btn danger" data-action="delete" title="删除" aria-label="删除 ${escapeHtml(item.name)}">${ICONS.trash}</button>
      <button class="icon-btn" data-action="menu" title="更多" aria-label="${escapeHtml(item.name)} 更多操作">${ICONS.more}</button>
    </div>
  </div>`;
}

function bindFileItems(content) {
  content.querySelectorAll('.file-row, .file-card').forEach(row => {
    row.addEventListener('click', () => {
      // 选择模式：仅普通文件可点选切换；分组/目录不参与多选也不导航
      if (fileSelectMode) {
        if (row.dataset.isgroup !== 'true' && row.dataset.isdir !== 'true') toggleSelect(row.dataset.path);
        return;
      }
     if (row.dataset.isgroup === 'true') {
        selectedGroup = row.dataset.gid; currentDir = ''; searchQuery = ''; selectedTag = '';
       const si = document.getElementById('search-input'); if (si) si.value = '';
       loadFiles();
     } else if (row.dataset.isdir === 'true') {
        currentDir = row.dataset.path; selectedGroup = ''; searchQuery = ''; selectedTag = '';
       const si = document.getElementById('search-input'); if (si) si.value = '';
       loadFiles();
      } else {
        previewFile(row.dataset.path, row.dataset.name);
      }
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (row.dataset.isgroup === 'true') showGroupFolderMenu(e.clientX, e.clientY, row.dataset.gid, row.dataset.name);
      else showFileMenu(e, row.dataset.path, row.dataset.name, row.dataset.isdir === 'true');
    });
    row.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const a = btn.dataset.action;
        const { path, name } = row.dataset;
        if (a === 'toggle-select') { toggleSelect(path); return; }
        if (a === 'preview') previewFile(path, name);
        else if (a === 'edit') openNoteEditor({ path, name });
        else if (a === 'rename') renameFile(path, name);
        else if (a === 'toggle-pin') togglePinFile(path);
        else if (a === 'tags') editFileTags(path, name);
        else if (a === 'download') downloadFile(path);
        else if (a === 'delete') deleteFile(path);
        else if (a === 'menu') showFileMenu(e, path, name, row.dataset.isdir === 'true');
        else if (a === 'group-menu') showGroupFolderMenu(e, e.clientY, row.dataset.gid, name);
      });
    });
  });
}

function toggleSelect(path) {
  // 增量更新单行选中态，避免整表重渲（大目录下每个勾选都 O(N)）
  const had = fileSelection.has(path);
  if (had) fileSelection.delete(path); else fileSelection.add(path);
  const sel = `.file-row[data-path="${CSS.escape(path)}"], .file-card[data-path="${CSS.escape(path)}"]`;
  document.querySelectorAll(sel).forEach(el => {
    el.classList.toggle('is-selected', !had);
    const chk = el.querySelector('.file-check');
    if (chk) {
      chk.classList.toggle('is-checked', !had);
      chk.setAttribute('aria-checked', !had ? 'true' : 'false');
      if (chk.checked !== undefined) chk.checked = !had;
    }
  });
  updateBatchBar();
}

function updateBatchBar() {
  const bar = document.getElementById('batch-bar');
  if (!bar) return;
  if (!fileSelectMode) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  const n = fileSelection.size;
  bar.style.display = '';
  // 首次进入选择模式时构建按钮并绑定一次；后续仅更新计数与禁用态，避免重复绑定监听
 if (!bar.querySelector('#btn-batch-delete')) {
   bar.innerHTML = `
     <span class="batch-count"></span>
     <div class="batch-spacer"></div>
     <button class="btn btn-secondary btn-sm" id="btn-select-all">全选当前列表</button>
     <button class="btn btn-secondary btn-sm" id="btn-batch-tag">批量标签</button>
     <button class="btn btn-secondary btn-sm" id="btn-batch-pin">置顶/取消</button>
     <button class="btn btn-secondary btn-sm" id="btn-batch-move">移动到分组</button>
     <button class="btn btn-danger btn-sm" id="btn-batch-delete">删除</button>
     <button class="btn btn-secondary btn-sm" id="btn-cancel-select">退出选择</button>`;
   bar.querySelector('#btn-select-all').addEventListener('click', selectAllFiles);
   bar.querySelector('#btn-batch-move').addEventListener('click', batchMoveSelected);
   bar.querySelector('#btn-batch-tag').addEventListener('click', batchTagSelected);
   bar.querySelector('#btn-batch-pin').addEventListener('click', batchPinSelected);
   bar.querySelector('#btn-batch-delete').addEventListener('click', batchDeleteSelected);
   bar.querySelector('#btn-cancel-select').addEventListener('click', exitSelectMode);
 }
 bar.querySelector('.batch-count').textContent = `已选 ${n} 项`;
 bar.querySelector('#btn-batch-move').disabled = !n;
 bar.querySelector('#btn-batch-delete').disabled = !n;
 bar.querySelector('#btn-batch-tag').disabled = !n;
 bar.querySelector('#btn-batch-pin').disabled = !n;
}

function enterSelectMode() {
  // 搜索结果不走 renderFileList，选择模式下先回到目录视图
  if (searchQuery) {
    searchQuery = '';
    const si = document.getElementById('search-input'); if (si) si.value = '';
  }
  fileSelectMode = true;
  fileSelection.clear();
  loadFiles();
  updateBatchBar();
}

function exitSelectMode() {
  fileSelectMode = false;
  fileSelection.clear();
  renderFileList(currentFileItems);
  updateBatchBar();
}

function selectAllFiles() {
  const isRoot = !currentDir && !selectedGroup && !searchQuery;
  let pool = currentFileItems;
  if (isRoot) pool = pool.filter(i => i.is_dir || !i.group_id);
  pool.forEach(i => { if (!i.is_group && !i.is_dir) fileSelection.add(i.path); });
  renderFileList(currentFileItems);
  updateBatchBar();
}

async function batchDeleteSelected() {
  const paths = [...fileSelection];
  if (!paths.length) return;
  // 批量删除二次确认：≥5 项需键入「永久删除」（P0 E / 对齐回收站清空确认词）
  const needType = paths.length >= 5;
  const ok = await confirmDialog({
    title: '批量删除',
    message: needType ? `确定删除选中的 ${paths.length} 个文件？删除后将移入回收站（保留期内可恢复）。` : `确定删除选中的 ${paths.length} 个文件？删除后将移入回收站（保留期内可恢复）。`,
    confirmText: '删除', danger: true,
    inputConfirm: needType ? '永久删除' : '',
    inputConfirmLabel: '请输入「永久删除」以确认',
  });
  if (!ok) return;
  // 各文件删除互相独立，并发执行以缩短总耗时
  const results = await Promise.all(paths.map(p =>
    API.del(`/api/files?path=${encodeURIComponent(p)}`).then(r => r.ok).catch(() => false)
  ));
  const okN = results.filter(Boolean).length;
  const fail = results.length - okN;
  Toast.show(`已删除 ${okN} 项${fail ? `，失败 ${fail} 项` : ''}`, fail ? 'warning' : 'success');
  exitSelectMode();
  await loadGroups();
  loadFiles();
}

function batchMoveSelected() {
  const paths = [...fileSelection];
  if (!paths.length) return;
  const items = [];
  userGroups.forEach(g => items.push({ action: 'g_' + g.id, label: g.name, icon: ICONS.folder, onClick: async () => {
    let ok = 0, fail = 0;
    for (const p of paths) { const r = await moveFileToGroup(p, g.id, g.name); if (r.ok) ok++; else fail++; }
    Toast.show(`已移动 ${ok} 项到「${g.name}」${fail ? `，失败 ${fail}` : ''}`, fail ? 'warning' : 'success');
    exitSelectMode();
  }}));
  items.push({ divider: true });
  items.push({ action: 'new_group', label: '新建分组…', icon: ICONS.add, onClick: async () => {
    const name = await showInputDialog({ title: `新建分组并移入 ${paths.length} 项`, placeholder: '新分组名称', confirmText: '创建并移入', validate: v => validateGroupName(v) });
    if (name === null) return;
    try {
      const res = await API.post('/api/files/groups', { name });
      if (!res.ok) { const d = await res.json(); Toast.show(d.detail || '创建失败', 'error'); return; }
      const data = await res.json();
      let ok = 0, fail = 0;
      for (const p of paths) { const r = await moveFileToGroup(p, data.id, data.name); if (r.ok) ok++; else fail++; }
      Toast.show(`已创建「${data.name}」并移入 ${ok} 项${fail ? `，失败 ${fail}` : ''}`, fail ? 'warning' : 'success');
      exitSelectMode();
    } catch { Toast.show('创建失败', 'error'); }
  }});
 showContextMenu(window.innerWidth - 240, 140, items);
}

async function batchTagSelected() {
  const paths = [...fileSelection];
  if (!paths.length) return;
  const tag = await showInputDialog({ title: `为 ${paths.length} 个文件添加标签`, placeholder: '输入标签名称', confirmText: '添加标签' });
  if (tag === null) return;
  let ok = 0, fail = 0;
  for (const p of paths) {
    try {
      const f = currentFileItems.find(i => i.path === p);
      const existing = (f && f.tags) ? [...f.tags] : [];
      if (!existing.includes(tag)) existing.push(tag);
      const res = await API.put('/api/files/tags', { path: p, tags: existing });
      if (res.ok) ok++; else fail++;
    } catch { fail++; }
  }
  Toast.show(`已为 ${ok} 个文件添加标签「${tag}」${fail ? `，失败 ${fail}` : ''}`, fail ? 'warning' : 'success');
  exitSelectMode();
  loadFiles();
}

async function batchPinSelected() {
  const paths = [...fileSelection];
  if (!paths.length) return;
  const allPinned = paths.every(p => {
    const f = currentFileItems.find(i => i.path === p);
    return f && f.pinned;
  });
  let ok = 0, fail = 0;
  for (const p of paths) {
    try {
      const res = await API.put('/api/files/pin', { path: p, pinned: !allPinned });
      if (res.ok) ok++; else fail++;
    } catch { fail++; }
  }
  Toast.show(`${allPinned ? '已取消置顶' : '已置顶'} ${ok} 项${fail ? `，失败 ${fail}` : ''}`, fail ? 'warning' : 'success');
  exitSelectMode();
  loadFiles();
}

function showSortMenu(e) {
  const opts = [{ key: 'name', label: '名称' }, { key: 'size', label: '大小' }, { key: 'modified', label: '修改时间' }];
  const items = opts.map(o => {
    const active = fileSort.key === o.key;
    return {
      action: 'sort_' + o.key,
      label: o.label + (active ? (fileSort.dir === 'asc' ? ' ↑' : ' ↓') : ''),
      icon: active ? CHECK_ICON : '',
      onClick: () => {
        if (fileSort.key === o.key) fileSort.dir = fileSort.dir === 'asc' ? 'desc' : 'asc';
        else fileSort = { key: o.key, dir: 'asc' };
        savePref('fileSort', fileSort);
        renderFileList(currentFileItems);
      },
    };
  });
  showContextMenu(e.clientX, e.clientY, items);
}

// 标签筛选菜单：拉取所有标签，点击筛选
async function showTagFilterMenu(e) {
  try {
    const res = await API.get('/api/files/all-tags');
    const data = await res.json();
    const tags = data.tags || [];
    const items = [];
    items.push({ action: 'tag_all', label: '全部标签' + (selectedTag ? '' : ' ✓'), icon: selectedTag ? '' : CHECK_ICON, onClick: () => { selectedTag = ''; loadFiles(); } });
    if (tags.length) items.push({ divider: true });
    tags.forEach(t => {
      items.push({ action: 'tag_' + t.name, label: `#${t.name} (${t.count})` + (selectedTag === t.name ? ' ✓' : ''), icon: selectedTag === t.name ? CHECK_ICON : '', onClick: () => { selectedTag = t.name; loadFiles(); } });
    });
    showContextMenu(e.clientX, e.clientY, items);
  } catch { Toast.show('加载标签失败', 'error'); }
}

function showFileMenu(eventOrX, path, name, isDir) {
  // 统一签名：(event, path, name, isDir)。所有调用点（contextmenu / 行内「更多」按钮）均已收敛到此形态。
  const x = eventOrX.clientX, y = eventOrX.clientY;
  const items = [];
if (!isDir) {
  items.push({ action: 'preview', label: '预览', icon: ICONS.eye, onClick: () => previewFile(path, name) });
  // 笔记（.md）可编辑
  if (/\.(md|markdown|mdown|mkd)$/i.test(name)) {
    items.push({ action: 'edit', label: '编辑', icon: ICONS.edit, onClick: () => openNoteEditor({ path, name }) });
  }
  items.push({ action: 'rename', label: '重命名', icon: ICONS.rename, onClick: () => renameFile(path, name) });
  items.push({ action: 'download', label: '下载', icon: ICONS.download, onClick: () => downloadFile(path) });
  items.push({ action: 'move-group', label: '移动到分组', icon: ICONS.groups, onClick: () => showMoveToGroupMenu(x, y, path) });
  items.push({ action: 'toggle-pin', label: '置顶/取消置顶', icon: ICONS.pin, onClick: () => togglePinFile(path) });
  items.push({ action: 'tags', label: '编辑标签', icon: ICONS.tag, onClick: () => editFileTags(path, name) });
  items.push({ divider: true });
} else {
  items.push({ action: 'open', label: '打开', icon: ICONS.folder, onClick: () => { currentDir = path; searchQuery = ''; document.getElementById('search-input').value = ''; loadFiles(); } });
  items.push({ action: 'rename', label: '重命名', icon: ICONS.rename, onClick: () => renameFile(path, name) });
}
  items.push({ action: 'delete', label: '删除', icon: ICONS.trash, danger: true, onClick: () => deleteFile(path) });
  showContextMenu(x, y, items);
}

function renderSearchResults(results) {
  const content = document.getElementById('file-content');
  if (!results.length) {
    content.innerHTML = `<div class="search-results-empty">${ICONS.search}<div class="empty-title">没有找到匹配的文件</div></div>`;
    return;
  }
  // 搜索结果复用主列表组件体系（P0 L0.5 / S4）：顶部轻量 head + 用 renderFileList 渲染行
  function highlightSnippet(text, q) {
    if (!text) return '';
    const escaped = escapeHtml(text);
    const ql = escapeHtml(q);
    const re = new RegExp('(' + ql.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return '<mark class="search-hit">' + escaped.replace(re, '</mark>$1<mark class="search-hit">').replace(/<\/mark>(<mark class="search-hit">)/g, '$1') + '</mark>';
  }
  const items = results.map(r => ({
    name: r.name || r.path, path: r.path, is_dir: false, size: r.size || 0,
    modified: r.modified || 0, file_id: r.file_id || '', guard_status: r.guard_status || 'safe',
    group_id: r.group_id || '', group_name: r.group_name || '',
    is_note: /\.(md|markdown|mdown|mkd)$/i.test(r.name || r.path),
    tags: r.tags || [], pinned: false, summary: r.summary || '', ai_tags: [],
    _snippet: r.snippet || '', _fileId: r.file_id || '',
  }));
  // snippet 注入：把摘要高亮后挂到每组 item 的 summary，下接在 .file-name-info 内行内
  if (searchQuery) {
    items.forEach(it => { if (it._snippet) it._snippetHighlight = highlightSnippet(it._snippet, searchQuery); });
  }
  const head = `<div class="search-results-head" role="status" aria-live="polite"><span class="search-results-head-title">${ICONS.search}<span>语义检索 · ${results.length} 项命中</span></span><span class="spacer"></span></div>`;
  content.innerHTML = head;
  const listWrap = document.createElement('div');
  content.appendChild(listWrap);
  // 用 sortItems 保持排序一致，再走统一渲染；结果不显示骨架屏（已在 loadFiles 前置空）
  const displayItems = sortItems(items);
  if (fileView === 'grid') {
    listWrap.innerHTML = `<div class="file-grid">${displayItems.map(item => fileItemHTML(item)).join('')}</div>`;
  } else {
    listWrap.innerHTML = `<div class="file-table">
      <div class="file-table-head">
        <span class="file-cell file-cell--name">名称</span>
        <span class="file-cell file-cell--type">类型</span>
        <span class="file-cell file-cell--size">大小</span>
        <span class="file-cell file-cell--date">修改</span>
        <span class="file-cell file-cell--actions"></span>
      </div>${displayItems.map(item => fileItemHTML(item)).join('')}
    </div>`;
  }
  bindFileItemsToContainer(listWrap);
}

function bindFileItemsToContainer(root) {
  // 为搜索结果容器单独绑定：行点击→预览/编辑笔记；行内同上复用 data-action 委托
  root.querySelectorAll('.file-row, .file-card').forEach(row => {
    row.addEventListener('click', () => {
      if (fileSelectMode) {
        if (row.dataset.isgroup !== 'true' && row.dataset.isdir !== 'true') toggleSelect(row.dataset.path);
        return;
      }
      if (row.dataset.isdir === 'true') {
        currentDir = row.dataset.path; selectedGroup = ''; searchQuery = ''; selectedTag = '';
        const si = document.getElementById('search-input'); if (si) si.value = '';
        loadFiles();
      } else {
        previewFile(row.dataset.path, row.dataset.name, { fileId: row.dataset.fileId || row.dataset.file_id || '' });
      }
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showFileMenu(e, row.dataset.path, row.dataset.name, row.dataset.isdir === 'true');
    });
    row.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const a = btn.dataset.action;
        const { path, name } = row.dataset;
        if (a === 'toggle-select') toggleSelect(path);
        else if (a === 'preview') previewFile(path, name);
        else if (a === 'edit') openNoteEditor({ path, name });
        else if (a === 'menu') showFileMenu(e, path, name, row.dataset.isdir === 'true');
      });
    });
  });
}

// ============ Upload with Progress ============
async function handleFilesUpload(fileList) {
  const files = Array.from(fileList);
  for (const file of files) {
    const item = UploadManager.add(file.name, file.size);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const xhr = new XMLHttpRequest();
      const gidParam = selectedGroup ? `&group_id=${encodeURIComponent(selectedGroup)}` : ''
      xhr.open('POST', `/api/files/upload?directory=${encodeURIComponent(currentDir)}&source=manual${gidParam}`);
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          UploadManager.update(item.id, { progress: pct });
        }
      });
      const result = await new Promise((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            try { reject(JSON.parse(xhr.responseText)); }
            catch { reject({ detail: `HTTP ${xhr.status}` }); }
          }
        };
        xhr.onerror = () => reject({ detail: '网络错误' });
        xhr.send(formData);
      });
      UploadManager.update(item.id, { progress: 100, status: 'done' });
      if (result.guard_status === 'warning') {
        Toast.show(`Guard 提醒: ${result.guard_reason}`, 'warning', 5000);
      }
    } catch (err) {
      UploadManager.update(item.id, { progress: 100, status: 'error' });
      Toast.show(`${file.name} 上传失败: ${err.detail || '未知错误'}`, 'error');
    }
  }
  UploadManager.hide();
 loadFiles();
}

// ============ File Preview ============
async function previewFile(path, name, opts = {}) {
  const fileName = name || (path ? path.split('/').pop() : 'file');
  const fid = (opts && opts.fileId) || '';
  // Build query param: prefer opaque file_id over raw path
  const fileRef = fid ? `file_id=${encodeURIComponent(fid)}` : `path=${encodeURIComponent(path)}`;
  const previewType = getPreviewType(fileName);
  const isMarkdown = /\.(md|markdown|mdown|mkd)$/i.test(fileName);
  if (!previewType && !isMarkdown) {
    Toast.show('此类型不支持浏览器预览，请在守护进程设备查看', 'info');
    return;
  }

  // Create modal overlay
  const overlay = document.createElement('div');
  const isNote = isMarkdown;
  overlay.className = 'preview-overlay';
  if (isNote) overlay.classList.add('preview-overlay--note');
  overlay.innerHTML = `
    <div class="preview-header">
      <div class="preview-title" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</div>
      <div class="preview-actions">
        ${isNote ? `<button class="icon-btn" id="btn-preview-edit" title="编辑">${ICONS.note}</button>` : ''}
        ${isNote ? `<button class="icon-btn" id="btn-preview-toc" title="目录">${ICONS.list}</button>` : ''}
        <button class="icon-btn" id="btn-preview-download" title="下载">${ICONS.download}</button>
        <button class="icon-btn" id="btn-preview-close" title="关闭">${ICONS.close}</button>
      </div>
    </div>
    <div class="preview-body" id="preview-body">
      <div class="preview-loading">加载中...</div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const closePreview = () => { overlay.remove(); document.body.style.overflow = ''; };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closePreview(); });
  document.getElementById('btn-preview-close').addEventListener('click', closePreview);
  document.getElementById('btn-preview-download').addEventListener('click', () => downloadFile(path, { fileId: fid, fileName }));
  const editBtn = document.getElementById('btn-preview-edit');
  if (editBtn) editBtn.addEventListener('click', () => {
    closePreview();
    // Note editor loads content via file_id (or path fallback); no real path needed in DOM
    openNoteEditor({ path: path || '', fileId: fid, name: fileName });
  });
  const tocBtn = document.getElementById('btn-preview-toc');
  if (tocBtn) tocBtn.addEventListener('click', () => {
    const toc = document.getElementById('preview-toc');
    if (toc) toc.classList.toggle('is-hidden');
  });
  const escHandler = (e) => { if (e.key === 'Escape') { closePreview(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);

  const body = document.getElementById('preview-body');

  try {
    if (isNote) {
      const res = await API.get(`/api/files/preview-text?${fileRef}`);
      if (!res.ok) { body.innerHTML = '<div class="preview-error">加载失败</div>'; return; }
      const data = await res.json();
      const { html, toc } = renderNoteMarkdown(data.content);
      body.innerHTML = `
        ${toc.length > 1 ? `<aside class="preview-toc is-hidden" id="preview-toc"><div class="preview-toc-title">目录</div>${toc.map(t => `<a class="preview-toc-item toc-l${t.level}" href="#${escapeHtml(t.id)}">${escapeHtml(t.text)}</a>`).join('')}</aside>` : ''}
       <article class="markdown-body preview-note">${html}</article>
       <div class="backlinks-section" id="backlinks-section"></div>
       ${data.truncated ? '<div class="preview-truncated">文件过大，仅显示前 1MB 内容，请下载查看完整文件</div>' : ''}`;
     // TOC 点击跳转（平滑滚动到标题）
     body.querySelectorAll('.preview-toc-item').forEach(a => {
       a.addEventListener('click', (e) => { e.preventDefault(); const el = body.querySelector('#' + CSS.escape(a.getAttribute('href').slice(1))); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
     });
     loadBacklinks(path || fid, 'backlinks-section');
   } else if (previewType === 'text') {
      const res = await API.get(`/api/files/preview-text?${fileRef}`);
      if (!res.ok) { body.innerHTML = '<div class="preview-error">加载失败</div>'; return; }
      const data = await res.json();
      const lines = data.content.split('\n');
      const lineNumbers = lines.map((_, i) => i + 1).join('\n');
      body.innerHTML = `
        <div class="preview-text-wrapper">
          <div class="preview-line-numbers">${lineNumbers}</div>
          <pre class="preview-text-code"></pre>
        </div>
        ${data.truncated ? '<div class="preview-truncated">文件过大，仅显示前 1MB 内容，请下载查看完整文件</div>' : ''}`;
      body.querySelector('.preview-text-code').textContent = data.content;
    } else {
      const res = await API.get(`/api/files/preview?${fileRef}`);
      if (!res.ok) { body.innerHTML = '<div class="preview-error">加载失败</div>'; return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      overlay._closeExtra = () => URL.revokeObjectURL(url);
      if (previewType === 'image') {
        body.innerHTML = `<img class="preview-image" src="${url}" alt="${escapeHtml(fileName)}">`;
      } else if (previewType === 'video') {
        body.innerHTML = `<video class="preview-video" src="${url}" controls autoplay></video>`;
      } else if (previewType === 'audio') {
        body.innerHTML = `<div class="preview-audio-wrapper">${ICONS.fileAudio}<audio class="preview-audio" src="${url}" controls autoplay></audio></div>`;
      } else if (previewType === 'pdf') {
        body.innerHTML = `<iframe class="preview-pdf" src="${url}"></iframe>`;
      }
    }
  } catch (err) {
    body.innerHTML = `<div class="preview-error">加载出错: ${escapeHtml(err.message)}</div>`;
  }

  const _origRemove = overlay.remove.bind(overlay);
  overlay.remove = () => {
    if (overlay._closeExtra) overlay._closeExtra();
    document.removeEventListener('keydown', escHandler);
    _origRemove();
    document.body.style.overflow = '';
  };
}

async function downloadFile(path, opts = {}) {
  // opts.fileId: opaque UUID reference (preferred — real path never in DOM)
  // opts.fileName: display name for the download (falls back to path basename)
  const fid = opts.fileId || '';
  const dlName = opts.fileName || (path ? path.split('/').pop() : 'download');
  // Build query param: use file_id when available, otherwise fall back to path
  const dlQuery = fid ? `file_id=${encodeURIComponent(fid)}` : `path=${encodeURIComponent(path)}`;
  try {
    const res = await API.get(`/api/files/download?${dlQuery}`);
    if (!res) return;  // 会话已失效并被登出（API.request 返回 undefined）
    if (res.status === 403) {
      // 就地弹出密码验证，验证通过后直接下载（不跳设置页）
      const auth = await requestDownloadAuth({ filePath: path, fileId: fid, defaultMode: 'single' });
      if (!auth) return;  // 用户取消
      if (auth.mode === 'window') {
        Toast.show(`已开启临时下载（${auth.minutes} 分钟）`, 'success');
        showDownloadBanner(auth.until);
        loadDownloadGrant();
      }
      // 重试下载（单次授权或窗口授权都已就绪）
      const res2 = await API.get(`/api/files/download?${dlQuery}`);
      if (!res2 || !res2.ok) { Toast.show('下载失败', 'error'); return; }
      const blob2 = await res2.blob();
      const url2 = URL.createObjectURL(blob2);
      const a2 = document.createElement('a');
      a2.href = url2; a2.download = dlName; a2.click();
      URL.revokeObjectURL(url2);
      if (auth.mode === 'single') loadDownloadGrant();
      return;
    }
    if (!res.ok) { Toast.show('下载失败', 'error'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = dlName; a.click();
    URL.revokeObjectURL(url);
  } catch (err) { Toast.show('下载出错: ' + err.message, 'error'); }
}

async function deleteFile(path) {
  if (!await confirmDialog({ title: '删除文件', message: `确定删除 "${path.split('/').pop()}"？将移入回收站，保留一段时间后彻底删除。`, confirmText: '删除', danger: true })) return;
  try {
    const res = await API.del(`/api/files?path=${encodeURIComponent(path)}`);
    if (res.ok) {
      const data = await res.json();
      Toast.show(`已移入回收站`, 'success', 6000, {
        action: [
          { label: '撤销', onClick: async () => {
            const r = await API.post(`/api/files/trash/restore?file_id=${encodeURIComponent(data.file_id)}`);
            if (r.ok) { Toast.show('已恢复', 'success'); await loadTrashCount(); if (App.currentView === 'trash') loadTrash(); else loadFiles(); }
            else { Toast.show('恢复失败', 'error'); }
          }},
          { label: '查看', onClick: () => App.navigate('trash') }
        ]
      });
      // 刷新回收站角标与列表
      await loadTrashCount();
      if (App.currentView === 'trash') loadTrash(); else loadFiles();
    }
    else { const data = await res.json(); Toast.show(data.detail || '删除失败', 'error'); }
  } catch (err) { Toast.show('删除出错: ' + err.message, 'error'); }
}

// 重命名文件/笔记
async function renameFile(path, name) {
  const oldName = name || path.split('/').pop();
  const newName = await showInputDialog({
    title: '重命名', value: oldName, placeholder: '输入新名称', confirmText: '确定',
    validate: v => v && v.trim() && v.trim() !== oldName ? '' : '请输入不同的名称',
  });
  if (newName === null) return;
  try {
    const res = await API.put('/api/files/rename', { path, new_name: newName.trim() });
    if (res.ok) { Toast.show('已重命名', 'success'); loadFiles(); }
    else { const d = await res.json(); Toast.show(d.detail || '重命名失败', 'error'); }
  } catch (err) { Toast.show('重命名出错: ' + err.message, 'error'); }
}
// ============ 回收站 ============

async function loadTrashCount() {
  try {
    const res = await API.get('/api/files/trash/stats');
    if (!res.ok) return;
    const data = await res.json();
    const badge = document.getElementById('trash-count');
    if (!badge) return;
    if (data.total > 0) { badge.textContent = data.total > 99 ? '99+' : data.total; badge.hidden = false; }
    else { badge.hidden = true; }
  } catch {}
}

let _trashItems = [];               // 当前渲染的回收站原始数据(供批量/预览复用)
const trashSel = createTrashSelection(); // 选择状态机（单一来源）
let trashBatchBusy = false;         // 批量操作防连点锁
let trashEscBound = false;          // ESC 退出监听只绑一次

function enterTrashSelectMode() { trashSel.enterMode(); syncTrashSelectUI(); }
function exitTrashSelectMode() { trashSel.exitMode(); syncTrashSelectUI(); }
function toggleTrashSelectMode() { trashSel.toggleMode(); syncTrashSelectUI(); }

// 全选 / 取消全选（当前列表）
function toggleTrashSelectAll() { trashSel.toggleAll(_trashItems); syncTrashSelectUI(); }

// 分块工具（>200 时分批调用批量接口）
function _chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

async function renderTrash() {
  document.getElementById('main-content').innerHTML = trashShellHTML();
  document.getElementById('btn-trash-select-toggle').addEventListener('click', toggleTrashSelectMode);
  document.getElementById('btn-trash-purge').addEventListener('click', async () => {
    try {
      const res = await API.post('/api/files/trash/purge');
      const d = await res.json();
      Toast.show(d.purged > 0 ? `已清理 ${d.purged} 个过期文件` : '没有需要清理的过期文件', 'success');
      loadTrash(); loadTrashCount();
    } catch { Toast.show('清理失败', 'error'); }
  });
  document.getElementById('btn-trash-empty').addEventListener('click', async () => {
    try {
      if (!_trashItems.length) { Toast.show('回收站为空', 'info'); return; }
      if (!await confirmDialog({ title: '清空回收站', message: `将永久删除回收站中全部 ${_trashItems.length} 个未锁存文件,不可恢复。(已锁存文件不会被删除)`, confirmText: '清空', danger: true, inputConfirm: '永久删除' })) return;
      const r = await API.post('/api/files/trash/empty', { confirm: '永久删除' });
      if (r.ok) { const d = await r.json(); Toast.show(d.locked_skipped > 0 ? `已清空 ${d.count} 个文件(跳过 ${d.locked_skipped} 个锁存)` : `已清空回收站(${d.count} 个文件)`, 'success'); loadTrash(); loadTrashCount(); }
      else { const d = await r.json(); Toast.show(d.detail || '清空失败', 'error'); }
    } catch { Toast.show('清空失败', 'error'); }
  });
  trashSel.exitMode();
  if (!trashEscBound) {
    trashEscBound = true;
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && trashSel.mode) exitTrashSelectMode(); });
  }
  await loadTrash();
}

async function loadTrash() {
  const el = document.getElementById('trash-content');
  if (!el) return;
  const banner = document.getElementById('trash-banner');
  try {
    const res = await API.get('/api/files/trash');
    const d = await res.json();
    _trashItems = d.items;
    if (banner) {
      const lockedTxt = d.items.filter(i => i.locked).length;
      banner.innerHTML = trashBannerHTML(d.retention_days, lockedTxt);
    }
    if (!d.items.length) {
      el.innerHTML = trashEmptyStateHTML(d.retention_days);
      // 列表变空：强制退出选择模式，避免批量栏悬浮在空态上方
      if (trashSel.mode || trashSel.size) trashSel.exitMode();
      syncTrashSelectUI();
      return;
    }
    el.innerHTML = trashTableHTML(d.items, d.retention_days);
    // 表头全选复选框（若存在）
    const thCb = document.getElementById('th-check-box');
    if (thCb) {
      thCb.addEventListener('click', (e) => { e.stopPropagation(); toggleTrashSelectAll(); });
    }
    el.querySelectorAll('.trash-row').forEach(row => {
      const fid = row.dataset.fileId;
      const name = row.dataset.name;
      const item = d.items.find(x => x.file_id === fid);
      row.querySelector('.file-check').addEventListener('click', (e) => {
        e.stopPropagation();
        trashSel.toggleOne(fid);
        syncTrashSelectUI();
      });
      row.querySelector('[data-action="trash-preview"]').addEventListener('click', () => previewTrashFile(fid, name));
      row.querySelector('[data-action="trash-restore"]').addEventListener('click', () => trashRestore(fid));
      row.querySelector('[data-action="trash-purge"]').addEventListener('click', () => trashPurge(fid));
      row.querySelector('[data-action="trash-lock"]').addEventListener('click', async () => {
        const r = await API.post('/api/files/trash/lock', { file_id: fid, locked: !item.locked });
        if (r.ok) { Toast.show(!item.locked ? '已锁存' : '已解锁', 'success'); loadTrash(); }
        else { const dd = await r.json(); Toast.show(dd.detail || '操作失败', 'error'); }
      });
    });
    syncTrashSelectUI();
  } catch { el.innerHTML = '<p>加载失败</p>'; }
}

// 同步回收站选择 UI：行高亮 → 切换按钮 → 表头三态 → 批量栏
// 行高亮同步始终执行（不被批量栏显隐阻塞），修复「取消选择后高亮残留」
function syncTrashSelectUI() {
  document.querySelectorAll('.trash-row').forEach(row => {
    const on = trashSel.has(row.dataset.fileId);
    row.classList.toggle('is-selected', on);
    const cb = row.querySelector('.file-check');
    if (cb) cb.classList.toggle('is-checked', on);
    const wrap = row.querySelector('.file-check-wrap');
    if (wrap) wrap.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  const toggle = document.getElementById('btn-trash-select-toggle');
  if (toggle) {
    toggle.classList.toggle('is-active', trashSel.mode);
    const sp = toggle.querySelector('span');
    if (sp) sp.textContent = trashSel.mode ? '取消选择' : '批量选择';
    toggle.disabled = _trashItems.length === 0;
  }
  const hdr = document.getElementById('th-check-box');
  if (hdr) {
    hdr.checked = _trashItems.length > 0 && trashSel.size === _trashItems.length;
    hdr.indeterminate = trashSel.size > 0 && trashSel.size < _trashItems.length;
  }
  const bar = document.getElementById('trash-batch-bar');
  if (!bar) return;
  if (!trashSel.mode || !trashSel.size) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  ensureTrashBatchBarBuilt();
  updateTrashBatchBarState();
}

// 批量栏只构建一次（按钮 + 监听），后续只更新计数与禁用态
function ensureTrashBatchBarBuilt() {
  const bar = document.getElementById('trash-batch-bar');
  if (!bar || bar.querySelector('#tb-restore')) return;
  bar.innerHTML = `<span class="batch-count"></span><span class="batch-spacer"></span>
    <button class="btn btn-primary btn-sm" id="tb-restore">恢复所选</button>
    <button class="btn btn-danger btn-sm" id="tb-purge">彻底删除</button>
    <button class="btn btn-secondary btn-sm" id="tb-lock">锁存所选</button>
    <button class="btn btn-secondary btn-sm" id="tb-toggle-all">全选当前列表</button>
    <button class="btn btn-secondary btn-sm" id="tb-cancel">退出选择</button>`;
  document.getElementById('tb-restore').addEventListener('click', trashBatchRestore);
  document.getElementById('tb-purge').addEventListener('click', trashBatchPurge);
  document.getElementById('tb-lock').addEventListener('click', trashBatchLock);
  document.getElementById('tb-toggle-all').addEventListener('click', toggleTrashSelectAll);
  document.getElementById('tb-cancel').addEventListener('click', exitTrashSelectMode);
}

function updateTrashBatchBarState() {
  const bar = document.getElementById('trash-batch-bar');
  if (!bar) return;
  const cnt = bar.querySelector('.batch-count');
  if (cnt) cnt.textContent = `已选 ${trashSel.size} 项 / 共 ${_trashItems.length} 项`;
  const dis = trashSel.size === 0 || trashBatchBusy;
  bar.querySelector('#tb-restore').disabled = dis;
  bar.querySelector('#tb-purge').disabled = dis;
  bar.querySelector('#tb-lock').disabled = dis;
  const allBtn = bar.querySelector('#tb-toggle-all');
  if (allBtn) allBtn.textContent = (_trashItems.length > 0 && trashSel.size === _trashItems.length) ? '取消全选' : '全选当前列表';
}

async function trashBatchRestore() {
  if (trashBatchBusy) return;
  const ids = trashSel.ids();
  if (!ids.length) return;
  if (!await confirmDialog({ title: '批量恢复', message: `恢复所选 ${ids.length} 个文件至原位置?`, confirmText: '恢复' })) return;
  trashBatchBusy = true; updateTrashBatchBarState();
  let ok = 0, fail = 0;
  try {
    for (const c of _chunk(ids, 200)) {
      const res = await API.post('/api/files/trash/restore-batch', { file_ids: c });
      const d = await res.json();
      ok += d.succeeded || 0; fail += d.failed || 0;
      (d.results || []).filter(r => r.ok).forEach(r => trashSel.remove(r.file_id));
    }
    Toast.show(`已恢复 ${ok} 个${fail ? `, ${fail} 个失败` : ''}`, fail ? 'warning' : 'success');
  } catch { Toast.show('恢复失败', 'error'); }
  finally { trashBatchBusy = false; }
  await loadTrash(); loadTrashCount();
  syncTrashSelectUI();
  if (trashSel.size === 0) exitTrashSelectMode();
}

async function trashBatchPurge() {
  if (trashBatchBusy) return;
  const ids = trashSel.ids();
  if (!ids.length) return;
  if (!await confirmDialog({ title: '彻底删除', message: `将永久删除所选 ${ids.length} 个未锁存文件,不可恢复。(锁存文件会被跳过)`, confirmText: '删除', danger: true })) return;
  trashBatchBusy = true; updateTrashBatchBarState();
  let ok = 0, skip = 0;
  try {
    for (const c of _chunk(ids, 200)) {
      const res = await API.post('/api/files/trash/purge-batch', { file_ids: c });
      const d = await res.json();
      ok += d.succeeded || 0; skip += d.skipped_locked || 0;
      (d.results || []).filter(r => r.ok).forEach(r => trashSel.remove(r.file_id));
    }
    Toast.show(ok > 0 ? `已删除 ${ok} 个${skip ? `, 跳过 ${skip} 个锁存` : ''}` : (skip > 0 ? '所选文件均已锁存,无需删除' : '删除失败'), ok > 0 ? 'success' : 'warning');
  } catch { Toast.show('删除失败', 'error'); }
  finally { trashBatchBusy = false; }
  await loadTrash(); loadTrashCount();
  syncTrashSelectUI();
  if (trashSel.size === 0) exitTrashSelectMode();
}

async function trashBatchLock() {
  if (trashBatchBusy) return;
  const ids = trashSel.ids();
  if (!ids.length) return;
  trashBatchBusy = true; updateTrashBatchBarState();
  let ok = 0, fail = 0;
  try {
    const results = await Promise.all(ids.map(fid => API.post('/api/files/trash/lock', { file_id: fid, locked: true }).then(r => r.ok).catch(() => false)));
    ok = results.filter(Boolean).length; fail = results.length - ok;
  } catch { /* 单条已 catch,忽略 */ }
  trashBatchBusy = false;
  Toast.show(`已锁存 ${ok} 个${fail ? `, ${fail} 个失败(达上限)` : ''}`, 'success');
  await loadTrash();
  updateTrashBatchBarState();
}

async function previewTrashFile(fileId, name) {
  const fileName = name || 'file';
  const previewType = getPreviewType(fileName);
  const isMarkdown = /\.(md|markdown|mdown|mkd)$/i.test(fileName);
  if (!previewType && !isMarkdown) { Toast.show('该类型不支持浏览器预览', 'info'); return; }
  const overlay = document.createElement('div');
  overlay.className = 'preview-overlay';
  overlay.innerHTML = `<div class="preview-header"><span class="preview-title">${escapeHtml(fileName)}</span>
    <span class="trash-preview-badge">${ICONS.trash} 已删除文件预览</span>
    <div class="preview-actions"><button class="icon-btn" id="trash-preview-close">✕</button></div></div>
    <div class="preview-body"><div class="preview-loading">加载中...</div></div>`;
  document.body.appendChild(overlay);
  let url = null;
  const closeOverlay = () => { if (url) URL.revokeObjectURL(url); overlay.remove(); };
  document.getElementById('trash-preview-close').addEventListener('click', closeOverlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });
  const body = overlay.querySelector('.preview-body');
  try {
    const res = await API.get(`/api/files/trash/preview?file_id=${encodeURIComponent(fileId)}`);
    if (res.status === 415) { body.innerHTML = '<div class="preview-error">此类型不支持浏览器预览(安全限制)</div>'; return; }
    if (!res.ok) { body.innerHTML = '<div class="preview-error">预览失败</div>'; return; }
    const blob = await res.blob();
    url = URL.createObjectURL(blob);
    const mt = (res.headers.get('content-type') || '').split(';')[0];
    if (mt.startsWith('image/')) { body.innerHTML = `<img class="preview-image" src="${url}">`; }
    else if (mt.startsWith('video/')) { body.innerHTML = `<video class="preview-video" controls src="${url}"></video>`; }
    else if (mt.startsWith('audio/')) { body.innerHTML = `<div class="preview-audio-wrapper">${ICONS.fileAudio}<audio class="preview-audio" controls src="${url}"></audio></div>`; }
    else if (mt === 'application/pdf') { body.innerHTML = `<iframe class="preview-pdf" src="${url}"></iframe>`; }
    else { body.innerHTML = `<div class="preview-text-wrapper"><pre class="preview-text-code" style="flex:1">${escapeHtml('(该类型仅支持下载查看)')}</pre></div>`; }
  } catch { body.innerHTML = '<div class="preview-error">预览出错</div>'; }
}

async function trashRestore(fileId) {
  try {
    const res = await API.post(`/api/files/trash/restore?file_id=${fileId}`);
    if (res.ok) {
      const d = await res.json();
      Toast.show(d.renamed ? `已恢复为「${d.path.split('/').pop()}」` : '已恢复', 'success');
      trashSel.remove(fileId);
      await loadTrash(); loadTrashCount();
      syncTrashSelectUI();
      if (trashSel.mode && trashSel.size === 0) exitTrashSelectMode();
    } else {
      const d = await res.json();
      Toast.show(d.detail || '恢复失败', 'error');
    }
  } catch { Toast.show('恢复出错', 'error'); }
}

async function trashPurge(fileId) {
  if (!await confirmDialog({ title: '彻底删除', message: '将永久删除该文件，不可恢复。', confirmText: '删除', danger: true })) return;
  try {
    const res = await API.del(`/api/files/trash?file_id=${fileId}`);
    if (res.ok) { Toast.show('已彻底删除', 'success'); trashSel.remove(fileId); await loadTrash(); loadTrashCount(); syncTrashSelectUI(); if (trashSel.mode && trashSel.size === 0) exitTrashSelectMode(); }
    else { Toast.show('删除失败', 'error'); }
  } catch { Toast.show('删除出错', 'error'); }
}

// 置顶/取消置顶
async function togglePinFile(path) {
  // 先查当前状态：从 DOM 行的 data-pinned 读
  const row = document.querySelector(`.file-row[data-path="${CSS.escape(path)}"], .file-card[data-path="${CSS.escape(path)}"]`);
  const isPinned = row && row.dataset.pinned === 'true';
  try {
    const res = await API.put('/api/files/pin', { path, pinned: !isPinned });
    if (res.ok) { Toast.show(!isPinned ? '已置顶' : '已取消置顶', 'success'); loadFiles(); }
    else { const d = await res.json(); Toast.show(d.detail || '操作失败', 'error'); }
  } catch (err) { Toast.show('操作出错: ' + err.message, 'error'); }
}

// 编辑标签（非笔记也可用）
async function editFileTags(path, name) {
  const { modal, close } = openModal({ width: 460, onDismiss: () => close() });
  modal.classList.add('tag-editor-modal');
  modal.innerHTML = `
    <h3>编辑标签</h3>
    <div class="note-tags-input" id="tag-modal-input"></div>
    <div class="modal-actions"><span class="modal-spacer"></span><button class="btn btn-primary" id="tag-save">保存</button></div>`;
  // 复用标签 chip 渲染逻辑
  let tags = [];
  // 拉取现有标签
  try {
    const res = await API.get(`/api/files/list?directory=${encodeURIComponent(currentDir)}`);
    if (res.ok) { const data = await res.json(); const f = (data.items || []).find(i => i.path === path); if (f) tags = f.tags || []; }
  } catch {}
  const inputEl = modal.querySelector('#tag-modal-input');
  function render() {
    inputEl.innerHTML = tags.map((t, i) =>
      '<span class="note-tag-chip">' + escapeHtml(t) + '<button class="note-tag-remove" data-idx="' + i + '">×</button></span>'
    ).join('') + '<input class="note-tag-field" placeholder="输入标签后回车" maxlength="30">';
    const field = inputEl.querySelector('.note-tag-field');
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault(); const v = field.value.trim();
        if (v && !tags.includes(v) && tags.length < 20) { tags.push(v); render(); } else field.value = '';
      } else if (e.key === 'Backspace' && !field.value && tags.length) { tags.pop(); render(); }
    });
    inputEl.querySelectorAll('.note-tag-remove').forEach(btn => {
      btn.addEventListener('click', () => { tags.splice(parseInt(btn.dataset.idx), 1); render(); });
    });
  }
  render();
  modal.querySelector('#tag-save').addEventListener('click', async () => {
    try {
      const res = await API.put('/api/files/tags', { path, tags });
      if (res.ok) { Toast.show('标签已保存', 'success'); close(); loadFiles(); }
      else { const d = await res.json(); Toast.show(d.detail || '保存失败', 'error'); }
    } catch (err) { Toast.show('保存出错: ' + err.message, 'error'); }
  });
}

// ============ Chat ============
const COPY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>';

let chatMessages = [];
let chatSending = false;
let currentChatAbort = null;

function scrollChat(container, stick = false) {
  if (!container) return;
  // stick：仅在已靠近底部时才跟随滚动，避免向上浏览/删除时把视图拽到底
  if (stick && container.scrollHeight - container.scrollTop - container.clientHeight > 120) return;
  container.scrollTop = container.scrollHeight;
}

// ============ 敏感信息脱敏 UI（服务端脱敏 + 前端交互） ============
//
// 服务端将敏感数据替换为 token [[M:<mask_id>:<display>]]，真实值永不下发浏览器。
// 前端扫描渲染后的 DOM 文本节点，把 token 替换为可交互的 <span class="sx-mask">，
// 默认显示脱敏文本 + 眼睛图标，点击图标调用 /api/chat/unmask 按需解密。
// 防偷窥保护：默认隐藏 / 失焦自动隐藏 / 切标签隐藏 / 30 秒定时隐藏。

const MASK_TOKEN_RE = /\[\[M:([a-f0-9]{16}):([^\]]*)\]\]/g;
const _maskValueCache = new Map();
const _revealedMasks = new Set();
const MASK_AUTO_HIDE_MS = 30000;

// Client-side PII patterns (mirror server-side _PII_PATTERNS in mask.py).
// Used for optimistic transfer messages: the text is shown immediately before
// the server returns the properly tokenized (eye-toggleable) masked version.
// The client-side mask has NO reveal button (no mask_id to unmask with yet);
// it's replaced by the server version within ~200ms once the POST returns.
const _CLIENT_PII_PATTERNS = [
  /(?<!\d)\d{17}[\dXx](?!\d)/g,            // ID card (18 digits)
  /(?<!\d)1[3-9]\d{9}(?!\d)/g,             // phone (11 digits, 1[3-9])
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,  // email
  /AKIA[0-9A-Z]{16}/g,                        // AWS key
  /sk-[a-zA-Z0-9]{20,}/g,                     // API key (sk- format)
  /gh[pousr]_[a-zA-Z0-9]{36}/g,               // GitHub token
  /glpat-[a-zA-Z0-9_-]{20}/g,                  // GitLab token
];

function _clientMaskPII(text) {
  if (!text) return text;
  let result = text;
  for (const re of _CLIENT_PII_PATTERNS) {
    result = result.replace(re, (m) => {
      const show = Math.min(5, Math.max(1, m.length - 1));
      const dots = Math.min(m.length - show, 6);
      return m.slice(0, show) + '*'.repeat(dots);
    });
  }
  return result;
}

let _maskGlobalListenersBound = false;
function _bindMaskGlobalListeners() {
  if (_maskGlobalListenersBound) return;
  _maskGlobalListenersBound = true;
  window.addEventListener('blur', _hideAllRevealedMasks);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) _hideAllRevealedMasks();
  });
}

function enhanceMaskedContent(root) {
  if (!root || !root.querySelectorAll) return;
  _bindMaskGlobalListeners();
  const candidates = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent) continue;
    if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') continue;
    if (parent.closest('.sx-mask')) continue;
    if (node.nodeValue && node.nodeValue.includes('[[M:')) candidates.push(node);
  }
  for (const tn of candidates) _replaceTokensInTextNode(tn);
}

function _replaceTokensInTextNode(textNode) {
  const text = textNode.nodeValue;
  const matches = [...text.matchAll(MASK_TOKEN_RE)];
  if (!matches.length) return;
  const parent = textNode.parentNode;
  if (!parent) return;
  const frag = document.createDocumentFragment();
  let lastIdx = 0;
  for (const m of matches) {
    if (m.index > lastIdx) frag.appendChild(document.createTextNode(text.slice(lastIdx, m.index)));
    frag.appendChild(_createMaskSpan(m[1], m[2]));
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) frag.appendChild(document.createTextNode(text.slice(lastIdx)));
  parent.replaceChild(frag, textNode);
}

function _createMaskSpan(maskId, display) {
  const span = document.createElement('span');
  span.className = 'sx-mask';
  span.dataset.maskId = maskId;
  span.dataset.maskDisplay = display;
  const textEl = document.createElement('span');
  textEl.className = 'sx-mask-text';
  textEl.textContent = display;
  span.appendChild(textEl);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sx-mask-toggle';
  btn.title = '显示';
  btn.setAttribute('aria-label', '显示敏感信息');
  btn.innerHTML = ICONS.eyeOff;
  btn.addEventListener('click', (e) => { e.stopPropagation(); _toggleMask(span); });
  span.appendChild(btn);
  return span;
}

function _toggleMask(span) {
  if (span.classList.contains('revealed')) _hideMaskEl(span);
  else _revealMaskEl(span);
}

function _revealMaskEl(span) {
  if (span.classList.contains('revealed')) return;
  const maskId = span.dataset.maskId;
  const display = span.dataset.maskDisplay;
  const textEl = span.querySelector('.sx-mask-text');
  const btn = span.querySelector('.sx-mask-toggle');
  if (!textEl || !btn) return;
  if (_maskValueCache.has(maskId)) {
    _applyRevealed(span, textEl, btn, _maskValueCache.get(maskId));
    return;
  }
  btn.disabled = true;
  API.post('/api/chat/unmask', { mask_id: maskId })
    .then(res => res.ok ? res.json() : Promise.reject(new Error(String(res.status))))
    .then(data => {
      _maskValueCache.set(maskId, data.value);
      _applyRevealed(span, textEl, btn, data.value);
    })
    .catch(() => {
      btn.disabled = false;
      textEl.textContent = display;
      Toast.show('无法显示该敏感信息', 'error', 2000);
    });
}

function _applyRevealed(span, textEl, btn, value) {
  textEl.textContent = value;
  span.classList.add('revealed');
  btn.innerHTML = ICONS.eye;
  btn.title = '隐藏';
  btn.setAttribute('aria-label', '隐藏敏感信息');
  btn.disabled = false;
  _revealedMasks.add(span);
  _startAutoHideTimer(span);
}

function _hideMaskEl(span) {
  if (!span.classList.contains('revealed')) return;
  const textEl = span.querySelector('.sx-mask-text');
  const btn = span.querySelector('.sx-mask-toggle');
  if (textEl) textEl.textContent = span.dataset.maskDisplay;
  span.classList.remove('revealed');
  if (btn) {
    btn.innerHTML = ICONS.eyeOff;
    btn.title = '显示';
    btn.setAttribute('aria-label', '显示敏感信息');
    btn.disabled = false;
  }
  _clearAutoHideTimer(span);
  _revealedMasks.delete(span);
}

function _startAutoHideTimer(span) {
  _clearAutoHideTimer(span);
  span._maskAutoTimer = setTimeout(() => { if (span.isConnected) _hideMaskEl(span); }, MASK_AUTO_HIDE_MS);
}
function _clearAutoHideTimer(span) {
  if (span._maskAutoTimer) { clearTimeout(span._maskAutoTimer); span._maskAutoTimer = null; }
}

function _hideAllRevealedMasks() {
  for (const span of [..._revealedMasks]) {
    if (span.isConnected) _hideMaskEl(span);
    else _revealedMasks.delete(span);
  }
}
// 工具调用参数脱敏（去掉 user_id 等内部字段）并格式化展示
function safeToolArgs(args) {
  try {
    const obj = typeof args === 'string' ? JSON.parse(args) : { ...(args || {}) };
    if (obj && typeof obj === 'object') delete obj.user_id;
    return JSON.stringify(obj, null, 2);
  } catch { return String(args == null ? '' : args); }
}

// 渲染工具调用区（可折叠卡片：工具名 + 参数 + 结果）
function toolsElement(toolCalls) {
  const wrap = document.createElement('div');
  wrap.className = 'chat-tools-detail';
  const header = document.createElement('div');
  header.className = 'chat-tools-header';
  header.innerHTML = `${ICONS.database}<span>查阅了 ${toolCalls.length} 个工具调用</span><svg class="chevron" viewBox="0 0 24 24" fill="currentColor"><path d="M9 6l6 6-6 6z"/></svg>`;
  header.addEventListener('click', () => wrap.classList.toggle('expanded'));
  wrap.appendChild(header);
  const body = document.createElement('div');
  body.className = 'chat-tools-body';
  toolCalls.forEach(tc => {
    const card = document.createElement('div');
    card.className = 'tool-card';
    const resultHtml = tc.result != null
      ? `<div class="tool-result"><div class="tool-result-label">结果</div><pre>${escapeHtml(typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result))}</pre></div>`
      : '';
    card.innerHTML = `<div class="tool-card-head"><span class="tool-name">${escapeHtml(tc.tool)}</span></div><pre class="tool-args">${escapeHtml(safeToolArgs(tc.args))}</pre>${resultHtml}`;
    body.appendChild(card);
  });
  enhanceMaskedContent(body);
  wrap.appendChild(body);
  return wrap;
}

// 在流式过程中把工具区更新到 assistant 节点（气泡后、复制按钮前）
function updateToolsInMessage(msgEl, toolCalls) {
  if (!toolCalls || !toolCalls.length) return;
  const fresh = toolsElement(toolCalls);
  const old = msgEl.querySelector('.chat-tools-detail');
  const anchor = msgEl.querySelector('.chat-msg-actions');
  if (old) old.replaceWith(fresh);
  else if (anchor) msgEl.insertBefore(fresh, anchor);
  else msgEl.appendChild(fresh);
}

// 构造单条消息 DOM 节点（assistant 用 markdown，含复制按钮与工具区）
// 从工具调用结果提取引用文件名（对齐 landing figure 的药丸文件来源 chip）
function extractCiteFiles(toolCalls) {
  const files = [];
  (toolCalls || []).forEach(tc => {
    if (!/search_files|qa|summarize_file|read_file/.test(tc.tool || '')) return;
    try {
      const data = typeof tc.result === 'string' ? JSON.parse(tc.result) : tc.result;
      const arr = Array.isArray(data) ? data : (data && (data.results || data.files || data.items)) || [];
      arr.forEach(f => { if (f && f.name) files.push(f.name); });
    } catch { /* result 非预期格式则跳过 */ }
  });
  return [...new Set(files)].slice(0, 5);
}

function messageElement(msg) {
  const wrap = document.createElement('div');
  wrap.className = `chat-message ${msg.role}`;
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  if (msg.role === 'assistant') {
    bubble.classList.add('markdown');
    bubble.innerHTML = renderMarkdown(msg.content);
    enhanceMaskedContent(bubble);
  } else {
   bubble.textContent = msg.content; // 用户消息纯文本，防 XSS
    enhanceMaskedContent(bubble); // 历史消息可能含脱敏 token（用户曾粘贴敏感信息）
  }
  wrap.appendChild(bubble);
  if (msg.role === 'assistant') {
    const citeFiles = extractCiteFiles(msg.tool_calls);
    if (citeFiles.length) {
      const chips = document.createElement('div');
      chips.className = 'chat-cite-files';
      chips.innerHTML = citeFiles.map(n => `<span class="chat-cite-chip">${ICONS.file}<span class="chat-cite-name">${escapeHtml(n)}</span></span>`).join('');
      wrap.appendChild(chips);
    }
    if (msg.tool_calls && msg.tool_calls.length) updateToolsInMessage(wrap, msg.tool_calls);
    const actions = document.createElement('div');
    actions.className = 'chat-msg-actions';
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'chat-msg-copy';
    copyBtn.title = '复制';
    copyBtn.innerHTML = COPY_SVG;
    copyBtn.addEventListener('click', async () => {
      // Copy what's displayed (masked or revealed), not raw tokens
      const clone = bubble.cloneNode(true);
      clone.querySelectorAll('.sx-mask-toggle').forEach(b => b.remove());
      const ok = await copyToClipboard(clone.textContent || '');
      Toast.show(ok ? '已复制' : '复制失败', ok ? 'success' : 'error', 1500);
    });
    actions.appendChild(copyBtn);
    wrap.appendChild(actions);
  }
  return wrap;
}

async function renderChat() {
  document.getElementById('main-content').innerHTML = `
    <div class="topbar">
      <div class="topbar-title">AI 助手</div>
      <div class="topbar-spacer"></div>
      <button class="btn btn-secondary" id="btn-clear-chat">清空对话</button>
    </div>
    <div class="chat-container">
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input-area">
        <div class="chat-input-wrapper">
          <textarea class="chat-input" id="chat-input" placeholder="问点什么..." rows="1"></textarea>
          <button class="btn btn-primary btn-icon-only" id="btn-send" title="发送">${ICONS.send}</button>
        </div>
      </div>
    </div>
  `;
  try {
    const res = await API.get('/api/chat/history?limit=50');
    const data = await res.json();
    chatMessages = (data.messages || []).reverse();
  } catch { chatMessages = []; }
  const container = document.getElementById('chat-messages');
  if (!chatMessages.length && container) {
    container.innerHTML = `
      <div class="chat-welcome">
        <div class="chat-welcome-icon">${ICONS.chat}</div>
        <h2 class="chat-welcome-title">问点什么</h2>
        <p class="chat-welcome-desc">我会翻遍你的档案室，找到文件、读内容、再回答。</p>
        <div class="chat-welcome-hints">
          <button class="chat-hint" data-hint="找一下上个月的报价">找一下上个月的报价</button>
          <button class="chat-hint" data-hint="存了哪些学习资料">存了哪些学习资料</button>
          <button class="chat-hint" data-hint="哪些文件很久没用了">哪些文件很久没用了</button>
          <button class="chat-hint" data-hint="存储用了多少空间">存储用了多少空间</button>
        </div>
      </div>`;
    container.querySelectorAll('.chat-hint').forEach(btn => {
      btn.addEventListener('click', () => {
        const inp = document.getElementById('chat-input');
        if (inp) { inp.value = btn.dataset.hint; inp.focus(); }
      });
    });
  } else if (chatMessages.length) {
    renderChatMessages();
  }
  document.getElementById('btn-send').addEventListener('click', () => {
    if (chatSending) { if (currentChatAbort) currentChatAbort.abort(); }
    else sendChatMessage();
  });
  document.getElementById('btn-clear-chat').addEventListener('click', async () => {
    if (!await confirmDialog({ title: '清空对话', message: '确定清空所有对话历史？此操作无法撤销。', confirmText: '清空', danger: true })) return;
    await API.del('/api/chat/history');
    chatMessages = [];
    renderChat();
  });
  const input = document.getElementById('chat-input');
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!chatSending) sendChatMessage(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; });
  input.focus();
}

function renderChatMessages() {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  container.innerHTML = '';
  chatMessages.forEach(msg => container.appendChild(messageElement(msg)));
  scrollChat(container);
}

function setSendButtonState(state) {
  const btn = document.getElementById('btn-send');
  if (!btn) return;
  if (state === 'stop') {
    btn.classList.add('is-stop');
    btn.title = '停止生成';
    btn.innerHTML = STOP_ICON;
  } else {
    btn.classList.remove('is-stop');
    btn.title = '发送';
    btn.innerHTML = ICONS.send;
  }
}

async function sendChatMessage() {
  if (chatSending) return;
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  chatSending = true;
  const userMsg = { role: 'user', content: text, tool_calls: [] };
  chatMessages.push(userMsg);
  input.value = ''; input.style.height = 'auto';

  const container = document.getElementById('chat-messages');
  const welcome = container.querySelector('.chat-welcome');
  if (welcome) welcome.remove();
  container.appendChild(messageElement(userMsg));

  const assistantMsg = { role: 'assistant', content: '', tool_calls: [] };
  chatMessages.push(assistantMsg);
  const assistantEl = messageElement(assistantMsg);
  container.appendChild(assistantEl);
  const typingEl = document.createElement('div');
  typingEl.className = 'typing-indicator';
  typingEl.innerHTML = '正在思考<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>';
  container.appendChild(typingEl);
  scrollChat(container);

  setSendButtonState('stop');
  const controller = new AbortController();
  currentChatAbort = controller;
  const bubble = assistantEl.querySelector('.chat-bubble');

  try {
    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.detail || `HTTP ${res.status}`);
    }
    if (typingEl.isConnected) typingEl.remove();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let payload;
        try { payload = JSON.parse(line.slice(6)); } catch { continue; }
        if (payload.type === 'tool') {
          assistantMsg.tool_calls = assistantMsg.tool_calls || [];
          assistantMsg.tool_calls.push(payload.data);
          updateToolsInMessage(assistantEl, assistantMsg.tool_calls);
          scrollChat(container);
        } else if (payload.type === 'delta') {
          assistantMsg.content += payload.data;
          bubble.innerHTML = renderMarkdown(assistantMsg.content);
          enhanceMaskedContent(bubble);
          scrollChat(container);
        } else if (payload.type === 'done') {
          assistantMsg.content = payload.data.reply || assistantMsg.content || '(无回复)';
          assistantMsg.tool_calls = payload.data.tool_calls || assistantMsg.tool_calls;
          bubble.innerHTML = renderMarkdown(assistantMsg.content);
          enhanceMaskedContent(bubble);
          updateToolsInMessage(assistantEl, assistantMsg.tool_calls);
          scrollChat(container);
        } else if (payload.type === 'error') {
          assistantMsg.content = '出错了: ' + payload.data;
          bubble.innerHTML = renderMarkdown(assistantMsg.content);
          enhanceMaskedContent(bubble);
        }
      }
    }
    if (!assistantMsg.content) {
      assistantMsg.content = controller.signal.aborted ? '（已停止）' : '(无回复)';
      bubble.innerHTML = renderMarkdown(assistantMsg.content);
      enhanceMaskedContent(bubble);
    }
  } catch (err) {
    if (typingEl.isConnected) typingEl.remove();
    if (err && err.name === 'AbortError') {
      assistantMsg.content += assistantMsg.content ? '\n\n_（已停止）_' : '（已停止）';
    } else {
      assistantMsg.content = '出错了: ' + (err && err.message || '未知错误');
    }
    bubble.innerHTML = renderMarkdown(assistantMsg.content);
    enhanceMaskedContent(bubble);
  } finally {
    chatSending = false;
    currentChatAbort = null;
    setSendButtonState('send');
  }
}

// ============ Transfer Assistant (文件传输助手) ============
let transferMessages = [];
let transferHydrated = false; // 每次进视图首次同步时不播进场动画，避免整列一起动
// 离场兜底移除时长（ms）——需与 app.css 中 .transfer-msg.is-leaving 的 transition 时长（.18s）保持同步
const TRANSFER_LEAVE_MS = 220;

// 增量协调用的稳定 key：乐观消息用 _cid（= tempId），服务端消息用 id；
// 透传 _cid 让「临时节点 → 真实节点」原地变形，而不是删一个再插一个
function transferMsgKey(msg) { return msg._cid || String(msg.id); }

async function renderTransfer() {
  document.getElementById('main-content').innerHTML = `
    <div class="topbar">
      <div class="topbar-title">传输助手</div>
      <div class="topbar-spacer"></div>
      <button class="btn btn-secondary btn-icon-only" id="btn-transfer-refresh" title="刷新">${ICONS.refresh}</button>
    </div>
    <div class="chat-container transfer-container">
      <div class="chat-messages transfer-messages" id="transfer-messages" aria-live="polite" aria-relevant="additions removals">${transferLoadingHTML()}</div>
      <div class="chat-input-area transfer-input-area">
        <input type="file" id="transfer-file-input" multiple hidden>
        <div class="chat-input-wrapper transfer-input-wrapper">
          <button class="btn btn-secondary btn-icon-only" id="btn-transfer-attach" title="发送文件">${ICONS.add}</button>
          <textarea class="chat-input" id="transfer-input" placeholder="发送文字或文件给自己..." rows="1"></textarea>
          <button class="btn btn-primary btn-icon-only" id="btn-transfer-send" title="发送">${ICONS.send}</button>
        </div>
      </div>
    </div>`;
  transferHydrated = false; // 每次进视图首屏不播进场动画
  await loadTransferMessages();
  // 消息列表操作统一走容器级委托（节点存活后逐元素绑定会重复触发）；每次进视图容器都是新建，不会跨导航堆叠
  document.getElementById('transfer-messages').addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    if (a === 'download') { e.stopPropagation(); downloadFile(el.dataset.path, { fileId: el.dataset.fileId, fileName: el.dataset.name }); }
    else if (a === 'delete-msg') { e.stopPropagation(); deleteTransferMessage(el.dataset.id); }
    else if (a === 'retry-msg') { e.stopPropagation(); retryTransferMessage(el.dataset.id); }
    else if (a === 'preview-transfer') previewTransferFile(el.dataset.path, el.dataset.name, { fileId: el.dataset.fileId });
    else if (a === 'preview-video') previewVideo(el.dataset.path, el.dataset.name, { fileId: el.dataset.fileId });
  });
  document.getElementById('btn-transfer-send').addEventListener('click', sendTransferText);
  document.getElementById('btn-transfer-refresh').addEventListener('click', loadTransferMessages);
  document.getElementById('btn-transfer-attach').addEventListener('click', () => document.getElementById('transfer-file-input').click());
  document.getElementById('transfer-file-input').addEventListener('change', (e) => {
    if (e.target.files.length) handleTransferFiles(e.target.files);
    e.target.value = '';
  });
  const input = document.getElementById('transfer-input');
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTransferText(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; });
  input.focus();
}

// 传输助手加载占位：首次进入视图拉取消息期间避免列表区空白
function transferLoadingHTML() {
  return `<div class="transfer-loading">
    <div class="transfer-loading-spinner"></div>
    <p class="transfer-loading-text">加载中…</p>
  </div>`;
}

async function loadTransferMessages() {
  try {
    const res = await API.get('/api/transfer/messages?limit=200');
    const data = await res.json();
    // 保留仍在发送中的乐观消息（避免刷新/切换页面时丢失），追加到服务端列表末尾
    const inflight = transferMessages.filter(m => m._status === 'sending');
    // 透传 _cid：服务端消息不带 _cid，按 id 匹配回本地已确认消息的 _cid，保持 key 连续，
    // 否则刷新时已确认消息会「孤儿淡出 + 重建滑入」闪一下
    const cidById = new Map();
    for (const m of transferMessages) if (m._cid && m.id) cidById.set(String(m.id), m._cid);
    transferMessages = [
      ...(data.messages || []).map(m => cidById.has(String(m.id)) ? { ...m, _cid: cidById.get(String(m.id)) } : m),
      ...inflight,
    ];
  } catch { transferMessages = []; }
  renderTransferMessages();
}

// 单条消息的内层 HTML（不含 .transfer-msg 外壳）——从旧的全量模板里抽出，行为零变化
function transferMessageInnerHTML(msg) {
  const time = formatDateTime(msg.created_at);
  const delBtn = `<button class="transfer-del" title="删除" data-action="delete-msg" data-id="${escapeHtml(msg.id)}" ${msg._status === 'deleting' ? 'disabled' : ''}>${ICONS.trash}</button>`;
  if (msg.type === 'text') {
    // 状态指示：发送中(转圈) / 失败(红色感叹号,可点重试) / 成功(无)
    let statusIcon = '';
    if (msg._status === 'sending') {
      statusIcon = `<span class="transfer-status sending" title="发送中"></span>`;
    } else if (msg._status === 'failed') {
      statusIcon = `<span class="transfer-status failed" data-action="retry-msg" data-id="${escapeHtml(msg.id)}" title="发送失败：${escapeHtml(msg._error || '点击重试')}"></span>`;
    }
    return `<div class="transfer-msg-body">
        <div class="transfer-text-bubble">${escapeHtml(msg.content).replace(/\n/g, '<br>')}</div>
        <span class="transfer-time">${time}</span>
      </div>
      ${statusIcon}
      ${delBtn}`;
  }
  const f = msg.file;
  if (!f) return '';
  const guardBadge = f.guard_status === 'warning'
    ? `<span class="transfer-file-guard warning">敏感提醒</span>` : '';
  // 图片/视频/音频直接内联显示（参考微信传输助手）；svg 后端拒绝预览(415)、pdf/文本仍走文件卡片
  // 全部用 file_id（UUID）引用文件，真实路径永不出现在 DOM / 网络请求中
  const pType = getPreviewType(f.name);
  const isSvg = f.name.toLowerCase().endsWith('.svg');
  const fid = f.file_id || '';
  const previewUrl = fid
    ? `/api/files/preview?file_id=${encodeURIComponent(fid)}`
    : `/api/files/preview?path=${encodeURIComponent(f.path || '')}`;
  const dlAttrs = fid ? `data-file-id="${escapeHtml(fid)}"` : `data-path="${escapeHtml(f.path || '')}"`;
  const mediaActions = `<div class="transfer-media-actions"><button class="transfer-media-dl" title="下载" data-action="download" ${dlAttrs}>${ICONS.download}</button>${delBtn}</div>`;
  if ((pType === 'image' && !isSvg) || pType === 'video' || pType === 'audio') {
    let media = '';
    if (pType === 'image') {
      media = `<img class="transfer-media-img" src="${previewUrl}" alt="${escapeHtml(f.name)}" loading="lazy" data-action="preview-transfer" ${dlAttrs} data-name="${escapeHtml(f.name)}">`;
    } else if (pType === 'video') {
      media = `<div class="transfer-media-video" data-action="preview-video" ${dlAttrs} data-name="${escapeHtml(f.name)}">
        <video class="transfer-media-video-thumb" src="${previewUrl}#t=0.1" muted preload="metadata" playsinline></video>
        <span class="transfer-media-play">${ICONS.play}</span>
      </div>`;
    } else {
      media = `<audio class="transfer-media-audio" src="${previewUrl}" controls preload="metadata"></audio>`;
    }
    return `<div class="transfer-msg-body">
        <div class="transfer-media">${media}</div>
        <span class="transfer-time">${time}</span>
        ${guardBadge}
      </div>
      ${mediaActions}`;
  }
  const fi = getFileIcon(f.name, false);
  return `<div class="transfer-msg-body">
      <div class="transfer-file-card" data-action="preview-transfer" ${dlAttrs} data-name="${escapeHtml(f.name)}">
        <div class="transfer-file-icon ${fi.cls}">${fi.icon}</div>
        <div class="transfer-file-info">
          <div class="transfer-file-name">${escapeHtml(f.name)}</div>
          <div class="transfer-file-meta">
            <span>${formatSize(f.size)}</span>
            <span class="transfer-saved">✓ 已存入文件库</span>
          </div>
        </div>
        <button class="transfer-file-dl" title="下载" data-action="download" ${dlAttrs}>${ICONS.download}</button>
      </div>
      <span class="transfer-time">${time}</span>
      ${guardBadge}
    </div>
    ${delBtn}`;
}

// 节点渲染签名：涵盖所有影响渲染的字段。仅当签名变化时才重建内层，
// 因此媒体（img/video/audio）只在消息真正变化时才重新解码，常态无变化时零开销（也不丢弃任何字段）。
// 注意：_status / _leaving 纳入签名，让 deleting 过渡态 / 离场淡出能触发 patch；
//       但 patchTransferNode 会对"仅 _status/_leaving 之一变化"走轻量分支，避免媒体重解码。
// 签名格式：
//   文本: [type(0), id(1), status(2), leaving(3)]
//   文件: [type(0), id(1), typeField(2), status(3), leaving(4), guard(5), name(6), size(7)]
// 仅状态变化时走轻量分支 ↔︎ 下标 >= 2 的字段集合相等（对文本：status+leaving；对文件：typeField 也被包含）
function transferMsgSignature(msg) {
  if (msg.type === 'text') return `t|${msg.id}|${msg._status || ''}|${msg._leaving || ''}`;
  const f = msg.file || {};
  return `f|${msg.id}|${msg.type}|${msg._status || ''}|${msg._leaving || ''}|${f.guard_status || ''}|${f.name || ''}|${f.size || ''}`;
}

// 新建一条消息节点；animate 时加 is-new 触发进场动画
function createTransferNode(msg, animate) {
  const node = document.createElement('div');
  node.className = 'transfer-msg';
  node.dataset.key = transferMsgKey(msg);
  node.dataset.sig = transferMsgSignature(msg);
  node.innerHTML = transferMessageInnerHTML(msg);
  enhanceMaskedContent(node); // 传输助手消息脱敏（便签文字 + 敏感文件名）
  if (animate) node.classList.add('is-new');
  if (msg._status === 'deleting') node.classList.add('is-deleting');
  if (msg._leaving) node.classList.add(MSG_LEAVING_CLASS);
  return node;
}

// 原地修补已存在的节点：签名未变则跳过（媒体不重建、不重新解码）；变了才重排内层
// （乐观→确认变形时 id 变化 → 签名变 → 重建，按钮上的 data-id 一并更新为真实 id）
// 轻量分支：仅 _status 或 _leaving 变化（通常是进入/退出 deleting 过渡态，或开始淡出）时，
//           只更新 class 与按钮 disabled，不重建 innerHTML，避免媒体重解码闪烁。
// whole-fields diff 计算：判断"除状态位外所有字段相等"
function patchTransferNode(node, msg) {
  const sig = transferMsgSignature(msg);
  if (node.dataset.sig === sig) return;
  const prev = (node.dataset.sig || '').split('|');
  const next = sig.split('|');
  // 仅状态变化（status 或 leaving 字段变化，其余字段相同）时走轻量分支，避免重建 innerHTML。
  // 稳定字段：type(0)+id(1)+status(2)+leaving(3)（text 签名 4 段 / file 签名 8 段）；
  // 仅 status/leaving 一位变化 ⇔ base 等长 + 类型+id 相等 + status 或 leaving 至少一变 + 4 之后的基础字段完全相等。
  const minLen = Math.min(prev.length, next.length);
  const basePrev = prev.slice(0, Math.min(minLen, 4));
  const baseNext = next.slice(0, Math.min(minLen, 4));
  const baseEqual = basePrev.length === baseNext.length
    && basePrev[0] === baseNext[0] && basePrev[1] === baseNext[1]
    && (basePrev[2] !== baseNext[2] || basePrev[3] !== baseNext[3]);
  const onlyStatusChanged = prev.length === next.length && baseEqual
    && prev.slice(4).join('|') === next.slice(4).join('|');
  node.dataset.sig = sig;
  if (onlyStatusChanged) {
    node.classList.toggle('is-deleting', msg._status === 'deleting');
    node.classList.toggle(MSG_LEAVING_CLASS, !!msg._leaving);
    if (msg._leaving) node.dataset.leaving = '1';
    else if (node.dataset.leaving) delete node.dataset.leaving;
    // 文本消息的状态图标（sending 转圈 / failed 重试按钮）和删除态按钮 disabled 都在
    // .transfer-msg-body 及其同级节点内，需局部 innerHTML 更新（轻量分支不重建整个 .transfer-msg）。
    if (msg.type === 'text') refreshTransferTextBody(node, msg);
    const delBtn = node.querySelector('.transfer-del');
    if (delBtn) delBtn.disabled = msg._status === 'deleting';
    return;
  }
  node.innerHTML = transferMessageInnerHTML(msg);
  enhanceMaskedContent(node);
  node.classList.toggle('is-deleting', msg._status === 'deleting');
  node.classList.toggle(MSG_LEAVING_CLASS, !!msg._leaving);
  // 让 transferMessages 中的 _leaving 消息还能被 renderTransferMessages 的 leaving 检测命中
  if (msg._leaving) node.dataset.leaving = '1';
  // 全量重建后也要同步删除按钮的 disabled 状态，否则键盘用户可通过 Tab+Enter 绕过防重复
  const delBtnAfter = node.querySelector('.transfer-del');
  if (delBtnAfter) delBtnAfter.disabled = msg._status === 'deleting';
}

// 局部刷新文本消息的 .transfer-msg-body 及其同级状态/删除按钮（轻量分支专用，不重建外壳节点）。
function refreshTransferTextBody(node, msg) {
  const body = node.querySelector(':scope > .transfer-msg-body');
  if (body) body.innerHTML = transferMessageTextContentHTML(msg);
  const oldStatus = node.querySelector(':scope > .transfer-status');
  const newStatus = transferMessageStatusIconHTML(msg);
  if (oldStatus && newStatus) oldStatus.replaceWith(new DOMParser().parseFromString(newStatus, 'text/html').body.firstElementChild);
  else if (oldStatus) oldStatus.remove();
  else if (newStatus) {
    const tmp = document.createElement('div');
    tmp.innerHTML = newStatus;
    node.insertBefore(tmp.firstElementChild, node.querySelector(':scope > .transfer-del'));
  }
  const delBtn = node.querySelector(':scope > .transfer-del');
  if (delBtn) delBtn.disabled = msg._status === 'deleting';
}

function transferMessageTextContentHTML(msg) {
  const time = formatDateTime(msg.created_at);
  return `<div class="transfer-text-bubble">${escapeHtml(msg.content).replace(/\n/g, '<br>')}</div>
    <span class="transfer-time">${time}</span>`;
}

function transferMessageStatusIconHTML(msg) {
  if (msg._status === 'sending') {
    return '<span class="transfer-status sending" title="发送中"></span>';
  } else if (msg._status === 'failed') {
    return `<span class="transfer-status failed" data-action="retry-msg" data-id="${escapeHtml(msg.id)}" title="发送失败：${escapeHtml(msg._error || '点击重试')}"></span>`;
  }
  return '';
}

// 增量协调：按 key 对账，保留未变节点（媒体不重解码），只动真正变化的条目
function renderTransferMessages() {
  const container = document.getElementById('transfer-messages');
  if (!container) return;
  // 慢网/断网时若存在正在删除的消息，禁用刷新按钮避免"回流"（删到一半的服务端记录被重新拉回列表）
  const hasDeleting = transferMessages.some(m => m._status === 'deleting');
  const refreshBtn = document.getElementById('btn-transfer-refresh');
  if (refreshBtn) {
    refreshBtn.disabled = hasDeleting;
    refreshBtn.title = hasDeleting ? '删除中，请稍候…' : '刷新';
  }
  const active = transferMessages.filter(m => !m._leaving);
  // leaving 节点必须保留在 DOM 里让其 is-leaving 动画走完，不能跳到空态。
  // 若数组已全空：(a) 还有 leaving 节点在 DOM 里 → 等 delayedRemove 兜底移除；(b) 真的没了 → 渲染空态。
  if (!active.length) {
    if (!transferMessages.length && !container.querySelector('.transfer-msg.is-leaving')) {
      container.innerHTML = `
        <div class="transfer-empty">
          <div class="transfer-empty-icon">${ICONS.transfer}</div>
          <p class="transfer-empty-title">文件传输助手</p>
          <p class="transfer-empty-desc">把文字或文件发给自己，文字随手记，文件自动存入文件库。</p>
        </div>`;
      return;  // 空列表不算首屏填充：保持 hydrated=false，待真正出现内容时首屏仍不动画并直接吸底
    }
    // 数组已清空但还有 leaving 节点在动画中：本次 render 不再对账，等 delayedRemove 兜底（孤儿 path 会处理）
    if (!transferMessages.length) return;
  }
  const firstPaint = !transferHydrated && !container.querySelector('.transfer-msg');  // 进视图首次填充：直接吸底 + 跳过进场动画
  // 一遍扫完：清掉占位（loading / empty），同时收集可复用的 .transfer-msg（跳过无 key 的）
  // leaving 节点也必须放进 existing Map —— 否则 leaving 消息在主循环里找不到对应节点，会被重新
  // createTransferNode 创建一个不带 is-leaving 的新节点，导致"一边淡出一边新出现"的双写视觉错误。
  const existing = new Map();
  Array.from(container.children).forEach(child => {
    if (!child.classList || !child.classList.contains('transfer-msg')) child.remove();
    else {
      const k = child.dataset && child.dataset.key;
      if (k) existing.set(k, child);
    }
  });
  // 按 transferMessages 顺序对账：命中即修补/仅更新 leaving 类；未命中（理论上不应发生）即新建。
  // 跳过正在离开的消息——它们已被 setMSG_LEAVING_CLASS + dataset.leaving，无需 patch 也无需重建。
  let ref = container.firstChild;
  const skipDead = () => { while (ref && (!ref.dataset || !ref.dataset.key || ref.dataset.leaving)) ref = ref.nextSibling; };
  for (const msg of transferMessages) {
    if (msg._leaving) continue; // 让 is-leaving 动画独自走完，不做任何 DOM 变动
    const k = transferMsgKey(msg);
    let node = existing.get(k);
    if (node) { existing.delete(k); patchTransferNode(node, msg); }
    else { node = createTransferNode(msg, transferHydrated); }
    skipDead();
    if (node === ref) { ref = ref.nextSibling; }
    else { container.insertBefore(node, ref); } // ref 为 null 时等价 appendChild
  }
  // existing 剩余即被删除的孤儿：淡出后移除
  for (const node of existing.values()) {
    node.dataset.key = '';        // 立即摘 key，防止后续 render 复用正在离场的节点
    node.dataset.leaving = '1';
    node.classList.add(MSG_LEAVING_CLASS);
    setTimeout(() => node.remove(), TRANSFER_LEAVE_MS);
  }
  // 首屏直接吸底（展示最新内容，恢复旧版「打开即看最新」的行为）；其后才走智能吸底
  if (firstPaint) scrollChat(container);
  else scrollChat(container, true);
  transferHydrated = true;
}

async function sendTransferText() {
  const input = document.getElementById('transfer-input');
  const text = input.value.trim();
  if (!text) return;
  // 乐观渲染：回车后立即显示在内容框中，不等接口成功（参考微信文件传输助手）
  // 客户端脱敏：乐观消息先做 PII 遮罩（无 reveal 按钮），服务端返回后替换为可 reveal 的版本
  const tempId = 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  transferMessages.push({ id: tempId, _cid: tempId, type: 'text', content: _clientMaskPII(text), _raw: text, created_at: new Date().toISOString(), _status: 'sending' });
  input.value = ''; input.style.height = 'auto';
  renderTransferMessages();
  await _sendTransferTextOnce(tempId, text);
}

async function _sendTransferTextOnce(tempId, text) {
  try {
    const res = await API.post('/api/transfer/text', { content: text });
    if (!res.ok) {
      // 乐观项已被用户删除/被刷新覆盖：不再补回失败态
      if (!transferMessages.some(m => m.id === tempId)) return;
      const d = await res.json().catch(() => ({}));
      _markTransferFailed(tempId, d.detail || '发送失败');
      return;
    }
    const msg = await res.json();
    // 乐观项已被用户删除/被刷新覆盖：不再让服务端新建的消息重新出现
    if (!transferMessages.some(m => m.id === tempId)) return;
    const idx = transferMessages.findIndex(m => m.id === tempId);
    if (msg && msg.id !== tempId && transferMessages.some(m => m.id === msg.id)) {
      // 服务端消息已在列表中（刷新时已拉取）：仅移除乐观临时项，避免重复
      if (idx >= 0) transferMessages.splice(idx, 1);
    } else if (idx >= 0) {
      transferMessages[idx] = { ...msg, _cid: transferMessages[idx]._cid };  // 透传 _cid：临时节点原地变形为真实消息（key 不变）
    } else {
      transferMessages.push(msg);  // 临时项已不在（被删/被刷新覆盖），补回服务端消息
    }
    renderTransferMessages();
  } catch (err) {
    if (!transferMessages.some(m => m.id === tempId)) return;
    _markTransferFailed(tempId, err.message || '发送失败');
  }
}

function _markTransferFailed(tempId, reason) {
  const idx = transferMessages.findIndex(m => m.id === tempId);
  if (idx < 0) return;
  transferMessages[idx]._status = 'failed';
  transferMessages[idx]._error = reason;
  renderTransferMessages();
}

async function retryTransferMessage(tempId) {
  const msg = transferMessages.find(m => m.id === tempId);
  if (!msg || msg._status !== 'failed') return;
  msg._status = 'sending';
  delete msg._error;
  renderTransferMessages();
  // Retry sends the original (unmasked) text to the server; display stays client-masked.
  await _sendTransferTextOnce(tempId, msg._raw || msg.content);
}

async function handleTransferFiles(fileList) {
  const files = Array.from(fileList);
  for (const file of files) {
    const item = UploadManager.add(file.name, file.size);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/transfer/file');
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          UploadManager.update(item.id, { progress: Math.round((e.loaded / e.total) * 100) });
        }
      });
      const result = await new Promise((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
          else { try { reject(JSON.parse(xhr.responseText)); } catch { reject({ detail: `HTTP ${xhr.status}` }); } }
        };
        xhr.onerror = () => reject({ detail: '网络错误' });
        xhr.send(formData);
      });
      UploadManager.update(item.id, { progress: 100, status: 'done' });
      transferMessages.push(result);
      renderTransferMessages();
      if (result.guard_warning) Toast.show(`Guard 提醒: 该文件可能含敏感内容`, 'warning', 5000);
    } catch (err) {
      UploadManager.update(item.id, { progress: 100, status: 'error' });
      Toast.show(`${file.name} 发送失败: ${err.detail || '未知错误'}`, 'error');
    }
  }
  UploadManager.hide();
}

// 消息内嵌删除操作的默认超时（ms）。网络慢/断网时避免永远卡在过渡态。
const TRANSFER_DELETE_TIMEOUT_MS = 12000;

// 类名常量：避免字符串散落在多处，改 CSS class 时只改这一处。
const MSG_LEAVING_CLASS = 'is-leaving';

// DEBUG 开关：通过 localStorage.debug_transfer=1 在浏览器中开启前端诊断日志
// （避免在生产环境打印敏感信息；通过 console.debug 分组，DevTools 默认隐藏）。
function _isDebug() {
  try { return localStorage.getItem('debug_transfer') === '1'; } catch { return false; }
}
function _logTransferError(name, id, payload) {
  if (!_isDebug()) return;
  console.debug(`[transfer:${name}] id=${id}`, payload);
}

// withTimeout：给任意 Promise 加超时，超时后 reject（不取消原请求，只是放弃等待）。
function withTimeout(promise, ms, msg) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    promise.then(v => { clearTimeout(t); resolve(v); },
               e => { clearTimeout(t); reject(e); });
  });
}

async function deleteTransferMessage(id) {
  if (!await confirmDialog({ title: '删除记录', message: '确定删除这条记录？', confirmText: '删除', danger: true })) return;
  const local = transferMessages.find(m => m.id === id);
  // 乐观/失败消息（_status 非空但非 deleting）：无真实服务端记录，仅本地移除
  if (local && local._status && local._status !== 'deleting') {
    transferMessages = transferMessages.filter(m => m.id !== id);
    renderTransferMessages();
    return;
  }
  // 防重复：不存在 或 已在删除中
  if (!local || local._status === 'deleting') return;

  // 立即进入本地过渡态：让界面在弱网/慢网下也有即时反馈，消除"空白时间"
  local._status = 'deleting';
  renderTransferMessages();

  const rollback = () => {
    const m = transferMessages.find(x => x.id === id);
    if (m && m._status === 'deleting') delete m._status;
    renderTransferMessages();
  };

  try {
    const res = await withTimeout(
      API.del(`/api/transfer/${id}`),
      TRANSFER_DELETE_TIMEOUT_MS,
      '删除超时，请检查网络后重试'
    );
    // 404 视为幂等成功：多端场景下可能已被其他设备删除
    if (res.ok || res.status === 404) {
      // 走 is-leaving 淡出动画再移除：避免"删最后一条时直接跳到空态"的跳闪，
      // 也让删除反馈更丝滑（与发送失败的 orphan 淡出共用一套协调逻辑）。
      const leaving = transferMessages.find(m => m.id === id);
      if (leaving) leaving._leaving = '1';
      renderTransferMessages();
      // 兜底移除：即使 delayedRemove 窗口内发生其它 render 把 leaving 节点意外重建，
      // 这个超时也会保证最终把"已不在数组中的消息对应的 DOM 节点"清掉。
      setTimeout(() => {
        transferMessages = transferMessages.filter(m => m.id !== id);
        renderTransferMessages();
        // 清理可能残留的 is-leaving 孤儿节点（覆盖"删最后一条"等边界场景）
        document.querySelectorAll('.transfer-msg.is-leaving').forEach(n => n.remove());
      }, TRANSFER_LEAVE_MS);
      Toast.show('已删除', 'success');
    } else {
      const d = await res.json().catch(() => ({}));
      _logTransferError('delete_server_error', id, { status: res.status, detail: d.detail });
      rollback();
      Toast.show(d.detail || '删除失败', 'error');
    }
  } catch (err) {
    _logTransferError('delete_exception', id, { message: err.message, isTimeout: err.message.includes('超时') });
    rollback();
    Toast.show(err.message || '删除出错', 'error');
  }
}

function previewTransferFile(path, name, opts = {}) {
  previewFile(path, name, opts);
}

// 视频弹窗播放：消息流里点缩略图后，在固定覆盖层用直接 src 流式播放（支持 range seek）。
// 不用 blob：避免整文件下载到内存；也避免内联 video 全屏退出时触发消息列表 reflow 卡顿。
function previewVideo(path, name, opts = {}) {
  const fileName = name || (path ? path.split('/').pop() : 'video');
  const fid = opts.fileId || '';
  const previewSrc = fid
    ? `/api/files/preview?file_id=${encodeURIComponent(fid)}`
    : `/api/files/preview?path=${encodeURIComponent(path)}`;
  const overlay = document.createElement('div');
  overlay.className = 'preview-overlay preview-video-overlay';
  overlay.innerHTML = `
    <div class="preview-header">
      <div class="preview-title" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</div>
      <div class="preview-actions">
        <button class="icon-btn" id="btn-video-download" title="下载">${ICONS.download}</button>
        <button class="icon-btn" id="btn-video-close" title="关闭">${ICONS.close}</button>
      </div>
    </div>
    <div class="preview-body">
      <video class="preview-video" src="${previewSrc}" controls autoplay playsinline></video>
    </div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  const close = () => { overlay.remove(); document.body.style.overflow = ''; };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#btn-video-close').addEventListener('click', close);
  overlay.querySelector('#btn-video-download').addEventListener('click', () => downloadFile(path, { fileId: fid, fileName }));
  const esc = (e) => {
    if (e.key !== 'Escape') return;
    if (document.fullscreenElement) return;  // 全屏时 esc 仅退出全屏，不关弹窗
    close();
    document.removeEventListener('keydown', esc);
  };
  document.addEventListener('keydown', esc);
}

// ============ Settings ============
async function renderSettings(initialTab) {
  const TAB_ICONS = {
    general: ICONS.database,
    security: ICONS.shield,
    account: ICONS.user,
  };
  const activeTab = initialTab || loadPref('settingsTab', 'general');
  document.getElementById('main-content').innerHTML = `
    <div class="settings-layout">
      <nav class="settings-nav" id="settings-nav">
        <button class="settings-nav-item" data-tab="general">${TAB_ICONS.general}存储与索引</button>
        <button class="settings-nav-item" data-tab="security">${TAB_ICONS.security}安全</button>
        <button class="settings-nav-item" data-tab="account">${TAB_ICONS.account}账户</button>
      </nav>
      <div class="settings-panel">
        <div class="settings-panel-content" id="settings-panel-content"></div>
      </div>
    </div>`;

  // 渲染对应标签面板内容
  function renderTab(tab, persist = true) {
    if (persist) savePref('settingsTab', tab); // 仅用户主动点击时持久化，深链初始渲染不覆盖偏好
    document.querySelectorAll('.settings-nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    const content = document.getElementById('settings-panel-content');
    if (tab === 'general') {
      content.innerHTML = `
        <div class="settings-panel-title">存储与索引</div>
        <div class="settings-panel-desc">查看存储用量与配额，以及检索索引状态。上传的文件会自动建立语义索引，支持自然语言搜索。</div>
        <div class="settings-section">
          <div class="setting-head">
            <div class="setting-head-icon icon-primary">${ICONS.database}</div>
            <div class="setting-head-text"><h3>存储统计</h3><p class="section-desc">查看文件存储使用情况</p></div>
          </div>
          <div class="setting-body" id="stats-content">加载中...</div>
        </div>
        <div class="settings-section">
          <div class="setting-head">
            <div class="setting-head-icon icon-neutral">${ICONS.refresh}</div>
            <div class="setting-head-text"><h3>全文索引</h3><p class="section-desc">重建文件索引以支持语义搜索</p></div>
            <div class="setting-head-action"><button class="btn btn-secondary" id="btn-reindex">${ICONS.refresh}<span>重建索引</span></button></div>
          </div>
        </div>`;
      document.getElementById('btn-reindex').addEventListener('click', rebuildIndex);
      loadStats();
    } else if (tab === 'security') {
      content.innerHTML = `
        <div class="settings-panel-title">安全</div>
        <div class="settings-panel-desc">设备令牌可单条或一键吊销；浏览器默认禁止下载（零痕迹），需要时开临时窗口；建议在公用设备上开启双因子验证。</div>
        <div class="settings-section">
          <div class="setting-head">
            <div class="setting-head-icon icon-neutral">${ICONS.shield}</div>
            <div class="setting-head-text"><h3>PII 服务端脱敏</h3><p class="section-desc">AI 回复中的手机、邮箱、身份证、API Key、银行卡在送达浏览器前自动遮罩，真实值不落前端；需要时可点睛临时揭示。</p></div>
          </div>
          <div class="setting-body">
            <figure class="sx-compare" role="figure" aria-label="PII 服务端脱敏对比：原始回答含明文，送达前端时已遮罩">
              <figcaption class="sx-compare-cap">${ICONS.shield}PII 服务端脱敏 · 原文 → 前端</figcaption>
              <div class="sx-compare-panes">
                <div class="sx-pane">
                  <span class="sx-pane-tag">服务端 · 原始回答</span>
                  <ul class="sx-pane-list">
                    <li><span class="sx-pane-key">手机</span><span class="sx-raw">13800000815</span></li>
                    <li><span class="sx-pane-key">邮箱</span><span class="sx-raw">wangzhiqiang@example.com</span></li>
                    <li><span class="sx-pane-key">身份证</span><span class="sx-raw">110101199003071234</span></li>
                  </ul>
                </div>
                <div class="sx-compare-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></div>
                <div class="sx-pane">
                  <span class="sx-pane-tag">前端可见</span>
                  <ul class="sx-pane-list">
                    <li><span class="sx-pane-key">手机</span><span class="sx-redact">138****0815</span></li>
                    <li><span class="sx-pane-key">邮箱</span><span class="sx-redact">w***@example.com</span></li>
                    <li><span class="sx-pane-key">身份证</span><span class="sx-redact">110***********1234</span></li>
                  </ul>
                </div>
              </div>
            </figure>
          </div>
        </div>
        <div class="settings-section">
          <div class="setting-head">
            <div class="setting-head-icon icon-success">${ICONS.key}</div>
            <div class="setting-head-text"><h3>访问令牌与会话</h3><p class="section-desc">每个设备令牌对应一台机器或一次浏览器会话，吊销即切断访问。</p></div>
            <div class="setting-head-action"><button class="btn btn-primary" id="btn-create-token">${ICONS.upload}<span>创建令牌</span></button></div>
          </div>
          <div class="setting-body">
            <div class="token-list" id="tokens-content"></div>
            <div class="token-danger-zone" id="revoke-all-zone" style="display:none">
              <div class="token-danger-zone-text">
                <strong>紧急下线所有设备与会话</strong>
                <span>吊销你的全部令牌（含当前浏览器会话），你也会立即登出。</span>
              </div>
              <button class="btn btn-danger" id="btn-revoke-all-tokens">${ICONS.shield}<span>吊销全部</span></button>
            </div>
          </div>
        </div>
        <div class="settings-section">
          <div class="setting-head">
            <div class="setting-head-icon icon-warning">${ICONS.download}</div>
            <div class="setting-head-text"><h3>临时下载</h3><p class="section-desc">浏览器端默认禁止下载（零痕迹）。下载需验证登录密码，可选单次授权或时间窗口。</p></div>
          </div>
          <div class="setting-body" id="download-grant-content">加载中...</div>
        </div>
        <div class="settings-section">
          <div class="setting-head">
            <div class="setting-head-icon icon-warning">${ICONS.shield}</div>
            <div class="setting-head-text"><h3>双因子验证</h3><p class="section-desc">用 Google Authenticator 等验证器扫码绑定，开启后登录需额外输入验证码。</p></div>
          </div>
          <div class="setting-body" id="totp-content">加载中...</div>
        </div>
        <div class="settings-section">
          <div class="setting-head">
            <div class="setting-head-icon icon-primary">${ICONS.lock}</div>
            <div class="setting-head-text"><h3>修改密码</h3><p class="section-desc">修改后旧令牌与会话自动失效，需用新密码重新登录</p></div>
          </div>
          <div class="setting-body">
            <div class="setting-form">
              <div class="form-group"><label>原密码</label><input type="password" id="old-pass" class="form-input" placeholder="请输入原密码"></div>
              <div class="form-group"><label>新密码</label><input type="password" id="new-pass" class="form-input" placeholder="请输入新密码"></div>
              <button class="btn btn-primary" id="btn-change-pwd">修改密码</button>
            </div>
          </div>
        </div>`;
      document.getElementById('btn-create-token').addEventListener('click', createToken);
      document.getElementById('btn-revoke-all-tokens').addEventListener('click', revokeAllTokens);
      bindChangePassword();
      loadTokens(); loadTOTP(); loadDownloadGrant();
    } else if (tab === 'account') {
      content.innerHTML = `
        <div class="settings-panel-title">账户</div>
        <div class="settings-panel-desc">查看账号身份、存储配额与最近登录记录。修改密码后所有旧会话自动失效。</div>
        <div class="settings-section">
          <div class="setting-head">
            <div class="setting-head-icon icon-primary">${ICONS.user}</div>
            <div class="setting-head-text"><h3>账户信息</h3><p class="section-desc">账号身份、存储配额、安全状态与登录记录</p></div>
          </div>
          <div class="setting-body" id="account-info">加载中...</div>
        </div>
        <div class="settings-section">
          <div class="setting-head">
            <div class="setting-head-icon icon-danger">${ICONS.logout}</div>
            <div class="setting-head-text"><h3>退出登录</h3><p class="section-desc">退出当前账户，需要重新登录</p></div>
            <div class="setting-head-action"><button class="btn btn-danger" id="btn-logout">${ICONS.logout}<span>退出</span></button></div>
          </div>
        </div>`;
      document.getElementById('btn-logout').addEventListener('click', () => App.logout());
      loadAccountInfo();
    }
  }

  // 修改密码事件绑定（抽出来，切到 security 时复用）
  function bindChangePassword() {
    document.getElementById('btn-change-pwd')?.addEventListener('click', async () => {
      const oldP = document.getElementById('old-pass').value;
      const newP = document.getElementById('new-pass').value;
      if (!oldP || !newP) { Toast.show('请填写完整', 'error'); return; }
      try {
        const res = await API.post('/api/auth/change-password', { old_password: oldP, new_password: newP });
        if (res.ok) {
          const d = await res.json();
          Toast.show('密码已修改', 'success');
          document.getElementById('old-pass').value = '';
          document.getElementById('new-pass').value = '';
        }
        else { const d = await res.json(); Toast.show(d.detail || '修改失败', 'error'); }
      } catch { Toast.show('网络错误', 'error'); }
    });
  }

  document.querySelectorAll('.settings-nav-item').forEach(btn => {
    btn.addEventListener('click', () => renderTab(btn.dataset.tab));
  });
  renderTab(activeTab, false); // 初始渲染（含深链）不覆盖用户偏好
}

async function loadAccountInfo() {
  const el = document.getElementById('account-info');
  if (!el) return;
  try {
    let me = App.currentUser;
    if (!me) {
      const res = await API.get('/api/auth/me');
      if (!res || !res.ok) { renderErrorState(el, '账户信息加载失败', () => loadAccountInfo()); return; }
      me = await res.json();
      App.currentUser = me;
    }
    const roleMap = { user: '普通用户', admin: '管理员' };
    const statusBadge = me.status === 'active'
      ? '<span class="badge badge-success">正常</span>'
      : '<span class="badge badge-danger">已禁用</span>';
    const quotaText = me.quota_mb && me.quota_mb > 0 ? `${me.quota_mb} MB` : '不限';
    const totpBadge = me.totp_enabled
      ? '<span class="badge badge-success">已开启</span>'
      : '<span class="badge badge-warning">未开启</span>';
    const roleText = escapeHtml(roleMap[me.role] || me.role); // 统一转义，与弹层保持一致

    // 先渲染主体（不阻塞），再异步填充存储用量
    el.innerHTML = `
      <div class="account-info">
        <div class="account-row">
          <div class="account-avatar">${escapeHtml(me.username.charAt(0).toUpperCase())}</div>
          <div class="account-name">
            <div class="account-username">${escapeHtml(me.username)}</div>
            <div class="account-sub">${roleText} · ${statusBadge}</div>
          </div>
        </div>
        <div class="account-grid">
          <div class="account-field"><span class="account-label">用户名</span><span class="account-value">${escapeHtml(me.username)}</span></div>
          <div class="account-field"><span class="account-label">角色</span><span class="account-value">${roleText}</span></div>
          <div class="account-field"><span class="account-label">账户状态</span><span class="account-value">${statusBadge}</span></div>
          <div class="account-field"><span class="account-label">存储配额</span><span class="account-value">${quotaText}</span></div>
          <div class="account-field"><span class="account-label">双因子验证</span><span class="account-value">${totpBadge}</span></div>
          <div class="account-field"><span class="account-label">最近登录</span><span class="account-value">${me.last_login_at ? formatDateTime(me.last_login_at) : '-'}</span></div>
          <div class="account-field"><span class="account-label">注册时间</span><span class="account-value">${me.created_at ? formatDateTime(me.created_at) : '-'}</span></div>
          <div class="account-field"><span class="account-label">已用空间</span><span class="account-value" id="acct-used">-</span></div>
          <div class="account-field"><span class="account-label">剩余配额</span><span class="account-value" id="acct-remain">-</span></div>
        </div>
        <div id="acct-storage"></div>
        <div class="login-history" id="login-history"></div>
      </div>`;

    // 异步填充存储用量（失败降级，不阻塞主体）
    fillAccountStorage();

    // 加载登录历史（带竞态防护）
    loadLoginHistory();
  } catch {
    renderErrorState(el, '账户信息加载失败', () => loadAccountInfo());
  }
}

// 异步填充账户页存储用量（共享 renderStorageBar）
async function fillAccountStorage() {
  const usedEl = document.getElementById('acct-used');
  if (!usedEl) return;
  try {
    const d = await getStats();
    if (!usedEl.isConnected) return; // 已离开账户页
    if (!d) return;
    const used = Number(d.total_size_mb) || 0;
    const quota = Number(d.quota_mb) || 0;
    const { limited, remaining } = computeStorageFill(used, quota);
    usedEl.textContent = used + ' MB';
    const remainEl = document.getElementById('acct-remain');
    if (remainEl) remainEl.textContent = limited ? remaining + ' MB' : '不限';
    const storageEl = document.getElementById('acct-storage');
    if (storageEl) storageEl.innerHTML = renderStorageBar(d);
  } catch { /* 失败保持「-」降级 */ }
}

// 登录历史：读 /api/auth/login-history，仅当前用户自身记录（后端强制 user_id 过滤）
let _loginHistorySeq = 0; // 竞态防护：丢弃过期响应
async function loadLoginHistory() {
  const el = document.getElementById('login-history');
  if (!el) return;
  const seq = ++_loginHistorySeq;
  const ACTION_MAP = {
    login_success: { cls: 'ok', text: '登录成功' },
    login_failed: { cls: 'fail', text: '登录失败' },
    login_locked: { cls: 'fail', text: '登录锁定' },
    login_blocked: { cls: 'fail', text: '登录被拒（账号禁用）' },
    login_totp_failed: { cls: 'fail', text: '二次验证失败' },
    login_new_device: { cls: 'warn', text: '新设备登录' },
    register: { cls: 'ok', text: '注册账号' },
    password_reset_success: { cls: 'warn', text: '重置密码成功' },
    password_reset_failed: { cls: 'fail', text: '重置密码失败' },
    password_reset_locked: { cls: 'fail', text: '重置锁定' },
    revoke_other_tokens: { cls: 'warn', text: '退出其他设备' },
    revoke_all_tokens: { cls: 'warn', text: '吊销全部令牌' },
  };
  try {
    const res = await API.get('/api/auth/login-history?limit=10');
    if (seq !== _loginHistorySeq) return; // 已有更新请求，丢弃本响应
    if (!res || !res.ok) { el.innerHTML = '<div class="lh-empty">登录记录加载失败</div>'; return; }
    const logs = await res.json();
    if (!logs || !logs.length) { el.innerHTML = '<div class="lh-empty">暂无登录记录</div>'; return; }
    el.innerHTML = `<div class="lh-title">最近登录记录</div>
      <div class="lh-list">${logs.map(l => {
        const m = ACTION_MAP[l.action] || { cls: '', text: l.action };
        const detail = (l.detail || '').trim();
        return `<div class="lh-item">
          <span class="lh-dot ${m.cls}"></span>
          <span class="lh-text">${escapeHtml(m.text)}</span>
          ${detail ? `<span class="lh-detail">${escapeHtml(detail)}</span>` : ''}
          <span class="lh-time">${l.created_at ? formatDateTime(l.created_at) : ''}</span>
        </div>`;
      }).join('')}</div>`;
  } catch { if (seq === _loginHistorySeq) el.innerHTML = '<div class="lh-empty">登录记录加载失败</div>'; }
}

async function loadStats() {
  const el = document.getElementById('stats-content');
  if (!el) return;
  try {
    const data = await getStats();
    if (!data) { renderErrorState(el, '统计加载失败', () => loadStats()); return; }
    const used = Number(data.total_size_mb) || 0;
    const quota = Number(data.quota_mb) || 0;
    const { limited, pct } = computeStorageFill(used, quota);
    const remaining = limited ? Math.max(quota - used, 0) : 0;
    // 剩余配额配色：充足→绿，偏紧→橙，告急→红
    let remainCls = 'accent-success';
    if (pct >= 90) remainCls = 'accent-danger';
    else if (pct >= 70) remainCls = 'accent-warning';
    const quotaText = limited ? `${quota}<span class="stat-unit"> MB</span>` : '不限';
    const remainText = limited ? `${remaining}<span class="stat-unit"> MB</span>` : '不限';
    el.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">文件总数</div><div class="stat-value">${data.total_files}</div></div>
        <div class="stat-card accent-success"><div class="stat-label">已用空间</div><div class="stat-value">${used}<span class="stat-unit"> MB</span></div></div>
        <div class="stat-card"><div class="stat-label">存储配额</div><div class="stat-value">${quotaText}</div></div>
        <div class="stat-card ${limited ? remainCls : ''}"><div class="stat-label">剩余配额</div><div class="stat-value">${remainText}</div></div>
      </div>
      ${renderStorageBar(data)}
    `;
  } catch { renderErrorState(el, '统计加载失败', () => loadStats()); }
}

// parseServerTs 已抽离至 ./utils/time.js（见顶部 import）

async function loadTokens() {
  const el = document.getElementById('tokens-content');
  if (!el) return;
  let tokens = [];
  try {
    const res = await API.get('/api/auth/tokens');
    tokens = await res.json();
  } catch { renderErrorState(el, '令牌加载失败', () => loadTokens()); return; }

  const revokeAllZone = document.getElementById('revoke-all-zone');
  const hasActive = tokens.some(t => isTokenActive(t));
  if (revokeAllZone) revokeAllZone.style.display = hasActive ? '' : 'none';

  const active = tokens.filter(isTokenActive);
  const inactive = tokens.filter(t => !isTokenActive(t));
  const showInactive = el.dataset.showInactive === '1';

  if (!tokens.length) {
    el.innerHTML = '<p class="setting-empty">暂无设备令牌或会话，点击右上角"创建令牌"添加。</p>';
    return;
  }
  const otherActive = active.filter(t => !t.is_current);
  const exitOthersBtn = otherActive.length
    ? `<button class="btn btn-secondary btn-sm" data-action="revokeOtherTokens">${ICONS.logout}<span>退出其他设备</span></button>`
    : '';
  const inactiveToggle = inactive.length
    ? `<button class="btn btn-ghost btn-sm" id="tk-toggle-inactive">${showInactive ? '收起已失效' : `显示已失效（${inactive.length}）`}</button>`
    : '';
  const headerBar = (exitOthersBtn || inactiveToggle)
    ? `<div class="token-toolbar">${exitOthersBtn}${inactiveToggle}</div>` : '';

  const renderRow = (t) => {
    const location = t.ip ? `<span class="dot-sep">·</span><span>${escapeHtml(t.geo ? t.geo + ' ' : '')}${escapeHtml(t.ip)}</span>` : '';
    const downloadBadge = t.kind === 'session' && t.download_granted
      ? '<span class="badge badge-warning">下载已授权</span>' : '';
    const currentBadge = t.is_current ? '<span class="badge badge-current">本机</span>' : '';
    return `
    <div class="token-row ${t.is_current ? 'token-row-current' : ''}">
      <div class="token-info">
        <div class="token-label">${escapeHtml(t.label) || '未命名设备'} ${currentBadge} ${tokenKindBadge(t)} ${tokenStatusBadge(t)} ${downloadBadge}</div>
        <div class="token-meta-row">
          <span>创建 ${formatDateTime(t.created_at)}</span>
          ${location}
          <span class="dot-sep">·</span>
          <span>最近活跃 <span class="${t.last_used_at ? '' : 'token-never'}">${t.last_used_at ? formatDateTime(t.last_used_at) : '从未'}</span></span>
          <span class="dot-sep">·</span>
          <span>过期 ${tokenExpiryText(t)}</span>
        </div>
      </div>
      ${isTokenActive(t) ? `<button class="btn btn-danger btn-sm" data-action="revokeToken" data-token-id="${escapeHtml(t.id)}" data-is-current="${t.is_current ? '1' : ''}">吊销</button>` : ''}
    </div>`;
  };
  el.innerHTML = headerBar + active.map(renderRow).join('')
    + (showInactive && inactive.length ? inactive.map(renderRow).join('') : '');
  const toggleBtn = el.querySelector('#tk-toggle-inactive');
  if (toggleBtn) toggleBtn.addEventListener('click', () => {
    el.dataset.showInactive = showInactive ? '0' : '1';
    loadTokens();
  });
}

async function createToken() {
  const form = await showCreateTokenDialog();
  if (!form) return;
  try {
    const res = await API.post(`/api/auth/tokens?label=${encodeURIComponent(form.label)}&expires_days=${form.expires_days}`);
    if (!res.ok) { const d = await res.json(); Toast.show(d.detail || '创建失败', 'error'); return; }
    const data = await res.json();
    showTokenResult(data.token, form.label);
    loadTokens();
  } catch { Toast.show('创建失败', 'error'); }
}

function showCreateTokenDialog() {
  return new Promise((resolve) => {
    const { modal, close } = openModal({ width: 440, onDismiss: () => resolve(null) });
    modal.innerHTML = `
        <h3>创建设备令牌</h3>
        <p class="confirm-message" style="margin-bottom:16px">为令牌起个名字，方便日后识别（如“公司电脑”“家里守护进程”）。</p>
        <div class="form-group">
          <label>令牌标签</label>
          <input type="text" id="tk-label" class="form-input" placeholder="如：公司电脑" maxlength="50" autocomplete="off">
          <div class="input-error-msg" id="tk-label-err"></div>
        </div>
        <div class="form-group">
          <label>有效期</label>
          <div class="expiry-options" id="tk-expiry">
            <button type="button" class="expiry-option" data-days="7">7 天</button>
            <button type="button" class="expiry-option" data-days="30">30 天</button>
            <button type="button" class="expiry-option" data-days="90">90 天</button>
            <button type="button" class="expiry-option active" data-days="0">永久</button>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="tk-cancel">取消</button>
          <button class="btn btn-primary" id="tk-create" disabled>创建</button>
        </div>`;
    const labelInput = modal.querySelector('#tk-label');
    const errEl = modal.querySelector('#tk-label-err');
    const createBtn = modal.querySelector('#tk-create');
    let expiresDays = 0;
    const finish = (r) => { resolve(r); close(); };

    modal.querySelectorAll('.expiry-option').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.expiry-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        expiresDays = parseInt(btn.dataset.days, 10) || 0;
      });
    });
    const check = () => {
      const v = labelInput.value.trim();
      if (!v) { errEl.textContent = ''; labelInput.classList.remove('error'); createBtn.disabled = true; return; }
      if (v.length > 50) { errEl.textContent = '名称不能超过 50 个字符'; labelInput.classList.add('error'); createBtn.disabled = true; return; }
      errEl.textContent = ''; labelInput.classList.remove('error'); createBtn.disabled = false;
    };
    labelInput.addEventListener('input', check);
    labelInput.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' && !createBtn.disabled) finish({ label: labelInput.value.trim(), expires_days: expiresDays });
    });
    modal.querySelector('#tk-cancel').addEventListener('click', () => finish(null));
    createBtn.addEventListener('click', () => finish({ label: labelInput.value.trim(), expires_days: expiresDays }));
    setTimeout(() => labelInput.focus(), 0);
  });
}

function showTokenResult(token, label) {
  const { modal, close } = openModal({ width: 520 });
  modal.innerHTML = `
    <h3>令牌已创建</h3>
    <p class="confirm-message">令牌「${escapeHtml(label)}」已生成。<strong style="color:var(--warning)">仅显示这一次</strong>，关闭后无法再次查看，请立即复制并妥善保存。</p>
    <div class="token-result">
      <code class="token-result-value" id="tk-result-value"></code>
      <button class="btn btn-secondary" id="tk-copy">复制</button>
    </div>
    <div class="input-error-msg" id="tk-copy-msg" style="min-height:0"></div>
    <div class="modal-actions">
      <button class="btn btn-primary" id="tk-done">我已妥善保存</button>
    </div>`;
  modal.querySelector('#tk-result-value').textContent = token;
  const copyMsg = modal.querySelector('#tk-copy-msg');
  modal.querySelector('#tk-copy').addEventListener('click', async () => {
    const ok = await copyToClipboard(token);
    copyMsg.textContent = ok ? '✓ 已复制到剪贴板' : '复制失败，请手动选择上方文本复制';
    copyMsg.style.color = ok ? 'var(--success)' : 'var(--danger)';
  });
  modal.querySelector('#tk-done').addEventListener('click', close);
}

async function revokeAllTokens() {
  if (!await confirmDialog({ title: '吊销全部令牌', message: '将吊销你的全部令牌（含当前浏览器会话），你也会立即登出。确定继续？', confirmText: '全部吊销', danger: true })) return;
  try {
    const res = await API.del('/api/auth/tokens');
    if (!res.ok) { const d = await res.json(); Toast.show(d.detail || '操作失败', 'error'); return; }
    const data = await res.json();
    Toast.show(data.message || '已吊销全部令牌', 'success');
    App.logout();  // 紧急下线：清 cookie + 吊销，自己的 access 也已失效
  } catch { Toast.show('操作失败', 'error'); }
}

// ---- 临时下载授权（浏览器端默认禁下载，设置页开启短期窗口）----
let _downloadGrantTimer = null;

// 下载授权弹窗：密码验证 + 授权模式选择
function downloadAuthDialog({ filePath = null, defaultMode = 'single' } = {}) {
  return new Promise((resolve) => {
    const isSingle = !!filePath;
    const { modal, close } = openModal({ width: 440, onDismiss: () => resolve(null) });
    modal.innerHTML = `
      <h3>验证身份</h3>
      <p class="confirm-message">下载文件需要验证登录密码，确认是你本人操作。</p>
      <div class="form-group" style="margin-top:16px">
        <input type="password" id="dl-auth-password" class="form-input" placeholder="输入登录密码" autocomplete="current-password">
      </div>
      <div class="dl-auth-options">
        ${isSingle ? `<label class="dl-auth-option"><input type="radio" name="dl-mode" value="single" ${defaultMode==='single'?'checked':''}><span>仅下载此文件</span><small>下载后自动失效，最安全</small></label>` : ''}
        <label class="dl-auth-option"><input type="radio" name="dl-mode" value="5" ${defaultMode==='window'&&!isSingle?'checked':''}><span>5 分钟窗口</span><small>批量下载，到期自动关闭</small></label>
        <label class="dl-auth-option"><input type="radio" name="dl-mode" value="15" ${!isSingle&&defaultMode!=='window'?'checked':''}><span>15 分钟窗口</span><small>大量文件迁移</small></label>
        <label class="dl-auth-option"><input type="radio" name="dl-mode" value="30"><span>30 分钟窗口</span><small>大批量操作</small></label>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary">取消</button>
        <button class="btn btn-primary" id="dl-auth-confirm">验证并继续</button>
      </div>`;
    const passwordInput = modal.querySelector('#dl-auth-password');
    const cancelBtn = modal.querySelector('.btn-secondary');
    const okBtn = modal.querySelector('#dl-auth-confirm');
    cancelBtn.textContent = '取消';
    okBtn.textContent = '验证并继续';
    const submit = async () => {
      const pwd = passwordInput.value;
      if (!pwd) { Toast.show('请输入密码', 'error'); passwordInput.focus(); return; }
      const selected = modal.querySelector('input[name="dl-mode"]:checked');
      const mode = selected ? selected.value : 'single';
      okBtn.disabled = true; okBtn.textContent = '验证中...';
      resolve({ password: pwd, mode, filePath });
      close();
    };
    cancelBtn.addEventListener('click', () => { resolve(null); close(); });
    okBtn.addEventListener('click', submit);
    passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    setTimeout(() => passwordInput.focus(), 0);
  });
}

// 下载授权请求处理：验证密码 → 选择授权模式 → 调用对应 API
async function requestDownloadAuth({ filePath = null, fileId = null, defaultMode = 'single' } = {}) {
  const choice = await downloadAuthDialog({ filePath, defaultMode });
  if (!choice) return null;
  try {
    if (choice.mode === 'single' && (filePath || fileId)) {
      const body = { password: choice.password };
      if (fileId) body.file_id = fileId; else body.path = filePath;
      const res = await API.post('/api/files/download-grant-single', body);
      if (!res) return null;
      if (!res.ok) { const d = await res.json(); Toast.show(d.detail || '验证失败', 'error'); return null; }
      return { ok: true, mode: 'single' };
    } else {
      const minutes = parseInt(choice.mode);
      const res = await API.post('/api/files/download-grant', { password: choice.password, minutes });
      if (!res) return null;
      if (!res.ok) { const d = await res.json(); Toast.show(d.detail || '验证失败', 'error'); return null; }
      const d = await res.json();
      return { ok: true, mode: 'window', until: d.until, minutes: d.minutes };
    }
  } catch { Toast.show('网络错误', 'error'); return null; }
}

// 下载授权激活时的顶栏横幅
let _downloadBannerTimer = null;

function showDownloadBanner(until) {
  hideDownloadBanner();
  let banner = document.getElementById('download-active-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'download-active-banner';
    banner.className = 'download-active-banner';
    document.querySelector('.app-layout')?.prepend(banner);
  }
  banner.innerHTML = `<span class="dl-banner-icon">${ICONS.download}</span><span class="dl-banner-text">临时下载已开启 · 剩余 <strong id="dl-banner-countdown">--:--</strong></span><button class="dl-banner-close">立即关闭</button>`;
  banner.style.display = 'flex';
  banner.querySelector('.dl-banner-close').addEventListener('click', revokeDownload);
  const tick = () => {
    const remain = Math.max(0, Math.floor((parseServerTs(until) - Date.now()) / 1000));
    const cd = document.getElementById('dl-banner-countdown');
    if (cd) cd.textContent = `${String(Math.floor(remain/60)).padStart(2,'0')}:${String(remain%60).padStart(2,'0')}`;
    if (remain <= 0) { hideDownloadBanner(); checkDownloadStatus(); }
  };
  tick();
  _downloadBannerTimer = setInterval(tick, 1000);
}

function hideDownloadBanner() {
  if (_downloadBannerTimer) { clearInterval(_downloadBannerTimer); _downloadBannerTimer = null; }
  const banner = document.getElementById('download-active-banner');
  if (banner) banner.style.display = 'none';
}

// 检查下载状态，显示/隐藏横幅
async function checkDownloadStatus() {
  try {
    const res = await API.get('/api/files/download-status');
    if (!res || !res.ok) return;
    const d = await res.json();
    if (d.granted) showDownloadBanner(d.until);
    else hideDownloadBanner();
  } catch {}
}

// 加载下载授权状态（设置页渲染用）
async function loadDownloadGrant() {
const el = document.getElementById('download-grant-content');
  if (!el) return;
  let granted = false, until = '';
  try {
    const res = await API.get('/api/files/download-status');
    const d = await res.json(); granted = d.granted; until = d.until;
  } catch { el.innerHTML = '<p class="setting-empty">加载失败</p>'; return; }
  renderDownloadGrant(el, granted, until);
}

// 加载本次下载窗口的下载记录
async function loadDownloadHistory() {
  const list = document.getElementById('dl-history-list');
  if (!list) return;
  try {
    const res = await API.get('/api/files/download-history');
    if (!res || !res.ok) return;
    const d = await res.json();
    if (!d.files || d.files.length === 0) {
      list.innerHTML = '<p class="dl-history-empty">暂无下载记录</p>';
      return;
    }
    list.innerHTML = d.files.map(f => {
      const name = f.path.split('/').pop();
      const time = new Date(parseServerTs(f.time)).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return `<div class="dl-history-item"><span class="dl-history-name" title="${escapeHtml(f.path)}">${escapeHtml(name)}</span><span class="dl-history-time">${time}</span></div>`;
    }).join('');
  } catch {}
}

function renderDownloadGrant(el, granted, until) {
  if (_downloadGrantTimer) { clearInterval(_downloadGrantTimer); _downloadGrantTimer = null; }
  if (!granted) {
    el.innerHTML = `
      <div class="setting-row">
        <p class="section-desc setting-row-text">未开启。点击文件下载时会要求验证密码，也可在此提前开启时间窗口。</p>
        <button class="btn btn-primary" id="btn-download-grant">${ICONS.download}<span>开启临时下载</span></button>
      </div>`;
    document.getElementById('btn-download-grant')?.addEventListener('click', grantDownload);
    return;
  }
  el.innerHTML = `
    <div class="setting-row">
      <p class="setting-row-text">下载已开启，剩余 <strong id="download-grant-countdown">--:--</strong></p>
      <button class="btn btn-secondary" id="btn-download-revoke"><span>立即关闭</span></button>
    </div>
    <div class="dl-history-section" id="dl-history-section">
      <p class="dl-history-title">本次窗口已下载</p>
      <div id="dl-history-list" class="dl-history-list"><p class="dl-history-empty">暂无下载记录</p></div>
    </div>`;
  document.getElementById('btn-download-revoke')?.addEventListener('click', revokeDownload);
  loadDownloadHistory();
  const tick = () => {
    if (!document.getElementById('download-grant-countdown')) { clearInterval(_downloadGrantTimer); _downloadGrantTimer = null; return; }
    const remain = Math.max(0, Math.floor((parseServerTs(until) - Date.now()) / 1000));
    const cd = document.getElementById('download-grant-countdown');
    if (cd) cd.textContent = `${String(Math.floor(remain/60)).padStart(2,'0')}:${String(remain%60).padStart(2,'0')}`;
    if (remain <= 0) { clearInterval(_downloadGrantTimer); _downloadGrantTimer = null; loadDownloadGrant(); }
    else if (remain % 10 === 0) loadDownloadHistory();
  };
  tick();
  _downloadGrantTimer = setInterval(tick, 1000);
}

async function grantDownload() {
  // 设置页开启窗口：弹密码验证 + 选择窗口时长（无指定文件，默认 15 分钟）
  const auth = await requestDownloadAuth({ filePath: null, defaultMode: 'window' });
  if (!auth) return;  // 用户取消或验证失败
  Toast.show(`已开启临时下载（${auth.minutes} 分钟）`, 'success');
  showDownloadBanner(auth.until);
  renderDownloadGrant(document.getElementById('download-grant-content'), true, auth.until);
}

async function revokeDownload() {
  try {
    const res = await API.post('/api/files/download-revoke');
    if (!res) return;  // 会话已失效并被登出
    if (!res.ok) { const d = await res.json(); Toast.show(d.detail || '操作失败', 'error'); return; }
    Toast.show('已关闭临时下载', 'success');
    renderDownloadGrant(document.getElementById('download-grant-content'), false, '');
    hideDownloadBanner();
  } catch { Toast.show('操作失败', 'error'); }
}

async function revokeToken(id, isCurrent) {
  const message = isCurrent
    ? '这是你当前正在使用的会话，吊销后你将立即退出登录。确定要吊销当前会话吗？'
    : '确定吊销此令牌？该设备将立即无法访问。';
  if (!await confirmDialog({ title: isCurrent ? '吊销当前会话' : '吊销令牌', message, confirmText: '吊销', danger: true })) return;
  try { await API.del(`/api/auth/tokens/${id}`); Toast.show('令牌已吊销', 'success'); isCurrent ? App.logout() : loadTokens(); }
  catch { Toast.show('操作失败', 'error'); }
}

async function revokeOtherTokens() {
  if (!await confirmDialog({ title: '退出其他设备', message: '将吊销除当前会话外的全部令牌，其他设备会立即下线，你当前登录不受影响。确定继续？', confirmText: '退出其他设备', danger: true })) return;
  try {
    const res = await API.del('/api/auth/tokens-others');
    if (!res) return;
    if (!res.ok) { const d = await res.json(); Toast.show(d.detail || '操作失败', 'error'); return; }
    const data = await res.json();
    Toast.show(data.message || '已退出其他设备', 'success');
    loadTokens();
  } catch { Toast.show('操作失败', 'error'); }
}

async function loadTOTP() {
  const el = document.getElementById('totp-content');
  if (!el) return;
  const enabled = App.currentUser && App.currentUser.totp_enabled;
  if (enabled) {
    el.innerHTML = `
      <div class="totp-status">
        <span class="badge badge-success">已开启</span>
        <p class="setting-empty" style="margin:0">登录时需要额外的动态验证码。关闭后立即生效。</p>
      </div>
      <button class="btn btn-danger" id="btn-disable-totp">关闭双因子验证</button>`;
    document.getElementById('btn-disable-totp').addEventListener('click', disableTOTP);
  } else {
    el.innerHTML = `
      <p class="setting-empty">使用 Google Authenticator 等 App 扫码绑定，开启后登录需额外验证。公用设备强烈建议开启。</p>
      <button class="btn btn-primary" id="btn-setup-totp">设置双因子验证</button>`;
    document.getElementById('btn-setup-totp').addEventListener('click', setupTOTP);
  }
}

async function disableTOTP() {
  if (!await confirmDialog({ title: '关闭双因子验证', message: '关闭后，登录将不再需要动态验证码，账户安全性会降低。确定关闭？', confirmText: '关闭', danger: true })) return;
  try {
    const res = await API.post('/api/auth/totp/disable');
    if (!res.ok) { const d = await res.json(); Toast.show(d.detail || '关闭失败', 'error'); return; }
    if (App.currentUser) App.currentUser.totp_enabled = false;
    Toast.show('双因子验证已关闭', 'success');
    loadTOTP();
    loadAccountInfo();
  } catch { Toast.show('网络错误', 'error'); }
}

async function setupTOTP() {
  let data;
  try {
    const res = await API.get('/api/auth/totp/setup');
    data = await res.json();
  } catch { Toast.show('设置失败', 'error'); return; }
  const { modal, close } = openModal({ width: 420 });
  modal.innerHTML = `
    <h3>设置双因子验证</h3>
    <p class="confirm-message">用验证器 App（如 Google Authenticator）扫描以下二维码：</p>
    <div style="text-align:center;margin:16px 0"><img src="${data.qr_code}" style="width:200px;height:200px" alt="QR"></div>
    <p style="font-size:12px;color:var(--text-muted)">或手动输入：<code id="totp-secret"></code></p>
    <div class="form-group" style="margin-top:16px">
      <label>输入验证器显示的 6 位代码</label>
      <input type="text" class="form-input" id="totp-verify-code" placeholder="000000" maxlength="6" inputmode="numeric" autocomplete="one-time-code">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="totp-cancel">取消</button>
      <button class="btn btn-primary" id="btn-confirm-totp">确认绑定</button>
    </div>`;
  modal.querySelector('#totp-secret').textContent = data.secret;
  const codeInput = modal.querySelector('#totp-verify-code');
  const confirmBtn = modal.querySelector('#btn-confirm-totp');
  const submit = async () => {
    const code = codeInput.value.trim();
    if (!code) { Toast.show('请输入验证码', 'error'); return; }
    confirmBtn.disabled = true;
    try {
      const res = await API.post(`/api/auth/totp/enable?secret=${encodeURIComponent(data.secret)}&code=${encodeURIComponent(code)}`);
      if (res.ok) {
        if (App.currentUser) App.currentUser.totp_enabled = true;
        Toast.show('双因子验证已开启', 'success');
        close();
        loadTOTP();
        loadAccountInfo();
      } else {
        const d = await res.json();
        Toast.show(d.detail || '验证码错误', 'error');
      }
    } catch { Toast.show('网络错误', 'error'); }
    finally { if (modal.isConnected) confirmBtn.disabled = false; }
  };
  modal.querySelector('#totp-cancel').addEventListener('click', close);
  confirmBtn.addEventListener('click', submit);
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  setTimeout(() => codeInput.focus(), 0);
}

async function rebuildIndex() {
  Toast.show('开始重建索引...', 'info');
  try {
    const res = await API.post('/api/files/index-all');
    const data = await res.json();
    Toast.show(data.message, 'success');
  } catch { Toast.show('重建失败', 'error'); }
}

// ============ App ============
const App = {
  currentView: 'transfer',
  currentUser: null,
  async init() {
    // 登录态由 HttpOnly cookie 决定：服务端 set/clear，前端 JS 不可读。
    // 未登录时渲染应用内登录表单（renderLogin），已登录时进应用壳。
    // 不依赖 /welcome 跳转——避免 refresh 失败时 SPA 壳与落地页竞态导致白屏。
    try {
      const res = await API.get('/api/auth/me', { _skipLogoutRedirect: true });
      if (!res || !res.ok) { renderLogin(); return; }
      this.currentUser = await res.json();
    } catch {
      renderLogin(); return;
    }
    this.renderLayout();
    this.navigate('transfer');
    setupDragDrop();
    setupPaste();
    setupGlobalShortcuts();
    document.addEventListener('click', closeContextMenu);
    checkDownloadStatus();
    loadTrashCount();
  },
 renderLayout() {
    document.body.classList.add('view-shell');
    const username = this.currentUser ? this.currentUser.username : '随行档';
    const initial = this.currentUser ? this.currentUser.username.charAt(0).toUpperCase() : '档';
    const aiEnabled = this.currentUser && this.currentUser.ai_enabled;
    const collapsed = loadPref('sidebarCollapsed', false) ? ' collapsed' : '';

    document.getElementById('app').innerHTML = `
      <div class="app-layout">
        <aside class="sidebar${collapsed}" id="sidebar">
          <div class="sidebar-header">
            <div class="workspace" id="sidebar-logo" title="随行档">
              <div class="workspace-avatar">${initial}</div>
              <div class="workspace-name">
                <span class="workspace-title">随行档</span>
                <span class="workspace-sub">私人文件中枢</span>
              </div>
            </div>
          </div>
          <div class="sidebar-search">
            <div class="sidebar-search-box" id="sidebar-search-trigger">
              ${ICONS.search}
              <span>搜索</span>
              <kbd>Ctrl K</kbd>
            </div>
          </div>
          <nav class="sidebar-nav">
            <div class="nav-section">
              <div class="nav-section-label">工作区</div>
              <button class="nav-item active" data-view="transfer">${ICONS.transfer}<span class="nav-item-label">传输助手</span></button>
              ${aiEnabled ? `<button class="nav-item" data-view="chat">${ICONS.chat}<span class="nav-item-label">AI 助手</span></button>` : ''}
              <button class="nav-item" data-view="files">${ICONS.files}<span class="nav-item-label">文件库</span></button>
              <button class="nav-item" data-view="notes">${ICONS.note}<span class="nav-item-label">笔记</span></button>
              <button class="nav-item" data-view="trash">${ICONS.trash}<span class="nav-item-label">回收站</span><span class="nav-badge" id="trash-count" hidden>0</span></button>
            </div>
            <div class="nav-section">
              <div class="nav-section-label">系统</div>
              <button class="nav-item" data-view="settings">${ICONS.settings}<span class="nav-item-label">设置</span></button>
            </div>
          </nav>
          <div class="sidebar-footer">
            <div class="sidebar-user" id="sidebar-user" role="button" tabindex="0"
                 aria-haspopup="menu" aria-expanded="false" aria-label="账户与退出" title="查看账户">
              <div class="sidebar-user-avatar">${initial}</div>
              <div class="sidebar-user-info">
                <span class="sidebar-user-name">${escapeHtml(username)}</span>
                <span class="sidebar-user-sub">点击查看账户</span>
              </div>
              <button class="nav-item nav-logout" id="btn-sidebar-logout" title="退出登录" aria-label="退出登录">${ICONS.logout}</button>
            </div>
          </div>
          <button class="sidebar-collapse" id="sidebar-toggle" title="收起侧栏">${ICON_CHEVRON_LEFT}</button>
        </aside>
        <div class="main-content" id="main-content"></div>
      </div>`;
    document.querySelectorAll('.sidebar .nav-item').forEach(btn => {
      if (!btn.dataset.view) return;
      btn.addEventListener('click', () => this.navigate(btn.dataset.view));
    });
    document.getElementById('btn-sidebar-logout').addEventListener('click', () => this.logout());
    // 侧栏账户区：点击 / Enter / Space 打开账户弹层（退出按钮已自带逻辑，点击它不触发弹层）
    const userBtn = document.getElementById('sidebar-user');
    if (userBtn) {
      userBtn.addEventListener('click', (e) => {
        if (e.target.closest('#btn-sidebar-logout')) return;
        openAccountPopover(userBtn);
      });
      userBtn.addEventListener('keydown', (e) => {
        // 退出按钮自有逻辑，Enter/Space 不应触发弹层（与 click handler 保持一致）
        if (e.target.closest('#btn-sidebar-logout')) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAccountPopover(userBtn); }
      });
    }
    const logoBtn = document.getElementById('sidebar-logo');
    if (logoBtn) logoBtn.addEventListener('click', () => this.navigate('settings'));
    const searchTrigger = document.getElementById('sidebar-search-trigger');
    if (searchTrigger) searchTrigger.addEventListener('click', () => { if (typeof openCommandPalette === 'function') openCommandPalette(); });
    const toggleBtn = document.getElementById('sidebar-toggle');
    if (toggleBtn) toggleBtn.addEventListener('click', () => {
      const sb = document.getElementById('sidebar');
      const isCollapsed = sb.classList.toggle('collapsed');
      savePref('sidebarCollapsed', isCollapsed);
    });
 },
 navigate(view, opts = {}) {
   // 离开聊天视图时中止进行中的流式回复，避免向已分离的 DOM 继续写入
   if (this.currentView === 'chat' && view !== 'chat' && currentChatAbort) currentChatAbort.abort();
   this.currentView = view;
    document.querySelectorAll('.sidebar .nav-item[data-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
   if (view === 'chat' && !(this.currentUser && this.currentUser.ai_enabled)) {
      document.getElementById('main-content').innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:12px;color:var(--text-muted)">${ICONS.chat}<p>管理员未为您开通 AI 助手功能</p></div>`;
      return;
    }
    if (view === 'files') renderFiles();
    else if (view === 'trash') renderTrash();
    else if (view === 'chat') renderChat();
    else if (view === 'transfer') renderTransfer();
    else if (view === 'settings') renderSettings(opts.tab);
    else if (view === 'notes') renderNotes();
  },
  openSettings(tab) {
    // 校验 tab 值，避免非法值经 renderTab 被持久化到偏好（修复：openSettings tab 未校验）
    const validTab = ['general', 'security', 'account'].includes(tab) ? tab : 'general';
    this.navigate('settings', { tab: validTab });
  },
  logout() {
    if (currentChatAbort) currentChatAbort.abort();
    closeAccountPopover(); // session 过期/主动退出时同步关闭弹层，避免 DOM 泄漏到落地页
    this.currentView = 'transfer';
    // 跳独立落地页（与应用壳解耦）
    window.location.replace('/welcome');
    // 清服务端 cookie + 吊销会话：后台执行，不阻塞落地页渲染
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  }
};

// Expose for inline handlers
window.downloadFile = downloadFile;
window.deleteFile = deleteFile;
window.previewFile = previewFile;
window.revokeToken = revokeToken;
window.revokeOtherTokens = revokeOtherTokens;
window.showFileMenu = showFileMenu;
window.showGroupManager = showGroupManager;
window.showGroupFolderMenu = showGroupFolderMenu;
window.createGroup = createGroup;
window.renameGroup = renameGroup;
window.deleteGroup = deleteGroup;
window.UploadManager = UploadManager;
window.deleteTransferMessage = deleteTransferMessage;
window.previewTransferFile = previewTransferFile;
window.previewVideo = previewVideo;
window.renderLogin = renderLogin;

// ============ 全局事件委托（CSP 禁用内联事件处理器与 javascript: URL） ============
// 动态渲染的导航/操作按钮统一用 data-action，由 #app 单一委托分发，避免内联 onclick。
document.getElementById('app').addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  e.preventDefault();
  const action = el.dataset.action;
  if (action === 'renderLogin') return renderLogin();
  if (action === 'renderRegister') return renderRegister();
  if (action === 'renderForgotPassword') return renderForgotPassword();
  if (action === 'renderLanding') return renderLanding();
 if (action === 'revokeToken') return revokeToken(el.dataset.tokenId);
  if (action === 'revokeOtherTokens') return revokeOtherTokens();
});

// 全局 wikilink 点击委托（在预览和笔记编辑器预览窗格里）
document.addEventListener('click', (e) => {
  const wl = e.target.closest('.wikilink');
  if (!wl) return;
  e.preventDefault();
  handleWikilinkClick(wl);
});

App.init();
