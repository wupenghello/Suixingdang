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
  files: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>',
  rename: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5-5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>',
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
function getFileIcon(name, isDir) {
  if (isDir) return { cls: 'folder', icon: ICONS.folder };
  const ext = name.split('.').pop().toLowerCase();
  if (['js','ts','py','java','go','rs','c','cpp','h','sh','rb','php'].includes(ext)) return { cls: 'code', icon: ICONS.fileCode };
  if (['md','txt','pdf','doc','docx','rst'].includes(ext)) return { cls: 'doc', icon: ICONS.fileText };
  if (['png','jpg','jpeg','gif','svg','webp'].includes(ext)) return { cls: 'image', icon: ICONS.fileImage };
  if (['mp4','avi','mov','mkv','webm'].includes(ext)) return { cls: 'video', icon: ICONS.fileVideo };
  return { cls: 'other', icon: ICONS.file };
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
        overlay.innerHTML = `<div class="upload-overlay-box">${ICONS.upload}<p>松开以上传文件到当前目录</p></div>`;
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
      handleFilesUpload(e.dataTransfer.files);
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

async function renderFiles() {
  document.getElementById('main-content').innerHTML = `
    <div class="topbar">
      <div class="topbar-title">文件</div>
      <div class="topbar-spacer"></div>
      <button class="btn btn-secondary btn-icon-only" id="btn-refresh" title="刷新">${ICONS.refresh}</button>
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
  document.getElementById('btn-upload').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('file-input').addEventListener('change', (e) => { if (e.target.files.length) handleFilesUpload(e.target.files); e.target.value = ''; });

  const searchInput = document.getElementById('search-input');
  let debounceTimer;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { searchQuery = e.target.value; loadFiles(); }, 300);
  });
  loadFiles();
}

function renderBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  if (!bc) return;
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
  if (!items.length) {
    content.innerHTML = `<div class="file-list"><div class="empty-state">${ICONS.folder}<div>这个目录是空的</div><div style="font-size:13px;margin-top:4px">拖拽文件到此或点击"上传"</div></div></div>`;
    return;
  }
  content.innerHTML = `<div class="file-list">${items.map(item => {
    const icon = getFileIcon(item.name, item.is_dir);
    const tagHtml = item.tag ? `<span class="file-tag tag-${item.tag}">${item.tag}</span>` : '';
    const guardHtml = item.guard_status === 'warning' ? '<span class="badge badge-warning">注意</span>' : item.guard_status === 'blocked' ? '<span class="badge badge-danger">敏感</span>' : '';
    return `
      <div class="file-row" data-path="${escapeHtml(item.path)}" data-isdir="${item.is_dir}" data-name="${escapeHtml(item.name)}">
        <div class="file-icon ${icon.cls}">${icon.icon}</div>
        <div class="file-name">${escapeHtml(item.name)}</div>
        ${tagHtml}${guardHtml}
        <div class="file-meta">
          <span class="file-size">${item.is_dir ? '-' : formatSize(item.size)}</span>
          <span class="file-date">${formatDate(item.modified)}</span>
        </div>
        <div class="file-actions">
          ${!item.is_dir ? `<button class="icon-btn" onclick="event.stopPropagation();downloadFile('${escapeHtml(item.path)}')" title="下载">${ICONS.download}</button>` : ''}
          <button class="icon-btn danger" onclick="event.stopPropagation();deleteFile('${escapeHtml(item.path)}')" title="删除">${ICONS.trash}</button>
          <button class="icon-btn" onclick="event.stopPropagation();showFileMenu(event, '${escapeHtml(item.path)}', '${escapeHtml(item.name)}', ${item.is_dir})" title="更多">${ICONS.more}</button>
        </div>
      </div>`;
  }).join('')}</div>`;

  content.querySelectorAll('.file-row').forEach(row => {
    row.addEventListener('click', () => {
      if (row.dataset.isdir === 'true') {
        currentDir = row.dataset.path;
        searchQuery = '';
        const si = document.getElementById('search-input');
        if (si) si.value = '';
        loadFiles();
      } else {
        downloadFile(row.dataset.path);
      }
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showFileMenu(e.clientX, e.clientY, row.dataset.path, row.dataset.name, row.dataset.isdir === 'true');
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
    items.push({ action: 'download', label: '下载', icon: ICONS.download, onClick: () => downloadFile(path) });
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
      <div class="file-row" data-path="${escapeHtml(r.path)}">
        <div class="file-icon ${icon.cls}">${icon.icon}</div>
        <div class="file-name">${escapeHtml(r.name || r.path)}</div>
        ${r.tag ? `<span class="file-tag tag-${r.tag}">${r.tag}</span>` : ''}
        <div class="file-meta">${score ? `<span>匹配 ${score}%</span>` : ''}</div>
        <div class="file-actions">
          <button class="icon-btn" onclick="event.stopPropagation();downloadFile('${escapeHtml(r.path)}')" title="下载">${ICONS.download}</button>
          <button class="icon-btn danger" onclick="event.stopPropagation();deleteFile('${escapeHtml(r.path)}')" title="删除">${ICONS.trash}</button>
        </div>
      </div>`;
  }).join('')}</div>`;
  content.querySelectorAll('.file-row').forEach(row => {
    row.addEventListener('click', () => downloadFile(row.dataset.path));
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
      xhr.open('POST', `/api/files/upload?directory=${encodeURIComponent(currentDir)}&source=manual`);
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
  const typingEl = document.createElement('div');
  typingEl.className = 'typing-indicator';
  typingEl.id = 'typing';
  typingEl.innerHTML = '正在思考<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>';
  container.appendChild(typingEl);
  container.scrollTop = container.scrollHeight;
  const btn = document.getElementById('btn-send');
  btn.disabled = true;
  try {
    const res = await API.post('/api/chat', { message: text });
    const data = await res.json();
    const typing = document.getElementById('typing');
    if (typing) typing.remove();
    chatMessages.push({ role: 'assistant', content: data.reply || '(无回复)', tool_calls: data.tool_calls || [] });
    renderChatMessages();
  } catch (err) {
    const typing = document.getElementById('typing');
    if (typing) typing.remove();
    chatMessages.push({ role: 'assistant', content: '出错了: ' + err.message, tool_calls: [] });
    renderChatMessages();
  } finally { chatSending = false; btn.disabled = false; }
}

// ============ Settings ============
async function renderSettings() {
  document.getElementById('main-content').innerHTML = `
    <div class="topbar"><div class="topbar-title">设置</div></div>
    <div class="settings-container">
      <div class="settings-section">
        <h3>存储统计</h3>
        <p class="section-desc">查看文件存储使用情况</p>
        <div id="stats-content">加载中...</div>
      </div>
      <div class="settings-section">
        <h3>设备访问令牌</h3>
        <p class="section-desc">管理设备访问权限。离职时吊销"公司电脑"令牌即可切断访问。</p>
        <button class="btn btn-primary" id="btn-create-token">${ICONS.upload}<span>创建令牌</span></button>
        <div class="token-list" id="tokens-content"></div>
      </div>
      <div class="settings-section">
        <h3>双因子验证</h3>
        <p class="section-desc">增强安全性。公司电脑建议开启。</p>
        <div id="totp-content">加载中...</div>
      </div>
      <div class="settings-section">
        <h3>全文索引</h3>
        <p class="section-desc">重建文件索引以支持语义搜索</p>
        <button class="btn btn-secondary" id="btn-reindex">重建索引</button>
      </div>
      <div class="settings-section">
        <h3>个人设置</h3>
        <p class="section-desc">修改密码</p>
        <div class="form-group" style="margin-bottom:8px"><label>原密码</label><input type="password" id="old-pass" class="form-input" style="max-width:300px"></div>
        <div class="form-group" style="margin-bottom:8px"><label>新密码</label><input type="password" id="new-pass" class="form-input" style="max-width:300px"></div>
        <button class="btn btn-primary" id="btn-change-pwd">修改密码</button>
      </div>

      <div class="settings-section">
        <h3>退出登录</h3>
        <button class="btn btn-danger" id="btn-logout">退出</button>
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
  loadStats(); loadTokens(); loadTOTP();
}

async function loadStats() {
  const el = document.getElementById('stats-content');
  try {
    const res = await API.get('/api/files/stats');
    const data = await res.json();
    el.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">文件总数</div><div class="stat-value">${data.total_files}</div></div>
        <div class="stat-card"><div class="stat-label">占用空间</div><div class="stat-value">${data.total_size_mb}<span class="stat-unit"> MB</span></div></div>
        <div class="stat-card"><div class="stat-label">磁盘总量</div><div class="stat-value">${data.disk.total_gb}<span class="stat-unit"> GB</span></div></div>
        <div class="stat-card"><div class="stat-label">可用空间</div><div class="stat-value">${data.disk.free_gb}<span class="stat-unit"> GB</span></div></div>
      </div>
      ${Object.keys(data.by_tag).length ? `<div style="margin-top:16px"><div style="font-size:13px;color:var(--text-muted);margin-bottom:8px">分类分布</div>${Object.entries(data.by_tag).map(([tag, count]) => `<span class="file-tag tag-${tag}">${tag}: ${count}</span>`).join('')}</div>` : ''}
    `;
  } catch { el.innerHTML = '<p>加载失败</p>'; }
}

async function loadTokens() {
  const el = document.getElementById('tokens-content');
  try {
    const res = await API.get('/api/auth/tokens');
    const tokens = await res.json();
    if (!tokens.length) { el.innerHTML = '<p style="color:var(--text-muted);font-size:13px;margin-top:12px">暂无设备令牌</p>'; return; }
    el.innerHTML = tokens.map(t => `
      <div class="token-row">
        <div>
          <strong>${escapeHtml(t.label)}</strong>
          ${t.revoked ? '<span class="badge badge-danger">已吊销</span>' : '<span class="badge badge-success">有效</span>'}
          <div style="font-size:12px;color:var(--text-muted)">创建于 ${formatDate(t.created_at)}</div>
        </div>
        ${!t.revoked ? `<button class="btn btn-danger" onclick="revokeToken('${t.id}')">吊销</button>` : ''}
      </div>`).join('');
  } catch { el.innerHTML = '<p>加载失败</p>'; }
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
  el.innerHTML = `<p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">使用 Google Authenticator 等 App 扫码绑定。</p><button class="btn btn-secondary" id="btn-setup-totp">设置双因子验证</button>`;
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
  currentView: 'files',
  init() {
    if (!API._token) { renderLogin(); return; }
    this.renderLayout();
    this.navigate('files');
    setupDragDrop();
    document.addEventListener('click', closeContextMenu);
  },
  renderLayout() {
    document.getElementById('app').innerHTML = `
      <div class="app-layout">
        <div class="sidebar">
          <div class="sidebar-logo">档</div>
          <button class="nav-btn active" data-view="files" title="文件">${ICONS.files}</button>
          <button class="nav-btn" data-view="chat" title="AI助手">${ICONS.chat}</button>
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
  },
  navigate(view) {
    this.currentView = view;
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
    if (view === 'files') renderFiles();
    else if (view === 'chat') renderChat();
    else if (view === 'settings') renderSettings();
  },
  logout() { API.clearTokens(); this.currentView = 'files'; renderLogin(); }
};

// Expose for inline handlers
window.downloadFile = downloadFile;
window.deleteFile = deleteFile;
window.revokeToken = revokeToken;
window.showFileMenu = showFileMenu;
window.UploadManager = UploadManager;

App.init();
