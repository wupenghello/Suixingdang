// 随行档 - 前端 SPA

// ============ API 层 ============
const API = {
  _token: localStorage.getItem('access_token'),
  _refresh: localStorage.getItem('refresh_token'),

  setTokens(access, refresh) {
    this._token = access;
    this._refresh = refresh;
    localStorage.setItem('access_token', access);
    if (refresh) localStorage.setItem('refresh_token', refresh);
  },
  clearTokens() {
    this._token = null;
    this._refresh = null;
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  },
  async request(url, options = {}) {
    const headers = { ...options.headers };
    if (this._token) headers['Authorization'] = `Bearer ${this._token}`;
    if (options.body && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    let res = await fetch(url, { ...options, headers });
    if (res.status === 401 && this._refresh) {
      const refreshRes = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: this._refresh }),
      });
      if (refreshRes.ok) {
        const tokens = await refreshRes.json();
        this.setTokens(tokens.access_token, tokens.refresh_token);
        headers['Authorization'] = `Bearer ${this._token}`;
        res = await fetch(url, { ...options, headers });
      } else {
        this.clearTokens();
        App.logout();
        return;
      }
    }
    return res;
  },
  async get(url) { return this.request(url); },
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
  show(message, type = 'info', duration = 3000) {
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

// ============ Icons ============
const ICONS = {
  folder: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>',
  groups: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0 8c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z"/><path d="M3 6h18v2H3z" opacity="0"/><path d="M2 5h6V3H2v2zm0 6h6V9H2v2zm0 6h6v-2H2v2zm14-12v2h6V5h-6z"/></svg>',
  add: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>',
  fileCode: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>',
  fileText: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>',
  fileImage: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>',
  fileVideo: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>',
  transfer: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>',
  files: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>',
  rename: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
 logout: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5-5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>',
 eye: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>',
 close: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
 fileAudio: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>',
 database: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"/></svg>',
 shield: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>',
 key: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.65 10A6 6 0 1 0 7 18a6 6 0 0 0 5.65-4H17v4h4v-4h2v-4H12.65zM7 15a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>',
 lock: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm2-9H8V6a2 2 0 0 1 4 0v2z"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>',
};

// 文件页控件图标
const SORT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="13" y2="7"/><line x1="4" y1="12" x2="11" y2="12"/><line x1="4" y1="17" x2="9" y2="17"/><polyline points="15,14 18,17 21,14"/></svg>';
const GRID_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z"/></svg>';
const LIST_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20,6 9,17 4,12"/></svg>';
const SELECT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><polyline points="8.5,12 11,14.5 15.5,9.5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ============ Utils ============
function formatSize(bytes) {
  if (!bytes) return '-';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(typeof ts === 'number' ? ts * 1000 : ts);
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
function formatDateTime(ts) {
  // 复用 parseServerTs 统一服务器 naive-UTC 时间戳的解析逻辑
  const ms = parseServerTs(ts);
  if (!ms) return ts ? String(ts) : '';
  return new Date(ms).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function getFileIcon(name, isDir) {
  if (isDir) return { cls: 'folder', icon: ICONS.folder };
  const ext = name.split('.').pop().toLowerCase();
  if (['js','ts','py','java','go','rs','c','cpp','h','sh','rb','php'].includes(ext)) return { cls: 'code', icon: ICONS.fileCode };
  if (['md','txt','pdf','doc','docx','rst'].includes(ext)) return { cls: 'doc', icon: ICONS.fileText };
  if (['png','jpg','jpeg','gif','svg','webp'].includes(ext)) return { cls: 'image', icon: ICONS.fileImage };
  if (['mp4','avi','mov','mkv','webm'].includes(ext)) return { cls: 'video', icon: ICONS.fileVideo };
  if (['mp3','wav','ogg','flac','m4a','aac','opus'].includes(ext)) return { cls: 'audio', icon: ICONS.fileAudio };
  return { cls: 'other', icon: ICONS.file };
}
const PREVIEW_IMAGE_EXT = ['png','jpg','jpeg','gif','svg','webp','bmp','ico','avif'];
const PREVIEW_VIDEO_EXT = ['mp4','webm','ogg','mov','mkv','avi','m4v'];
const PREVIEW_AUDIO_EXT = ['mp3','wav','ogg','flac','m4a','aac','opus'];
const PREVIEW_TEXT_EXT = ['txt','md','rst','json','yml','yaml','xml','html','htm','css','scss','less','js','ts','jsx','tsx','py','java','go','rs','c','cpp','h','hpp','sh','bash','rb','php','sql','log','conf','ini','toml','env','csv','tsv','vue','svelte','swift','kt','dart','lua','pl','r','scala','clj','dockerfile','makefile','gitignore','graphql','proto'];
const PREVIEW_PDF_EXT = ['pdf'];
function getPreviewType(name) {
  const ext = name.split('.').pop().toLowerCase();
  const baseName = name.split('/').pop().toLowerCase();
  if (PREVIEW_IMAGE_EXT.includes(ext)) return 'image';
  if (PREVIEW_VIDEO_EXT.includes(ext)) return 'video';
  if (PREVIEW_AUDIO_EXT.includes(ext)) return 'audio';
  if (PREVIEW_PDF_EXT.includes(ext)) return 'pdf';
  if (PREVIEW_TEXT_EXT.includes(ext) || ['dockerfile','makefile','.gitignore'].includes(baseName)) return 'text';
  return null;
}
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  // innerHTML 只转义 & < >；补转义引号，使其在属性上下文（data-* 等）也安全
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 将 markdown 文本渲染为安全的 HTML（用于 AI 回复）
function renderMarkdown(text) {
  if (!text) return '';
  let html;
  try {
    html = window.marked.parse(text, { breaks: true, gfm: true });
  } catch { return escapeHtml(text).replace(/\n/g, '<br>'); }
  try { html = window.DOMPurify.sanitize(html); } catch {}
  // 外部链接新窗口打开，避免覆盖当前会话
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
  return div.innerHTML;
}

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
        API.setTokens(data.access_token, data.refresh_token);
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
            <div class="sx-list-row"><div class="sx-list-ico">${ic.trace}</div><div><h3>本地 · 默认不落盘</h3><p>浏览器端默认禁止下载，预览走 no-store。需要时开 5 分钟临时下载窗口，到期自动关。</p></div></div>
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
            <a href="/privacy">隐私政策</a>
            <a href="/terms">服务条款</a>
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
        <a class="login-back" href="#" data-action="renderLanding">← 返回官网</a>
      </div>
    `);
  // 动态检查注册是否开放
  fetch('/api/auth/register-status').then(r => r.json()).then(d => {
    const link = document.getElementById('register-link');
    if (link) link.style.display = d.allow_register ? '' : 'none';
  }).catch(() => {});

  const loginLogo = document.getElementById('login-logo');
  if (loginLogo) loginLogo.addEventListener('click', renderLanding);

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
        API.setTokens(data.access_token, data.refresh_token);
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
        <span class="files-divider"></span>
        <button class="btn btn-secondary btn-icon-only" id="btn-view" title="切换视图">${fileView === 'grid' ? LIST_ICON : GRID_ICON}</button>
        <button class="btn btn-secondary btn-icon-only" id="btn-sort" title="排序">${SORT_ICON}</button>
        <button class="btn btn-secondary btn-icon-only" id="btn-select" title="批量选择">${SELECT_ICON}</button>
        <button class="btn btn-secondary btn-icon-only" id="btn-groups" title="分组管理">${ICONS.groups}</button>
        <span class="files-divider"></span>
        <button class="btn btn-secondary btn-icon-only" id="btn-refresh" title="刷新">${ICONS.refresh}</button>
      </div>
    </div>
    <div class="files-body">
      <div id="batch-bar" class="batch-bar" style="display:none"></div>
      <div class="breadcrumb" id="breadcrumb"></div>
      <div id="file-content"></div>
    </div>
    <input type="file" id="file-input" style="display:none" multiple>
  `;
  document.getElementById('btn-refresh').addEventListener('click', () => { Toast.show('刷新中', 'info', 1000); loadFiles(); });
  document.getElementById('btn-groups').addEventListener('click', showGroupManager);
  document.getElementById('btn-upload').addEventListener('click', () => document.getElementById('file-input').click());
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

  const searchInput = document.getElementById('search-input');
  let debounceTimer;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { searchQuery = e.target.value; loadFiles(); }, 300);
  });
  await loadGroups();
  loadFiles();
}

// ============ Modal primitive ============
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
function confirmDialog({ title, message, confirmText = '确定', cancelText = '取消', danger = false }) {
  return new Promise((resolve) => {
    const { modal, close } = openModal({ width: 420, onDismiss: () => resolve(false) });
    modal.innerHTML = `
      <h3></h3>
      <p class="confirm-message"></p>
      <div class="modal-actions">
        <button class="btn btn-secondary"></button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}"></button>
      </div>`;
    modal.querySelector('h3').textContent = title;
    modal.querySelector('.confirm-message').textContent = message; // textContent 防 XSS
    const cancelBtn = modal.querySelector('.btn-secondary');
    const okBtn = modal.querySelector(danger ? '.btn-danger' : '.btn-primary');
    cancelBtn.textContent = cancelText;
    okBtn.textContent = confirmText;
    cancelBtn.addEventListener('click', () => { resolve(false); close(); });
    okBtn.addEventListener('click', () => { resolve(true); close(); });
    setTimeout(() => okBtn.focus(), 0); // 聚焦确认键，Enter 原生激活即可，无需全局 keydown
  });
}

// ============ Clipboard ============
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
        <button class="btn btn-secondary btn-sm" data-action="rename" data-id="${escapeHtml(g.id)}">重命名</button>
        <button class="btn btn-danger btn-sm" data-action="delete" data-id="${escapeHtml(g.id)}">删除</button>
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
      currentDir = el.dataset.dir;
      selectedGroup = '';
      searchQuery = '';
      const si = document.getElementById('search-input');
      if (si) si.value = '';
      loadFiles();
    });
  });
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
      renderFileList(data.items || []);
    } catch { fail('加载失败'); }
  }
}

function sortItems(items) {
  const { key, dir } = fileSort;
  const mul = dir === 'desc' ? -1 : 1;
  return [...items].sort((a, b) => {
    if (key === 'size') return mul * ((a.size || 0) - (b.size || 0));
    if (key === 'modified') return mul * ((a.modified || 0) - (b.modified || 0));
    return mul * String(a.name || '').localeCompare(String(b.name || ''), 'zh');
  });
}

function renderFileList(items) {
  currentFileItems = items;
  const content = document.getElementById('file-content');
  if (!content) return;
  const isRoot = !currentDir && !selectedGroup && !searchQuery;

  // 根目录：把分组作为虚拟文件夹插入列表顶部，并隐藏已分组文件（它们在分组文件夹里）
  let displayItems = items;
  if (isRoot) {
    const groupFolders = userGroups.map(g => ({
      name: g.name, path: '__group__:' + g.id, is_dir: true, is_group: true,
      group_id: g.id, file_count: g.file_count, size: g.size, modified: 0,
    }));
    // 已分组的根级文件不重复显示（通过分组文件夹访问）
    const ungrouped = items.filter(i => i.is_dir || !i.group_id);
    displayItems = groupFolders.concat(sortItems(ungrouped));
  } else {
    displayItems = sortItems(items);
  }

  const realItems = displayItems.filter(i => !i.is_group);
  const bytes = displayItems.filter(i => !i.is_dir && !i.is_group).reduce((s, i) => s + (i.size || 0), 0);
  const cntEl = document.getElementById('files-count');
  if (cntEl) cntEl.textContent = realItems.length ? `${realItems.length} 项${bytes ? ' · ' + formatSize(bytes) : ''}` : '';

  if (!displayItems.length) {
    const emptyMsg = selectedGroup
      ? '<div class="empty-title">该分组暂无文件</div><div class="empty-desc">点击"上传"将文件加入此分组</div>'
      : isRoot
        ? `${ICONS.groups}<div class="empty-title">还没有分组或文件</div><div class="empty-desc">点击「分组」创建分组，或直接「上传」文件</div>`
        : '<div class="empty-title">这个目录是空的</div><div class="empty-desc">拖拽文件到此或点击「上传」</div>';
    content.innerHTML = `<div class="file-table"><div class="empty-state">${emptyMsg}</div></div>`;
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

function fileItemHTML(item) {
  const isSel = fileSelection.has(item.path);
  if (item.is_group) {
    const cnt = item.file_count > 0 ? `${item.file_count} 项` : '空';
    if (fileView === 'grid') {
      return `<div class="file-card group-folder" data-gid="${escapeHtml(item.group_id)}" data-isgroup="true" data-name="${escapeHtml(item.name)}">
        <div class="file-icon folder">${ICONS.groups}</div>
        <div class="file-name">${escapeHtml(item.name)}</div>
        <div class="file-card-meta"><span class="badge badge-group">${cnt}</span></div>
      </div>`;
    }
    return `<div class="file-row group-folder" data-gid="${escapeHtml(item.group_id)}" data-isgroup="true" data-name="${escapeHtml(item.name)}">
      <div class="file-cell file-cell--name">
        <span class="file-icon folder">${ICONS.groups}</span>
        <span class="file-name">${escapeHtml(item.name)}</span>
      </div>
      <div class="file-cell file-cell--size">${cnt}</div>
      <div class="file-cell file-cell--date">—</div>
      <div class="file-cell file-cell--actions file-actions"><button class="icon-btn" data-action="group-menu" title="更多">${ICONS.more}</button></div>
    </div>`;
  }
  const icon = getFileIcon(item.name, item.is_dir);
  const groupHtml = (!selectedGroup && item.group_name) ? `<span class="badge badge-group">${escapeHtml(item.group_name)}</span>` : '';
  const guardHtml = item.guard_status === 'warning' ? '<span class="badge badge-warning">注意</span>' : item.guard_status === 'blocked' ? '<span class="badge badge-danger">敏感</span>' : '';
  const checkHtml = (fileSelectMode && !item.is_dir) ? `<div class="file-check ${isSel ? 'is-checked' : ''}" data-action="toggle-select">${isSel ? CHECK_ICON : ''}</div>` : '';
  const selCls = isSel ? ' is-selected' : '';
  if (fileView === 'grid') {
    return `<div class="file-card${selCls}" data-path="${escapeHtml(item.path)}" data-isdir="${item.is_dir}" data-name="${escapeHtml(item.name)}">
      ${checkHtml}
      <div class="file-icon ${icon.cls}">${icon.icon}</div>
      <div class="file-name">${escapeHtml(item.name)}</div>
      <div class="file-card-meta"><span>${item.is_dir ? '文件夹' : formatSize(item.size)}</span></div>
    </div>`;
  }
  return `<div class="file-row${selCls}" data-path="${escapeHtml(item.path)}" data-isdir="${item.is_dir}" data-name="${escapeHtml(item.name)}">
    <div class="file-cell file-cell--name">
      ${checkHtml}
      <span class="file-icon ${icon.cls}">${icon.icon}</span>
      <span class="file-name">${escapeHtml(item.name)}</span>
      ${groupHtml}${guardHtml}
    </div>
    <div class="file-cell file-cell--size">${item.is_dir ? '—' : formatSize(item.size)}</div>
    <div class="file-cell file-cell--date">${item.modified ? formatDate(item.modified) : '—'}</div>
    <div class="file-cell file-cell--actions file-actions">
      ${!item.is_dir ? `<button class="icon-btn" data-action="preview" title="预览">${ICONS.eye}</button>` : ''}
      ${!item.is_dir ? `<button class="icon-btn" data-action="download" title="下载">${ICONS.download}</button>` : ''}
      <button class="icon-btn danger" data-action="delete" title="删除">${ICONS.trash}</button>
      <button class="icon-btn" data-action="menu" title="更多">${ICONS.more}</button>
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
        selectedGroup = row.dataset.gid; currentDir = ''; searchQuery = '';
        const si = document.getElementById('search-input'); if (si) si.value = '';
        loadFiles();
      } else if (row.dataset.isdir === 'true') {
        currentDir = row.dataset.path; selectedGroup = ''; searchQuery = '';
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
    if (chk) { chk.classList.toggle('is-checked', !had); chk.innerHTML = !had ? CHECK_ICON : ''; }
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
      <button class="btn btn-secondary btn-sm" id="btn-batch-move">移动到分组</button>
      <button class="btn btn-danger btn-sm" id="btn-batch-delete">删除</button>
      <button class="btn btn-secondary btn-sm" id="btn-cancel-select">退出选择</button>`;
    bar.querySelector('#btn-select-all').addEventListener('click', selectAllFiles);
    bar.querySelector('#btn-batch-move').addEventListener('click', batchMoveSelected);
    bar.querySelector('#btn-batch-delete').addEventListener('click', batchDeleteSelected);
    bar.querySelector('#btn-cancel-select').addEventListener('click', exitSelectMode);
  }
  bar.querySelector('.batch-count').textContent = `已选 ${n} 项`;
  bar.querySelector('#btn-batch-move').disabled = !n;
  bar.querySelector('#btn-batch-delete').disabled = !n;
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
  if (!await confirmDialog({ title: '批量删除', message: `确定删除选中的 ${paths.length} 个文件？删除后无法恢复。`, confirmText: '删除', danger: true })) return;
  // 各文件删除互相独立，并发执行以缩短总耗时
  const results = await Promise.all(paths.map(p =>
    API.del(`/api/files?path=${encodeURIComponent(p)}`).then(r => r.ok).catch(() => false)
  ));
  const ok = results.filter(Boolean).length;
  const fail = results.length - ok;
  Toast.show(`已删除 ${ok} 项${fail ? `，失败 ${fail} 项` : ''}`, fail ? 'warning' : 'success');
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

function showFileMenu(eventOrX, path, name, isDir) {
  let x, y;
  if (eventOrX.clientX !== undefined) { x = eventOrX.clientX; y = eventOrX.clientY; }
  else { x = eventOrX; y = arguments[3] || 100; name = arguments[2]; isDir = false; path = arguments[1]; }

  // Handle the case where called from onclick with (event, path, name, isDir)
  if (typeof eventOrX === 'object' && eventOrX.stopPropagation) {
    x = eventOrX.clientX; y = eventOrX.clientY;
  }

 const items = [];
 if (!isDir) {
   items.push({ action: 'preview', label: '预览', icon: ICONS.eye, onClick: () => previewFile(path, name) });
   items.push({ action: 'download', label: '下载', icon: ICONS.download, onClick: () => downloadFile(path) });
   items.push({ action: 'move-group', label: '移动到分组', icon: ICONS.groups, onClick: () => showMoveToGroupMenu(x, y, path) });
   items.push({ divider: true });
 } else {
   items.push({ action: 'open', label: '打开', icon: ICONS.folder, onClick: () => { currentDir = path; searchQuery = ''; document.getElementById('search-input').value = ''; loadFiles(); } });
 }
  items.push({ action: 'delete', label: '删除', icon: ICONS.trash, danger: true, onClick: () => deleteFile(path) });
  showContextMenu(x, y, items);
}

function renderSearchResults(results) {
  const content = document.getElementById('file-content');
  if (!results.length) {
    content.innerHTML = `<div class="file-table"><div class="empty-state">${ICONS.search}<div class="empty-title">没有找到匹配的文件</div></div></div>`;
    return;
  }
  content.innerHTML = `<div class="file-table">
    <div class="file-table-head">
      <span class="file-cell file-cell--name">搜索结果 · ${results.length} 项</span>
      <span class="file-cell file-cell--size">大小</span>
      <span class="file-cell file-cell--date">匹配</span>
      <span class="file-cell file-cell--actions"></span>
    </div>${results.map(r => {
      const icon = getFileIcon(r.name || r.path, false);
      const score = r.score ? Math.round(r.score * 100) + '%' : '—';
      return `<div class="file-row" data-path="${escapeHtml(r.path)}" data-name="${escapeHtml(r.name || r.path)}">
        <div class="file-cell file-cell--name">
          <span class="file-icon ${icon.cls}">${icon.icon}</span>
          <span class="file-name">${escapeHtml(r.name || r.path)}</span>
        </div>
        <div class="file-cell file-cell--size">${formatSize(r.size)}</div>
        <div class="file-cell file-cell--date">${score}</div>
        <div class="file-cell file-cell--actions file-actions">
          <button class="icon-btn" data-action="preview" title="预览">${ICONS.eye}</button>
          <button class="icon-btn" data-action="download" title="下载">${ICONS.download}</button>
          <button class="icon-btn danger" data-action="delete" title="删除">${ICONS.trash}</button>
        </div>
      </div>`;
    }).join('')}
  </div>`;
 content.querySelectorAll('.file-row').forEach(row => {
   row.addEventListener('click', () => previewFile(row.dataset.path, row.dataset.name));
   row.querySelectorAll('[data-action]').forEach(btn => {
     btn.addEventListener('click', (e) => {
       e.stopPropagation();
       const a = btn.dataset.action;
       const { path, name } = row.dataset;
       if (a === 'preview') previewFile(path, name);
       else if (a === 'download') downloadFile(path);
       else if (a === 'delete') deleteFile(path);
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
      xhr.setRequestHeader('Authorization', `Bearer ${API._token}`);
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
async function previewFile(path, name) {
  const fileName = name || path.split('/').pop();
  const previewType = getPreviewType(fileName);
  if (!previewType) {
    Toast.show('此类型不支持浏览器预览，请在守护进程设备查看，或到设置页开启临时下载', 'info');
    return;
  }

  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.className = 'preview-overlay';
  overlay.innerHTML = `
    <div class="preview-header">
      <div class="preview-title" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</div>
      <div class="preview-actions">
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
  document.getElementById('btn-preview-download').addEventListener('click', () => downloadFile(path));
  const escHandler = (e) => { if (e.key === 'Escape') { closePreview(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);

  const body = document.getElementById('preview-body');

  try {
    if (previewType === 'text') {
      const res = await API.get(`/api/files/preview-text?path=${encodeURIComponent(path)}`);
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
      const res = await API.get(`/api/files/preview?path=${encodeURIComponent(path)}`);
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

async function downloadFile(path) {
  try {
    const res = await API.get(`/api/files/download?path=${encodeURIComponent(path)}`);
    if (!res) return;  // 会话已失效并被登出（API.request 返回 undefined）
    if (res.status === 403) { Toast.show('未开启临时下载，请到设置页开启', 'info'); return; }
    if (!res.ok) { Toast.show('下载失败', 'error'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = path.split('/').pop(); a.click();
    URL.revokeObjectURL(url);
  } catch (err) { Toast.show('下载出错: ' + err.message, 'error'); }
}

async function deleteFile(path) {
  if (!await confirmDialog({ title: '删除文件', message: `确定删除 "${path.split('/').pop()}"？删除后无法恢复。`, confirmText: '删除', danger: true })) return;
  try {
    const res = await API.del(`/api/files?path=${encodeURIComponent(path)}`);
    if (res.ok) { Toast.show('已删除', 'success'); loadFiles(); }
    else { const data = await res.json(); Toast.show(data.detail || '删除失败', 'error'); }
  } catch (err) { Toast.show('删除出错: ' + err.message, 'error'); }
}

// ============ Chat ============
const COPY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>';

let chatMessages = [];
let chatSending = false;
let currentChatAbort = null;

function scrollChat(container) {
  if (container) container.scrollTop = container.scrollHeight;
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
function messageElement(msg) {
  const wrap = document.createElement('div');
  wrap.className = `chat-message ${msg.role}`;
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  if (msg.role === 'assistant') {
    bubble.classList.add('markdown');
    bubble.innerHTML = renderMarkdown(msg.content);
  } else {
    bubble.textContent = msg.content; // 用户消息纯文本，防 XSS
  }
  wrap.appendChild(bubble);
  if (msg.role === 'assistant') {
    if (msg.tool_calls && msg.tool_calls.length) updateToolsInMessage(wrap, msg.tool_calls);
    const actions = document.createElement('div');
    actions.className = 'chat-msg-actions';
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'chat-msg-copy';
    copyBtn.title = '复制';
    copyBtn.innerHTML = COPY_SVG;
    copyBtn.addEventListener('click', async () => {
      const ok = await copyToClipboard(msg.content || '');
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
      headers: { 'Content-Type': 'application/json', ...(API._token ? { 'Authorization': `Bearer ${API._token}` } : {}) },
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
          scrollChat(container);
        } else if (payload.type === 'done') {
          assistantMsg.content = payload.data.reply || assistantMsg.content || '(无回复)';
          assistantMsg.tool_calls = payload.data.tool_calls || assistantMsg.tool_calls;
          bubble.innerHTML = renderMarkdown(assistantMsg.content);
          updateToolsInMessage(assistantEl, assistantMsg.tool_calls);
          scrollChat(container);
        } else if (payload.type === 'error') {
          assistantMsg.content = '出错了: ' + payload.data;
          bubble.innerHTML = renderMarkdown(assistantMsg.content);
        }
      }
    }
    if (!assistantMsg.content) {
      assistantMsg.content = controller.signal.aborted ? '（已停止）' : '(无回复)';
      bubble.innerHTML = renderMarkdown(assistantMsg.content);
    }
  } catch (err) {
    if (typingEl.isConnected) typingEl.remove();
    if (err && err.name === 'AbortError') {
      assistantMsg.content += assistantMsg.content ? '\n\n_（已停止）_' : '（已停止）';
    } else {
      assistantMsg.content = '出错了: ' + (err && err.message || '未知错误');
    }
    bubble.innerHTML = renderMarkdown(assistantMsg.content);
  } finally {
    chatSending = false;
    currentChatAbort = null;
    setSendButtonState('send');
  }
}

// ============ Transfer Assistant (文件传输助手) ============
let transferMessages = [];
let transferSending = false;

async function renderTransfer() {
  document.getElementById('main-content').innerHTML = `
    <div class="topbar">
      <div class="topbar-title">传输助手</div>
      <div class="topbar-spacer"></div>
      <button class="btn btn-secondary btn-icon-only" id="btn-transfer-refresh" title="刷新">${ICONS.refresh}</button>
    </div>
    <div class="chat-container transfer-container">
      <div class="chat-messages transfer-messages" id="transfer-messages"></div>
      <div class="chat-input-area transfer-input-area">
        <input type="file" id="transfer-file-input" multiple hidden>
        <div class="chat-input-wrapper transfer-input-wrapper">
          <button class="btn btn-secondary btn-icon-only" id="btn-transfer-attach" title="发送文件">${ICONS.add}</button>
          <textarea class="chat-input" id="transfer-input" placeholder="发送文字或文件给自己..." rows="1"></textarea>
          <button class="btn btn-primary btn-icon-only" id="btn-transfer-send" title="发送">${ICONS.send}</button>
        </div>
      </div>
    </div>`;
  await loadTransferMessages();
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

async function loadTransferMessages() {
  try {
    const res = await API.get('/api/transfer/messages?limit=200');
    const data = await res.json();
    transferMessages = data.messages || [];
  } catch { transferMessages = []; }
  renderTransferMessages();
}

function renderTransferMessages() {
  const container = document.getElementById('transfer-messages');
  if (!container) return;
  if (!transferMessages.length) {
    container.innerHTML = `
      <div class="transfer-empty">
        <div class="transfer-empty-icon">${ICONS.transfer}</div>
        <p class="transfer-empty-title">文件传输助手</p>
        <p class="transfer-empty-desc">把文字或文件发给自己，文字随手记，文件自动存入文件库。</p>
      </div>`;
    return;
  }
  container.innerHTML = transferMessages.map(msg => {
    const time = formatDateTime(msg.created_at);
    const delBtn = `<button class="transfer-del" title="删除" data-action="delete-msg" data-id="${escapeHtml(msg.id)}">${ICONS.trash}</button>`;
    if (msg.type === 'text') {
      return `<div class="transfer-msg">
        <div class="transfer-msg-body">
          <div class="transfer-text-bubble">${escapeHtml(msg.content).replace(/\n/g, '<br>')}</div>
          <span class="transfer-time">${time}</span>
        </div>
        ${delBtn}
      </div>`;
    }
    const f = msg.file;
    if (!f) return '';
    const fi = getFileIcon(f.name, false);
    const guardBadge = f.guard_status === 'warning'
      ? `<span class="transfer-file-guard warning">敏感提醒</span>` : '';
    return `<div class="transfer-msg">
      <div class="transfer-msg-body">
        <div class="transfer-file-card" data-action="preview-transfer" data-path="${escapeHtml(f.path)}" data-name="${escapeHtml(f.name)}">
          <div class="transfer-file-icon ${fi.cls}">${fi.icon}</div>
          <div class="transfer-file-info">
            <div class="transfer-file-name">${escapeHtml(f.name)}</div>
            <div class="transfer-file-meta">
              <span>${formatSize(f.size)}</span>
              <span class="transfer-saved">✓ 已存入文件库</span>
            </div>
          </div>
          <button class="transfer-file-dl" title="下载" data-action="download" data-path="${escapeHtml(f.path)}">${ICONS.download}</button>
        </div>
        <span class="transfer-time">${time}</span>
        ${guardBadge}
      </div>
      ${delBtn}
    </div>`;
  }).join('');
  container.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', (e) => {
      const a = el.dataset.action;
      if (a === 'download') { e.stopPropagation(); downloadFile(el.dataset.path); }
      else if (a === 'delete-msg') { e.stopPropagation(); deleteTransferMessage(el.dataset.id); }
      else if (a === 'preview-transfer') previewTransferFile(el.dataset.path, el.dataset.name);
    });
  });
  container.scrollTop = container.scrollHeight;
}

async function sendTransferText() {
  if (transferSending) return;
  const input = document.getElementById('transfer-input');
  const text = input.value.trim();
  if (!text) return;
  transferSending = true;
  const btn = document.getElementById('btn-transfer-send');
  btn.disabled = true;
  try {
    const res = await API.post('/api/transfer/text', { content: text });
    if (!res.ok) { const d = await res.json(); Toast.show(d.detail || '发送失败', 'error'); return; }
    const msg = await res.json();
    transferMessages.push(msg);
    input.value = ''; input.style.height = 'auto';
    renderTransferMessages();
  } catch (err) {
    Toast.show('发送失败: ' + err.message, 'error');
  } finally { transferSending = false; btn.disabled = false; }
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
      xhr.setRequestHeader('Authorization', `Bearer ${API._token}`);
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

async function deleteTransferMessage(id) {
  if (!await confirmDialog({ title: '删除记录', message: '确定删除这条记录？', confirmText: '删除', danger: true })) return;
  try {
    const res = await API.del(`/api/transfer/${id}`);
    if (res.ok) {
      transferMessages = transferMessages.filter(m => m.id !== id);
      renderTransferMessages();
      Toast.show('已删除', 'success');
    } else { const d = await res.json(); Toast.show(d.detail || '删除失败', 'error'); }
  } catch (err) { Toast.show('删除出错: ' + err.message, 'error'); }
}

function previewTransferFile(path, name) {
  previewFile(path, name);
}

// ============ Settings ============
async function renderSettings() {
  document.getElementById('main-content').innerHTML = `
    <div class="topbar"><div class="topbar-title">设置</div></div>
    <div class="settings-container">
      <div class="settings-group">
        <div class="settings-group-title">存储与索引</div>
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
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">安全</div>
        <div class="settings-section">
          <div class="setting-head">
            <div class="setting-head-icon icon-success">${ICONS.key}</div>
            <div class="setting-head-text"><h3>访问令牌与会话</h3><p class="section-desc">管理设备令牌与浏览器登录会话，离职或换机时吊销即可切断访问。</p></div>
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
            <div class="setting-head-text"><h3>临时下载</h3><p class="section-desc">浏览器端默认禁止下载（零痕迹）。需要时开启短期窗口，到期自动关闭。</p></div>
          </div>
          <div class="setting-body" id="download-grant-content">加载中...</div>
        </div>
        <div class="settings-section">
          <div class="setting-head">
            <div class="setting-head-icon icon-warning">${ICONS.shield}</div>
            <div class="setting-head-text"><h3>双因子验证</h3><p class="section-desc">增强账户安全性，公用设备建议开启。</p></div>
          </div>
          <div class="setting-body" id="totp-content">加载中...</div>
        </div>
        <div class="settings-section">
          <div class="setting-head">
            <div class="setting-head-icon icon-primary">${ICONS.lock}</div>
            <div class="setting-head-text"><h3>修改密码</h3><p class="section-desc">定期更换密码以保障账户安全</p></div>
          </div>
          <div class="setting-body">
            <div class="setting-form">
              <div class="form-group"><label>原密码</label><input type="password" id="old-pass" class="form-input" placeholder="请输入原密码"></div>
              <div class="form-group"><label>新密码</label><input type="password" id="new-pass" class="form-input" placeholder="请输入新密码"></div>
              <button class="btn btn-primary" id="btn-change-pwd">修改密码</button>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">账户</div>
        <div class="settings-section">
          <div class="setting-head">
            <div class="setting-head-icon icon-primary">${ICONS.user}</div>
            <div class="setting-head-text"><h3>账户信息</h3><p class="section-desc">当前登录的账号身份与状态</p></div>
          </div>
          <div class="setting-body" id="account-info">加载中...</div>
        </div>
        <div class="settings-section">
          <div class="setting-head">
            <div class="setting-head-icon icon-danger">${ICONS.logout}</div>
            <div class="setting-head-text"><h3>退出登录</h3><p class="section-desc">退出当前账户，需要重新登录</p></div>
            <div class="setting-head-action"><button class="btn btn-danger" id="btn-logout">${ICONS.logout}<span>退出</span></button></div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.getElementById('btn-logout').addEventListener('click', () => App.logout());
  document.getElementById('btn-change-pwd')?.addEventListener('click', async () => {
    const oldP = document.getElementById('old-pass').value;
    const newP = document.getElementById('new-pass').value;
    if (!oldP || !newP) { Toast.show('请填写完整', 'error'); return; }
    try {
      const res = await API.post('/api/auth/change-password', { old_password: oldP, new_password: newP });
      if (res.ok) {
        const d = await res.json();
        if (d.access_token) API.setTokens(d.access_token, d.refresh_token);  // 续登：用新令牌继续会话
        Toast.show('密码已修改', 'success');
        document.getElementById('old-pass').value = '';
        document.getElementById('new-pass').value = '';
      }
      else { const d = await res.json(); Toast.show(d.detail || '修改失败', 'error'); }
    } catch { Toast.show('网络错误', 'error'); }
  });
  document.getElementById('btn-create-token').addEventListener('click', createToken);
  document.getElementById('btn-revoke-all-tokens').addEventListener('click', revokeAllTokens);
  document.getElementById('btn-reindex').addEventListener('click', rebuildIndex);
  loadStats(); loadTokens(); loadTOTP(); loadAccountInfo(); loadDownloadGrant();
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
    el.innerHTML = `
      <div class="account-info">
        <div class="account-row">
          <div class="account-avatar">${escapeHtml(me.username.charAt(0).toUpperCase())}</div>
          <div class="account-name">
            <div class="account-username">${escapeHtml(me.username)}</div>
            <div class="account-sub">${roleMap[me.role] || me.role} · ${statusBadge}</div>
          </div>
        </div>
        <div class="account-grid">
          <div class="account-field"><span class="account-label">用户名</span><span class="account-value">${escapeHtml(me.username)}</span></div>
          <div class="account-field"><span class="account-label">角色</span><span class="account-value">${roleMap[me.role] || me.role}</span></div>
          <div class="account-field"><span class="account-label">账户状态</span><span class="account-value">${statusBadge}</span></div>
          <div class="account-field"><span class="account-label">存储配额</span><span class="account-value">${quotaText}</span></div>
          <div class="account-field"><span class="account-label">双因子验证</span><span class="account-value">${totpBadge}</span></div>
          <div class="account-field"><span class="account-label">最近登录</span><span class="account-value">${me.last_login_at ? formatDateTime(me.last_login_at) : '-'}</span></div>
          <div class="account-field"><span class="account-label">注册时间</span><span class="account-value">${me.created_at ? formatDateTime(me.created_at) : '-'}</span></div>
        </div>
      </div>`;
  } catch {
    renderErrorState(el, '账户信息加载失败', () => loadAccountInfo());
  }
}

async function loadStats() {
  const el = document.getElementById('stats-content');
  try {
    const res = await API.get('/api/files/stats');
    const data = await res.json();
    el.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">文件总数</div><div class="stat-value">${data.total_files}</div></div>
        <div class="stat-card accent-success"><div class="stat-label">占用空间</div><div class="stat-value">${data.total_size_mb}<span class="stat-unit"> MB</span></div></div>
        <div class="stat-card"><div class="stat-label">磁盘总量</div><div class="stat-value">${data.disk.total_gb}<span class="stat-unit"> GB</span></div></div>
        <div class="stat-card accent-warning"><div class="stat-label">可用空间</div><div class="stat-value">${data.disk.free_gb}<span class="stat-unit"> GB</span></div></div>
      </div>
    `;
  } catch { renderErrorState(el, '统计加载失败', () => loadStats()); }
}

function parseServerTs(ts) {
  if (!ts) return 0;
  let s = String(ts);
  if (s.indexOf('T') === -1) s = s.replace(' ', 'T');
  if (!/[+-]\d{2}:?\d{2}$/.test(s) && !s.endsWith('Z')) s += 'Z';
  const d = new Date(s);
  return isNaN(d) ? 0 : d.getTime();
}
function isTokenActive(t) {
  if (t.revoked) return false;
  if (t.expires_at && parseServerTs(t.expires_at) < Date.now()) return false;
  return true;
}
function tokenStatusBadge(t) {
  if (t.revoked) return '<span class="badge badge-danger">已吊销</span>';
  if (t.expires_at && parseServerTs(t.expires_at) < Date.now()) return '<span class="badge badge-danger">已过期</span>';
  return '<span class="badge badge-success">有效</span>';
}
function tokenKindBadge(t) {
  return t.kind === 'session'
    ? '<span class="badge badge-info">浏览器会话</span>'
    : '<span class="badge badge-info">设备令牌</span>';
}
function tokenExpiryText(t) {
  if (!t.expires_at) return '永久';
  return formatDateTime(t.expires_at);
}

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

  if (!tokens.length) {
    el.innerHTML = '<p class="setting-empty">暂无设备令牌，点击右上角“创建令牌”添加。</p>';
    return;
  }
  el.innerHTML = tokens.map(t => `
    <div class="token-row">
      <div class="token-info">
        <div class="token-label">${escapeHtml(t.label) || '未命名设备'} ${tokenKindBadge(t)} ${tokenStatusBadge(t)}</div>
        <div class="token-meta-row">
          <span>创建 ${formatDateTime(t.created_at)}</span>
          <span class="dot-sep">·</span>
          <span>最近活跃 <span class="${t.last_used_at ? '' : 'token-never'}">${t.last_used_at ? formatDateTime(t.last_used_at) : '从未'}</span></span>
          <span class="dot-sep">·</span>
          <span>过期 ${tokenExpiryText(t)}</span>
        </div>
      </div>
      ${isTokenActive(t) ? `<button class="btn btn-danger btn-sm" data-action="revokeToken" data-token-id="${escapeHtml(t.id)}">吊销</button>` : ''}
    </div>`).join('');
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
    API.clearTokens();
    App.logout();  // 紧急下线：自己的 access 也已失效
  } catch { Toast.show('操作失败', 'error'); }
}

// ---- 临时下载授权（浏览器端默认禁下载，设置页开启短期窗口）----
let _downloadGrantTimer = null;

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

function renderDownloadGrant(el, granted, until) {
  if (_downloadGrantTimer) { clearInterval(_downloadGrantTimer); _downloadGrantTimer = null; }
  if (!granted) {
    el.innerHTML = `
      <div class="setting-row">
        <p class="section-desc setting-row-text">未开启。下载的文件会保留在本机，请及时清理。</p>
        <button class="btn btn-primary" id="btn-download-grant">${ICONS.download}<span>开启临时下载</span></button>
      </div>`;
    document.getElementById('btn-download-grant')?.addEventListener('click', grantDownload);
    return;
  }
  el.innerHTML = `
    <div class="setting-row">
      <p class="setting-row-text">下载已开启，剩余 <strong id="download-grant-countdown">--:--</strong></p>
      <button class="btn btn-secondary" id="btn-download-revoke"><span>立即关闭</span></button>
    </div>`;
  document.getElementById('btn-download-revoke')?.addEventListener('click', revokeDownload);
  const tick = () => {
    if (!document.getElementById('download-grant-countdown')) { clearInterval(_downloadGrantTimer); _downloadGrantTimer = null; return; }
    const remain = Math.max(0, Math.floor((parseServerTs(until) - Date.now()) / 1000));
    const cd = document.getElementById('download-grant-countdown');
    if (cd) cd.textContent = `${String(Math.floor(remain/60)).padStart(2,'0')}:${String(remain%60).padStart(2,'0')}`;
    if (remain <= 0) { clearInterval(_downloadGrantTimer); _downloadGrantTimer = null; loadDownloadGrant(); }
  };
  tick();
  _downloadGrantTimer = setInterval(tick, 1000);
}

async function grantDownload() {
  if (!await confirmDialog({ title: '开启临时下载', message: '开启后可下载文件，到期自动关闭。下载的文件会保留在本机，请及时清理。确定继续？', confirmText: '开启' })) return;
  try {
    const res = await API.post('/api/files/download-grant');
    if (!res) return;  // 会话已失效并被登出
    if (!res.ok) { const d = await res.json(); Toast.show(d.detail || '开启失败', 'error'); return; }
    const d = await res.json();
    Toast.show(`已开启临时下载（${d.minutes} 分钟）`, 'success');
    renderDownloadGrant(document.getElementById('download-grant-content'), true, d.until);
  } catch { Toast.show('开启失败', 'error'); }
}

async function revokeDownload() {
  try {
    const res = await API.post('/api/files/download-revoke');
    if (!res) return;  // 会话已失效并被登出
    if (!res.ok) { const d = await res.json(); Toast.show(d.detail || '操作失败', 'error'); return; }
    Toast.show('已关闭临时下载', 'success');
    renderDownloadGrant(document.getElementById('download-grant-content'), false, '');
  } catch { Toast.show('操作失败', 'error'); }
}

async function revokeToken(id) {
  if (!await confirmDialog({ title: '吊销令牌', message: '确定吊销此令牌？该设备将立即无法访问。', confirmText: '吊销', danger: true })) return;
  try { await API.del(`/api/auth/tokens/${id}`); Toast.show('令牌已吊销', 'success'); loadTokens(); }
  catch { Toast.show('操作失败', 'error'); }
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
    if (!API._token) { renderLanding(); return; }
    // 拉取当前账号信息，解决“不知是哪个账号”的痛点；失败则回到登录页
    try {
      const res = await API.get('/api/auth/me');
      if (!res || !res.ok) { API.clearTokens(); renderLogin(); return; }
      this.currentUser = await res.json();
    } catch {
      API.clearTokens(); renderLogin(); return;
    }
    this.renderLayout();
    this.navigate('transfer');
    setupDragDrop();
    setupPaste();
    document.addEventListener('click', closeContextMenu);
  },
  renderLayout() {
    document.getElementById('app').innerHTML = `
      <div class="app-layout">
        <div class="sidebar">
          <div class="sidebar-logo" id="sidebar-logo" title="${this.currentUser ? (this.currentUser.username + ' · 点击查看账户信息') : '随行档'}">${this.currentUser ? this.currentUser.username.charAt(0).toUpperCase() : '档'}</div>
         <button class="nav-btn active" data-view="transfer" title="传输助手">${ICONS.transfer}</button>
          ${this.currentUser && this.currentUser.ai_enabled ? `<button class="nav-btn" data-view="chat" title="AI助手">${ICONS.chat}</button>` : ''}
         <button class="nav-btn" data-view="files" title="文件">${ICONS.files}</button>
          <button class="nav-btn" data-view="settings" title="设置">${ICONS.settings}</button>
          <div class="nav-spacer"></div>
          <button class="nav-btn nav-logout" title="退出登录">${ICONS.logout}</button>
        </div>
        <div class="main-content" id="main-content"></div>
      </div>`;
    document.querySelectorAll('.nav-btn').forEach(btn => {
      if (!btn.dataset.view) return;
      btn.addEventListener('click', () => this.navigate(btn.dataset.view));
    });
    const logoutBtn = document.querySelector('.nav-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', () => this.logout());
    const logoBtn = document.getElementById('sidebar-logo');
    if (logoBtn) logoBtn.style.cursor = 'pointer', logoBtn.addEventListener('click', () => this.navigate('settings'));
  },
  navigate(view) {
    // 离开聊天视图时中止进行中的流式回复，避免向已分离的 DOM 继续写入
    if (this.currentView === 'chat' && view !== 'chat' && currentChatAbort) currentChatAbort.abort();
    this.currentView = view;
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
    if (view === 'chat' && !(this.currentUser && this.currentUser.ai_enabled)) {
      document.getElementById('main-content').innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:12px;color:var(--text-muted)">${ICONS.chat}<p>管理员未为您开通 AI 助手功能</p></div>`;
      return;
    }
    if (view === 'files') renderFiles();
    else if (view === 'chat') renderChat();
    else if (view === 'transfer') renderTransfer();
    else if (view === 'settings') renderSettings();
  },
  logout() { if (currentChatAbort) currentChatAbort.abort(); API.clearTokens(); this.currentView = 'transfer'; renderLanding(); }
};

// Expose for inline handlers
window.downloadFile = downloadFile;
window.deleteFile = deleteFile;
window.previewFile = previewFile;
window.revokeToken = revokeToken;
window.showFileMenu = showFileMenu;
window.showGroupManager = showGroupManager;
window.showGroupFolderMenu = showGroupFolderMenu;
window.createGroup = createGroup;
window.renameGroup = renameGroup;
window.deleteGroup = deleteGroup;
window.UploadManager = UploadManager;
window.deleteTransferMessage = deleteTransferMessage;
window.previewTransferFile = previewTransferFile;
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
});

App.init();
