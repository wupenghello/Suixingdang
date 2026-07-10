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
        ${active === 0 ? `<button class="icon-btn" onclick="UploadManager.close()" style="width:20px;height:20px">✕</button>` : ''}
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

// ============ Utils ============
function formatSize(bytes) {
  if (!bytes) return '-';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(typeof ts === 'number' ? ts * 1000 : ts);
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
function formatDateTime(ts) {
  if (!ts) return '';
  let s = String(ts);
  // 服务器时间为 UTC（naive datetime），补齐为 ISO 并按 UTC 解析后转本地时区
  if (s.indexOf('T') === -1) s = s.replace(' ', 'T');
  if (!/[+-]\d{2}:?\d{2}$/.test(s) && !s.endsWith('Z')) s += 'Z';
  const d = new Date(s);
  if (isNaN(d)) return String(ts);
  return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
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
  div.textContent = text;
  return div.innerHTML;
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


// ============ Register ============
async function renderRegister() {
  document.getElementById('app').innerHTML = `
    <div class="login-container">
      <div class="login-card">
        <div class="login-logo">档</div>
        <h1>注册账号</h1>
        <p class="subtitle">创建你的私人文件中枢</p>
        <form id="register-form">
          <div class="form-group"><label>用户名</label><input type="text" id="reg-username" class="form-input" placeholder="2个字符以上" autofocus></div>
          <div class="form-group"><label>密码</label><input type="password" id="reg-password" class="form-input" placeholder="4个字符以上"></div>
          <div class="form-group"><label>密保问题</label><input type="text" id="reg-question" class="form-input" placeholder="如：你最喜爱的运动是什么？"></div>
          <div class="form-group"><label>密保答案</label><input type="text" id="reg-answer" class="form-input" placeholder="用于找回密码"></div>
          <button type="submit" class="btn btn-primary btn-block" id="reg-btn" style="padding:10px 16px">注册</button>
        </form>
        <p style="text-align:center;margin-top:16px"><a href="javascript:renderLogin()" style="color:var(--text-muted);font-size:13px;text-decoration:none">已有账号？登录</a></p>
      </div>
    </div>`;
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
  document.getElementById('app').innerHTML = `
    <div class="login-container">
      <div class="login-card">
        <div class="login-logo">档</div>
        <h1>找回密码</h1>
        <p class="subtitle">通过密保问题重置密码</p>
        <form id="forgot-form">
          <div class="form-group"><label>用户名</label><input type="text" id="fp-username" class="form-input" placeholder="输入你的用户名" autofocus></div>
          <div id="fp-step2" style="display:none">
            <div class="form-group"><label>密保问题</label><input type="text" id="fp-question" class="form-input" readonly style="opacity:0.7"></div>
            <div class="form-group"><label>密保答案</label><input type="text" id="fp-answer" class="form-input" placeholder="输入密保答案"></div>
            <div class="form-group"><label>新密码</label><input type="password" id="fp-newpass" class="form-input" placeholder="4个字符以上"></div>
          </div>
          <button type="submit" class="btn btn-primary btn-block" id="fp-btn" style="padding:10px 16px">下一步</button>
        </form>
        <p style="text-align:center;margin-top:16px"><a href="javascript:renderLogin()" style="color:var(--text-muted);font-size:13px;text-decoration:none">返回登录</a></p>
      </div>
    </div>`;
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

// ============ Login ============
function renderLogin() {
  document.getElementById('app').innerHTML = `
    <div class="login-container">
      <div class="login-card">
        <div class="login-logo">档</div>
        <h1>随行档</h1>
        <p class="subtitle">私人文件中枢 · 零痕迹 · AI 驱动</p>
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
          <button type="submit" class="btn btn-primary btn-block" id="login-btn" style="padding:10px 16px">登录</button>
        </form>
        <div id="auth-links" style="display:flex;justify-content:space-between;margin-top:16px">
          <a href="javascript:renderForgotPassword()" style="color:var(--text-muted);font-size:13px;text-decoration:none">忘记密码？</a>
          <a href="javascript:renderRegister()" id="register-link" style="color:var(--text-muted);font-size:13px;text-decoration:none">注册新账号</a>
        </div>
      </div>
    </div>
  `;
  // 动态检查注册是否开放
  fetch('/api/auth/register-status').then(r => r.json()).then(d => {
    const link = document.getElementById('register-link');
    if (link) link.style.display = d.allow_register ? '' : 'none';
  }).catch(() => {});

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

async function renderFiles() {
  document.getElementById('main-content').innerHTML = `
    <div class="topbar">
      <div class="topbar-title">文件</div>
      <div class="topbar-spacer"></div>
      <button class="btn btn-secondary btn-icon-only" id="btn-refresh" title="刷新">${ICONS.refresh}</button>
      <button class="btn btn-secondary" id="btn-groups" title="分组管理">${ICONS.groups}<span>分组</span></button>
      <button class="btn btn-primary" id="btn-upload">${ICONS.upload}<span>上传</span></button>
    </div>
    <div class="file-browser">
      <div class="file-toolbar">
        <div class="search-box">${ICONS.search}<input type="text" id="search-input" placeholder="搜索文件..." value="${escapeHtml(searchQuery)}"></div>
      </div>
      <div class="breadcrumb" id="breadcrumb"></div>
      <div id="file-content"></div>
    </div>
    <input type="file" id="file-input" style="display:none" multiple>
  `;
  document.getElementById('btn-refresh').addEventListener('click', () => { Toast.show('刷新中', 'info', 1000); loadFiles(); });
  document.getElementById('btn-groups').addEventListener('click', showGroupManager);
  document.getElementById('btn-upload').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('file-input').addEventListener('change', (e) => { if (e.target.files.length) handleFilesUpload(e.target.files); e.target.value = ''; });

  const searchInput = document.getElementById('search-input');
  let debounceTimer;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { searchQuery = e.target.value; loadFiles(); }, 300);
  });
  await loadGroups();
  loadFiles();
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
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="width:480px">
      <h3>分组管理</h3>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <input type="text" id="new-group-name" class="form-input" placeholder="新分组名称" style="flex:1">
        <button class="btn btn-primary" id="btn-create-group">${ICONS.add} 创建</button>
      </div>
      <div id="group-list" style="max-height:320px;overflow:auto">加载中...</div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">关闭</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('btn-create-group').addEventListener('click', createGroup);
  document.getElementById('new-group-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') createGroup(); });
  renderGroupManagerList();
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
        <button class="btn btn-secondary btn-sm" onclick="renameGroup('${escapeHtml(g.id)}','${escapeHtml(g.name)}')">重命名</button>
        <button class="btn btn-danger btn-sm" onclick="deleteGroup('${escapeHtml(g.id)}','${escapeHtml(g.name)}')">删除</button>
      </td>
    </tr>`).join('')}
  </tbody></table>`;
}

async function createGroup() {
  const input = document.getElementById('new-group-name');
  const name = input.value.trim();
  if (!name) { Toast.show('请输入分组名称', 'error'); return; }
  try {
    const res = await API.post('/api/files/groups', { name });
    if (!res.ok) { const d = await res.json(); Toast.show(d.detail || '创建失败', 'error'); return; }
    input.value = '';
    Toast.show('分组已创建', 'success');
    await loadGroups();
    renderGroupManagerList();
  } catch { Toast.show('创建失败', 'error'); }
}

async function renameGroup(id, oldName) {
  const name = prompt('重命名分组：', oldName);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed || trimmed === oldName) return;
  try {
    const res = await API.put(`/api/files/groups/${id}`, { name: trimmed });
    if (!res.ok) { const d = await res.json(); Toast.show(d.detail || '重命名失败', 'error'); return; }
    Toast.show('已重命名', 'success');
    await loadGroups();
    renderGroupManagerList();
    if (selectedGroup === id) loadFiles();
  } catch { Toast.show('重命名失败', 'error'); }
}

async function deleteGroup(id, name) {
  if (!confirm(`确定删除分组「${name}」？\n分组内的文件不会被删除，仅移出分组。`)) return;
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
      items.push({ action: 'g_' + g.id, label: g.name, icon: ICONS.folder, onClick: () => moveFileToGroup(path, g.id, g.name) });
    });
    items.push({ divider: true });
  }
  items.push({ action: 'new_group', label: '新建分组…', icon: ICONS.add, onClick: () => quickCreateGroupAndMove(path) });
  items.push({ action: 'remove', label: '移出分组', icon: ICONS.close, onClick: () => moveFileToGroup(path, '', '') });
  showContextMenu(x, y, items);
}

async function moveFileToGroup(path, groupId, groupName) {
  try {
    const res = await API.post(`/api/files/move-to-group?path=${encodeURIComponent(path)}&group_id=${encodeURIComponent(groupId)}`);
    if (!res.ok) { const d = await res.json(); Toast.show(d.detail || '移动失败', 'error'); return; }
    Toast.show(groupId ? `已移入「${groupName}」` : '已移出分组', 'success');
    await loadGroups();
    loadFiles();
  } catch { Toast.show('移动失败', 'error'); }
}

async function quickCreateGroupAndMove(path) {
  const name = prompt('新分组名称：');
  if (!name || !name.trim()) return;
  try {
    const res = await API.post('/api/files/groups', { name: name.trim() });
    if (!res.ok) { const d = await res.json(); Toast.show(d.detail || '创建失败', 'error'); return; }
    const data = await res.json();
    await loadGroups();
    await moveFileToGroup(path, data.id, data.name);
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
  if (searchQuery) {
    content.innerHTML = '<div class="empty-state">搜索中...</div>';
    try {
      const res = await API.get(`/api/files/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      renderSearchResults(data.results || []);
    } catch { content.innerHTML = '<div class="empty-state">搜索失败</div>'; }
  } else if (selectedGroup) {
    // 分组视图：展示该分组全部文件
    renderBreadcrumb();
    content.innerHTML = '<div class="empty-state">加载中...</div>';
    try {
      const res = await API.get(`/api/files/list?group_id=${encodeURIComponent(selectedGroup)}`);
      const data = await res.json();
      renderFileList(data.items || []);
    } catch { content.innerHTML = '<div class="empty-state">加载失败</div>'; }
  } else {
    renderBreadcrumb();
    content.innerHTML = '<div class="empty-state">加载中...</div>';
    try {
      const res = await API.get(`/api/files/list?directory=${encodeURIComponent(currentDir)}`);
      const data = await res.json();
      renderFileList(data.items || []);
    } catch { content.innerHTML = '<div class="empty-state">加载失败</div>'; }
  }
}

function renderFileList(items) {
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
    displayItems = groupFolders.concat(ungrouped);
  }

  if (!displayItems.length) {
    const emptyMsg = selectedGroup
      ? '<div>该分组暂无文件</div><div style="font-size:13px;margin-top:4px">点击"上传"将文件加入此分组</div>'
      : isRoot
        ? `${ICONS.groups}<div>还没有分组或文件</div><div style="font-size:13px;margin-top:4px">点击"分组"创建分组，或直接"上传"文件</div>`
        : '<div>这个目录是空的</div><div style="font-size:13px;margin-top:4px">拖拽文件到此或点击"上传"</div>';
    content.innerHTML = `<div class="file-list"><div class="empty-state">${emptyMsg}</div></div>`;
    return;
  }
  content.innerHTML = `<div class="file-list">${displayItems.map(item => {
    if (item.is_group) {
      const cnt = item.file_count > 0 ? `${item.file_count} 个文件` : '空';
      return `
       <div class="file-row group-folder" data-gid="${escapeHtml(item.group_id)}" data-isgroup="true" data-name="${escapeHtml(item.name)}">
         <div class="file-icon folder">${ICONS.groups}</div>
         <div class="file-name">${escapeHtml(item.name)}</div>
         <span class="badge badge-group">${cnt}</span>
         <div class="file-meta"><span class="file-size">${formatSize(item.size)}</span></div>
         <div class="file-actions">
           <button class="icon-btn" onclick="event.stopPropagation();showGroupFolderMenu(event,'${escapeHtml(item.group_id)}','${escapeHtml(item.name)}')" title="更多">${ICONS.more}</button>
         </div>
       </div>`;
    }
    const icon = getFileIcon(item.name, item.is_dir);
    const groupHtml = (!selectedGroup && item.group_name) ? `<span class="badge badge-group">${escapeHtml(item.group_name)}</span>` : '';
    const guardHtml = item.guard_status === 'warning' ? '<span class="badge badge-warning">注意</span>' : item.guard_status === 'blocked' ? '<span class="badge badge-danger">敏感</span>' : '';
   return `
     <div class="file-row" data-path="${escapeHtml(item.path)}" data-isdir="${item.is_dir}" data-name="${escapeHtml(item.name)}">
       <div class="file-icon ${icon.cls}">${icon.icon}</div>
       <div class="file-name">${escapeHtml(item.name)}</div>
       ${groupHtml}${guardHtml}
       <div class="file-meta">
         <span class="file-size">${item.is_dir ? '-' : formatSize(item.size)}</span>
         <span class="file-date">${formatDate(item.modified)}</span>
       </div>
       <div class="file-actions">
         ${!item.is_dir ? `<button class="icon-btn" onclick="event.stopPropagation();previewFile('${escapeHtml(item.path)}','${escapeHtml(item.name)}')" title="预览">${ICONS.eye}</button>` : ''}
         ${!item.is_dir ? `<button class="icon-btn" onclick="event.stopPropagation();downloadFile('${escapeHtml(item.path)}')" title="下载">${ICONS.download}</button>` : ''}
         <button class="icon-btn danger" onclick="event.stopPropagation();deleteFile('${escapeHtml(item.path)}')" title="删除">${ICONS.trash}</button>
         <button class="icon-btn" onclick="event.stopPropagation();showFileMenu(event, '${escapeHtml(item.path)}', '${escapeHtml(item.name)}', ${item.is_dir})" title="更多">${ICONS.more}</button>
       </div>
     </div>`;
 }).join('')}</div>`;

 content.querySelectorAll('.file-row').forEach(row => {
   row.addEventListener('click', () => {
     if (row.dataset.isgroup === 'true') {
       selectedGroup = row.dataset.gid;
       currentDir = '';
       searchQuery = '';
       const si = document.getElementById('search-input');
       if (si) si.value = '';
       loadFiles();
     } else if (row.dataset.isdir === 'true') {
       currentDir = row.dataset.path;
       selectedGroup = '';
       searchQuery = '';
       const si = document.getElementById('search-input');
       if (si) si.value = '';
       loadFiles();
     } else {
       previewFile(row.dataset.path, row.dataset.name);
     }
   });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (row.dataset.isgroup === 'true') {
        showGroupFolderMenu(e.clientX, e.clientY, row.dataset.gid, row.dataset.name);
      } else {
        showFileMenu(e.clientX, e.clientY, row.dataset.path, row.dataset.name, row.dataset.isdir === 'true');
      }
    });
  });
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
    content.innerHTML = `<div class="file-list"><div class="empty-state">${ICONS.search}<div>没有找到匹配的文件</div></div></div>`;
    return;
  }
  content.innerHTML = `<div class="file-list">${results.map(r => {
    const icon = getFileIcon(r.name || r.path, false);
    const score = r.score ? Math.round(r.score * 100) : '';
   return `
     <div class="file-row" data-path="${escapeHtml(r.path)}" data-name="${escapeHtml(r.name || r.path)}">
       <div class="file-icon ${icon.cls}">${icon.icon}</div>
       <div class="file-name">${escapeHtml(r.name || r.path)}</div>
       <div class="file-meta">${score ? `<span>匹配 ${score}%</span>` : ''}</div>
       <div class="file-actions">
         <button class="icon-btn" onclick="event.stopPropagation();previewFile('${escapeHtml(r.path)}','${escapeHtml(r.name || r.path)}')" title="预览">${ICONS.eye}</button>
         <button class="icon-btn" onclick="event.stopPropagation();downloadFile('${escapeHtml(r.path)}')" title="下载">${ICONS.download}</button>
         <button class="icon-btn danger" onclick="event.stopPropagation();deleteFile('${escapeHtml(r.path)}')" title="删除">${ICONS.trash}</button>
       </div>
     </div>`;
 }).join('')}</div>`;
 content.querySelectorAll('.file-row').forEach(row => {
   row.addEventListener('click', () => previewFile(row.dataset.path, row.dataset.name));
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
    Toast.show('此文件类型不支持预览，请下载查看', 'info');
    downloadFile(path);
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
    if (!res.ok) { Toast.show('下载失败', 'error'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = path.split('/').pop(); a.click();
    URL.revokeObjectURL(url);
  } catch (err) { Toast.show('下载出错: ' + err.message, 'error'); }
}

async function deleteFile(path) {
  if (!confirm(`确定删除 "${path.split('/').pop()}"？`)) return;
  try {
    const res = await API.del(`/api/files?path=${encodeURIComponent(path)}`);
    if (res.ok) { Toast.show('已删除', 'success'); loadFiles(); }
    else { const data = await res.json(); Toast.show(data.detail || '删除失败', 'error'); }
  } catch (err) { Toast.show('删除出错: ' + err.message, 'error'); }
}

// ============ Chat ============
let chatMessages = [];
let chatSending = false;

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
  if (!chatMessages.length) {
    chatMessages.push({ role: 'assistant', content: '你好！我是你的文件助手。你可以问我：\n\n• "找一下上个月的报价"\n• "存了哪些学习资料"\n• "哪些文件很久没用了"\n• "存储用了多少空间"', tool_calls: [] });
  }
  renderChatMessages();
  document.getElementById('btn-send').addEventListener('click', sendChatMessage);
  document.getElementById('btn-clear-chat').addEventListener('click', async () => {
    if (!confirm('确定清空所有对话历史？')) return;
    await API.del('/api/chat/history');
    chatMessages = [];
    renderChat();
  });
  const input = document.getElementById('chat-input');
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; });
  input.focus();
}

function renderChatMessages() {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  container.innerHTML = chatMessages.map(msg => {
    const toolsHtml = (msg.tool_calls && msg.tool_calls.length)
      ? '<div class="chat-tools">' + msg.tool_calls.map(t => `<span class="chat-tool-badge">${t.tool}</span>`).join('') + '</div>' : '';
    return `<div class="chat-message ${msg.role}"><div class="chat-bubble">${escapeHtml(msg.content).replace(/\n/g, '<br>')}</div>${toolsHtml}</div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

async function sendChatMessage() {
  if (chatSending) return;
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  chatSending = true;
  chatMessages.push({ role: 'user', content: text, tool_calls: [] });
  input.value = ''; input.style.height = 'auto';
  renderChatMessages();
  const container = document.getElementById('chat-messages');
  const btn = document.getElementById('btn-send');
  btn.disabled = true;

  // 创建一条空的 assistant 消息，用于流式追加
  const assistantMsg = { role: 'assistant', content: '', tool_calls: [] };
  chatMessages.push(assistantMsg);
  const typingEl = document.createElement('div');
  typingEl.className = 'typing-indicator';
  typingEl.id = 'typing';
  typingEl.innerHTML = '正在思考<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>';
  container.appendChild(typingEl);
  container.scrollTop = container.scrollHeight;

  try {
    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(API._token ? { 'Authorization': `Bearer ${API._token}` } : {}),
      },
      body: JSON.stringify({ message: text }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.detail || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const typing = document.getElementById('typing');
    if (typing) typing.remove();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = JSON.parse(line.slice(6));
        if (payload.type === 'tool') {
          assistantMsg.tool_calls = assistantMsg.tool_calls || [];
          assistantMsg.tool_calls.push(payload.data);
          renderChatMessages();
        } else if (payload.type === 'delta') {
          assistantMsg.content += payload.data;
          renderChatMessages();
          const c = document.getElementById('chat-messages');
          if (c) c.scrollTop = c.scrollHeight;
        } else if (payload.type === 'done') {
          assistantMsg.content = payload.data.reply || assistantMsg.content || '(无回复)';
          assistantMsg.tool_calls = payload.data.tool_calls || assistantMsg.tool_calls;
          renderChatMessages();
        } else if (payload.type === 'error') {
          assistantMsg.content = '出错了: ' + payload.data;
          renderChatMessages();
        }
      }
    }
    if (!assistantMsg.content) assistantMsg.content = '(无回复)';
    renderChatMessages();
  } catch (err) {
    const typing = document.getElementById('typing');
    if (typing) typing.remove();
    assistantMsg.content = '出错了: ' + err.message;
    renderChatMessages();
  } finally { chatSending = false; btn.disabled = false; }
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
    const delBtn = `<button class="transfer-del" title="删除" onclick="deleteTransferMessage('${msg.id}')">${ICONS.trash}</button>`;
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
        <div class="transfer-file-card" onclick="previewTransferFile('${escapeHtml(f.path)}','${escapeHtml(f.name)}')">
          <div class="transfer-file-icon ${fi.cls}">${fi.icon}</div>
          <div class="transfer-file-info">
            <div class="transfer-file-name">${escapeHtml(f.name)}</div>
            <div class="transfer-file-meta">
              <span>${formatSize(f.size)}</span>
              <span class="transfer-saved">✓ 已存入文件库</span>
            </div>
          </div>
          <button class="transfer-file-dl" title="下载" onclick="event.stopPropagation();downloadFile('${escapeHtml(f.path)}')">${ICONS.download}</button>
        </div>
        <span class="transfer-time">${time}</span>
        ${guardBadge}
      </div>
      ${delBtn}
    </div>`;
  }).join('');
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
  if (!confirm('确定删除这条记录？')) return;
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
            <div class="setting-head-icon icon-purple">${ICONS.refresh}</div>
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
            <div class="setting-head-text"><h3>设备访问令牌</h3><p class="section-desc">管理设备访问权限，离职时吊销令牌即可切断访问。</p></div>
            <div class="setting-head-action"><button class="btn btn-primary" id="btn-create-token">${ICONS.upload}<span>创建令牌</span></button></div>
          </div>
          <div class="setting-body"><div class="token-list" id="tokens-content"></div></div>
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
      if (res.ok) { Toast.show('密码已修改', 'success'); document.getElementById('old-pass').value = ''; document.getElementById('new-pass').value = ''; }
      else { const d = await res.json(); Toast.show(d.detail || '修改失败', 'error'); }
    } catch { Toast.show('网络错误', 'error'); }
  });
  document.getElementById('btn-create-token').addEventListener('click', createToken);
  document.getElementById('btn-reindex').addEventListener('click', rebuildIndex);
  loadStats(); loadTokens(); loadTOTP(); loadAccountInfo();
}

async function loadAccountInfo() {
  const el = document.getElementById('account-info');
  if (!el) return;
  try {
    let me = App.currentUser;
    if (!me) {
      const res = await API.get('/api/auth/me');
      if (!res || !res.ok) { el.innerHTML = '<p class="setting-empty">加载失败</p>'; return; }
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
    el.innerHTML = '<p class="setting-empty">加载失败</p>';
  }
}

async function loadStats() {
  const el = document.getElementById('stats-content');
  try {
    const res = await API.get('/api/files/stats');
    const data = await res.json();
    el.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card" style="--stat-accent:var(--primary)"><div class="stat-label">文件总数</div><div class="stat-value">${data.total_files}</div></div>
        <div class="stat-card" style="--stat-accent:var(--success)"><div class="stat-label">占用空间</div><div class="stat-value">${data.total_size_mb}<span class="stat-unit"> MB</span></div></div>
        <div class="stat-card" style="--stat-accent:#a78bfa"><div class="stat-label">磁盘总量</div><div class="stat-value">${data.disk.total_gb}<span class="stat-unit"> GB</span></div></div>
        <div class="stat-card" style="--stat-accent:var(--warning)"><div class="stat-label">可用空间</div><div class="stat-value">${data.disk.free_gb}<span class="stat-unit"> GB</span></div></div>
      </div>
    `;
  } catch { el.innerHTML = '<p class="setting-empty">加载失败</p>'; }
}

async function loadTokens() {
  const el = document.getElementById('tokens-content');
  try {
    const res = await API.get('/api/auth/tokens');
    const tokens = await res.json();
    if (!tokens.length) { el.innerHTML = '<p class="setting-empty">暂无设备令牌，点击右上角"创建令牌"添加。</p>'; return; }
    el.innerHTML = tokens.map(t => `
      <div class="token-row">
        <div class="token-info">
          <div class="token-label">${escapeHtml(t.label)} ${t.revoked ? '<span class="badge badge-danger">已吊销</span>' : '<span class="badge badge-success">有效</span>'}</div>
          <div class="token-date">创建于 ${formatDate(t.created_at)}</div>
        </div>
        ${!t.revoked ? `<button class="btn btn-danger" onclick="revokeToken('${t.id}')">吊销</button>` : ''}
      </div>`).join('');
  } catch { el.innerHTML = '<p class="setting-empty">加载失败</p>'; }
}

async function createToken() {
  const label = prompt('令牌标签（如"公司电脑"）：', '公司电脑');
  if (!label) return;
  const days = parseInt(prompt('有效期天数（0=永久）：', '0') || '0');
  try {
    const res = await API.post(`/api/auth/tokens?label=${encodeURIComponent(label)}&expires_days=${days}`);
    const data = await res.json();
    prompt('设备令牌（请妥善保存，仅显示一次）：', data.token);
    Toast.show('令牌已创建', 'success');
    loadTokens();
  } catch { Toast.show('创建失败', 'error'); }
}

async function revokeToken(id) {
  if (!confirm('确定吊销此令牌？该设备将无法再访问。')) return;
  try { await API.del(`/api/auth/tokens/${id}`); Toast.show('令牌已吊销', 'success'); loadTokens(); }
  catch { Toast.show('操作失败', 'error'); }
}

async function loadTOTP() {
  const el = document.getElementById('totp-content');
  el.innerHTML = `<p class="setting-empty" style="margin-top:0">使用 Google Authenticator 等 App 扫码绑定，开启后登录需额外验证。</p><button class="btn btn-secondary" id="btn-setup-totp">设置双因子验证</button>`;
  document.getElementById('btn-setup-totp').addEventListener('click', setupTOTP);
}

async function setupTOTP() {
  try {
    const res = await API.get('/api/auth/totp/setup');
    const data = await res.json();
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <h3>设置双因子验证</h3>
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">用验证器 App 扫描以下二维码：</p>
        <div style="text-align:center;margin:16px 0"><img src="${data.qr_code}" style="width:200px;height:200px" alt="QR"></div>
        <p style="font-size:12px;color:var(--text-muted)">或手动输入: <code>${data.secret}</code></p>
        <div class="form-group" style="margin-top:16px">
          <label>输入验证器显示的 6 位代码</label>
          <input type="text" class="form-input" id="totp-verify-code" placeholder="000000" maxlength="6">
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
          <button class="btn btn-primary" id="btn-confirm-totp">确认绑定</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById('btn-confirm-totp').addEventListener('click', async () => {
      const code = document.getElementById('totp-verify-code').value;
      const res = await API.post(`/api/auth/totp/enable?secret=${data.secret}&code=${code}`);
      if (res.ok) { Toast.show('双因子验证已开启', 'success'); modal.remove(); }
      else { const d = await res.json(); Toast.show(d.detail || '验证码错误', 'error'); }
    });
  } catch { Toast.show('设置失败', 'error'); }
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
    if (!API._token) { renderLogin(); return; }
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
    document.addEventListener('click', closeContextMenu);
  },
  renderLayout() {
    document.getElementById('app').innerHTML = `
      <div class="app-layout">
        <div class="sidebar">
          <div class="sidebar-logo" id="sidebar-logo" title="${this.currentUser ? (this.currentUser.username + ' · 点击查看账户信息') : '随行档'}">${this.currentUser ? this.currentUser.username.charAt(0).toUpperCase() : '档'}</div>
          <button class="nav-btn active" data-view="transfer" title="传输助手">${ICONS.transfer}</button>
          <button class="nav-btn" data-view="chat" title="AI助手">${ICONS.chat}</button>
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
    this.currentView = view;
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
    if (view === 'files') renderFiles();
    else if (view === 'chat') renderChat();
    else if (view === 'transfer') renderTransfer();
    else if (view === 'settings') renderSettings();
  },
  logout() { API.clearTokens(); this.currentView = 'transfer'; renderLogin(); }
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

App.init();
