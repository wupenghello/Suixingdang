// 初始化 Mermaid 图表库（延迟到首次渲染时自动启动）
if (window.mermaid) {
  window.mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' });
}

// 随行档 - 前端 SPA

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
      } else {
        App.logout();  // refresh 也失效：清 cookie 并回落地页（同步渲染）
        return res;    // 返回 401（非 undefined），调用方 res.ok 检查不致 TypeError
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
  note: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
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
  edit: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 5h2v2H3zm0 4h2v2H3zm0 4h2v2H3zm0 4h2v2H3zm4-12h14v2H7zm0 4h14v2H7zm0 4h14v2H7zm0 4h14v2H7z"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 9V4l1-1V2H7v1l1 1v5l-2 2v2h5v6l1 1 1-1v-6h5v-2z"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/></svg>',
  ai: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2zm6 12l.9 2.7L21.6 18l-2.7.9L18 21.6l-.9-2.7L14.4 18l2.7-.9L18 14zM5 14l.7 2.1L8 17l-2.3.9L5 20l-.7-2.1L2 17l2.3-.9L5 14z"/></svg>',
  split: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>',
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
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  tbBold: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>',
  tbItalic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>',
  tbStrike: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/></svg>',
  tbH1: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17 12l3-2v8"/></svg>',
  tbH2: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/></svg>',
  tbH3: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"/><path d="M9 18h12"/></svg>',
  tbUL: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.2" fill="currentColor" stroke="none"/></svg>',
  tbOL: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 16H4v-1l2-1H4"/></svg>',
  tbQuote: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 5-2 5-5V9H3v5h3"/><path d="M13 21c3 0 5-2 5-5V9h-5v5h3"/></svg>',
  tbCode: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  tbLink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  tbHr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12"/><circle cx="4" cy="12" r="0.8" fill="currentColor" stroke="none"/><circle cx="20" cy="12" r="0.8" fill="currentColor" stroke="none"/></svg>',
  tbTable: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>',
  tbTask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"/><path d="M3.5 7l2 2 3.5-3.5" stroke-width="2.5"/><rect x="3" y="13" width="8" height="8" rx="1"/><line x1="15" y1="5" x2="21" y2="5"/><line x1="15" y1="11" x2="21" y2="11"/><line x1="15" y1="17" x2="21" y2="17"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  fullscreen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  fullscreenExit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>',
  export: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  toc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>',
 math: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h4M4 6V4m0 2v2M14 6l2-2m-2 2l2 2m-2-2h6"/><path d="M4 14h4l-4 6h4M14 14l3 6m3-6l-3 6"/></svg>',
 keyboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h0M10 10h0M14 10h0M18 10h0M8 14h8"/></svg>',
};

// 文件页控件图标
const SORT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="13" y2="7"/><line x1="4" y1="12" x2="11" y2="12"/><line x1="4" y1="17" x2="9" y2="17"/><polyline points="15,14 18,17 21,14"/></svg>';
const GRID_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z"/></svg>';
const LIST_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20,6 9,17 4,12"/></svg>';
const SELECT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><polyline points="8.5,12 11,14.5 15.5,9.5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const ICON_CHEVRON_LEFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';

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
  if (!ms) return escapeHtml(ts ? String(ts) : '');
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
  const div = document.createElement('div');
  div.innerHTML = html;
  _enhanceMarkdownDom(div);
  return div.innerHTML;
}

// 对已渲染的 markdown DOM 做增强：代码高亮、标题锚点、外链新窗口、任务列表可读性
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

// 渲染笔记 markdown 并提取目录（TOC），返回 { html, toc }
function renderNoteMarkdown(text) {
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

function _preprocessWikilinks(text) {
  // 将 [[note name]] 或 [[note name|alias]] 转换为带 data-wikilink 属性的 span
  // marked 解析后再处理，避免被 marked 当作普通文本处理
  return text;
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
    </div>
    <div class="files-body">
      <div id="batch-bar" class="batch-bar" style="display:none"></div>
      <div class="breadcrumb" id="breadcrumb"></div>
      <div id="file-content"></div>
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
    <input type="text" class="form-input note-title-input" placeholder="笔记标题（可选，默认「未命名笔记」）" maxlength="80" value="${escapeHtml(editName.replace(/\.(md|markdown|mdown|mkd)$/i, ''))}">
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
    const minutes = Math.max(1, Math.round(words / 300));
    if (nsbWords) nsbWords.textContent = words + ' 字';
    if (nsbChars) nsbChars.textContent = chars + ' 字符';
    if (nsbReading) nsbReading.textContent = '约 ' + minutes + ' 分钟';
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
body{max-width:760px;margin:40px auto;padding:0 20px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Segoe UI',system-ui,sans-serif;line-height:1.8;color:#1a1a2e;font-size:16px}
h1{font-size:2em;border-bottom:2px solid #eee;padding-bottom:.3em}
h2{font-size:1.5em;border-bottom:1px solid #eee;padding-bottom:.3em}
h3{font-size:1.25em}
pre{background:#f6f8fa;padding:14px;border-radius:6px;overflow-x:auto}
code{font-family:ui-monospace,SF Mono,monospace}
p code,li code{background:#f6f8fa;padding:2px 6px;border-radius:3px;font-size:.9em}
blockquote{border-left:4px solid #2B5FFF;margin:0;padding:8px 16px;background:#f8f9ff;border-radius:0 6px 6px 0}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #ddd;padding:8px 12px}
th{background:#f6f8fa}
img{max-width:100%;border-radius:6px}
a{color:#2B5FFF}
hr{border:none;border-top:1px solid #eee;margin:24px 0}
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
      if (data.summary) { summaryRow.style.display = ''; summaryText.textContent = data.summary; }
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
      titleEl.value = (data.name || editName).replace(/\.(md|markdown|mdown|mkd)$/i, '');
      noteTags = data.tags || [];
      notePinned = !!data.pinned;
      if (notePinned) pinBtn.classList.add('is-active');
      if (data.summary) { summaryRow.style.display = ''; summaryText.textContent = data.summary; }
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
          <span class="backlink-name">${ICONS.note}${escapeHtml(bl.name.replace(/\.(md|markdown|mdown|mkd)$/i, ''))}</span>
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
  let debounceTimer = null;

  function closePalette() {
    _cmdPaletteOpen = false;
    overlay.remove();
    document.body.style.overflow = '';
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
      const detail = r.snippet || r.detail || '';
      return `<div class="cmd-item${i === selectedIdx ? ' is-selected' : ''}" data-idx="${i}">
        <span class="cmd-item-icon">${displayIcon}</span>
        <span class="cmd-item-info">
          <span class="cmd-item-name">${escapeHtml(displayName)}</span>
          ${detail ? `<span class="cmd-item-detail">${escapeHtml(detail)}</span>` : ''}
        </span>
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
    if (!q.trim()) { results = getQuickActions(); selectedIdx = 0; renderResults(); return; }
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
        ? `${ICONS.groups}<div class="empty-title">还没有分组或文件</div><div class="empty-desc">点击分组图标创建分组，或直接「上传」文件</div>`
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
  const pinHtml = item.pinned ? '<span class="badge badge-pin" title="已置顶">★</span>' : '';
  const tagsHtml = (item.tags && item.tags.length) ? item.tags.slice(0, 3).map(t => `<span class="badge badge-tag">#${escapeHtml(t)}</span>`).join('') + (item.tags.length > 3 ? `<span class="badge badge-tag">+${item.tags.length - 3}</span>` : '') : '';
  const isNote = /\.(md|markdown|mdown|mkd)$/i.test(item.name);
  const checkHtml = (fileSelectMode && !item.is_dir) ? `<div class="file-check ${isSel ? 'is-checked' : ''}" data-action="toggle-select">${isSel ? CHECK_ICON : ''}</div>` : '';
  const selCls = isSel ? ' is-selected' : '';
  if (fileView === 'grid') {
    return `<div class="file-card${selCls}${item.pinned ? ' is-pinned' : ''}" data-path="${escapeHtml(item.path)}" data-isdir="${item.is_dir}" data-name="${escapeHtml(item.name)}" data-pinned="${item.pinned ? 'true' : 'false'}">
      ${checkHtml}
      ${pinHtml ? `<span class="file-card-pin">${ICONS.pin}</span>` : ''}
      <div class="file-icon ${icon.cls}">${icon.icon}</div>
      <div class="file-name">${escapeHtml(item.name)}</div>
      <div class="file-card-meta"><span>${item.is_dir ? '文件夹' : formatSize(item.size)}</span>${tagsHtml}</div>
    </div>`;
  }
  return `<div class="file-row${selCls}${item.pinned ? ' is-pinned' : ''}" data-path="${escapeHtml(item.path)}" data-isdir="${item.is_dir}" data-name="${escapeHtml(item.name)}" data-pinned="${item.pinned ? 'true' : 'false'}">
    <div class="file-cell file-cell--name">
      ${checkHtml}
      <span class="file-icon ${icon.cls}">${icon.icon}</span>
      <span class="file-name">${escapeHtml(item.name)}</span>
      ${pinHtml}${groupHtml}${guardHtml}${tagsHtml}
    </div>
    <div class="file-cell file-cell--size">${item.is_dir ? '-' : formatSize(item.size)}</div>
    <div class="file-cell file-cell--date">${item.modified ? formatDate(item.modified) : '-'}</div>
    <div class="file-cell file-cell--actions file-actions">
      ${isNote ? `<button class="icon-btn" data-action="edit" title="编辑">${ICONS.edit}</button>` : ''}
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
    content.innerHTML = `<div class="file-table"><div class="empty-state">${ICONS.search}<div class="empty-title">没有找到匹配的文件</div></div></div>`;
    return;
  }
  function highlightSnippet(text, q) {
    if (!text) return '';
    const escaped = escapeHtml(text);
    const ql = escapeHtml(q);
    const re = new RegExp('(' + ql.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return '<mark class="search-hit">' + escaped.replace(re, '</mark>$1<mark class="search-hit">').replace(/<\/mark>(<mark class="search-hit">)/g, '$1') + '</mark>';
  }
  content.innerHTML = `<div class="file-table">
    <div class="file-table-head">
      <span class="file-cell file-cell--name">搜索结果 · ${results.length} 项</span>
      <span class="file-cell file-cell--size">大小</span>
      <span class="file-cell file-cell--date">匹配</span>
      <span class="file-cell file-cell--actions"></span>
   </div>${results.map(r => {
     const icon = getFileIcon(r.name || r.path, false);
      const score = r.score ? Math.round(r.score * 100) + '%' : '-';
      const hasSnippet = r.snippet && r.snippet.trim();
      return `<div class="file-row${hasSnippet ? ' file-row--snippet' : ''}" data-path="${escapeHtml(r.path)}" data-name="${escapeHtml(r.name || r.path)}" data-file-id="${escapeHtml(r.file_id || '')}">
        <div class="file-cell file-cell--name">
          <span class="file-icon ${icon.cls}">${icon.icon}</span>
          <div class="file-name-info">
            <span class="file-name">${escapeHtml(r.name || r.path)}</span>
            ${hasSnippet ? `<span class="file-snippet">${highlightSnippet(r.snippet, searchQuery)}</span>` : ''}
          </div>
        </div>
        <div class="file-cell file-cell--size">${formatSize(r.size)}</div>
        <div class="file-cell file-cell--date">${score}</div>
        <div class="file-cell file-cell--actions file-actions">
          ${/\.(md|markdown|mdown|mkd)$/i.test(r.name || r.path) ? `<button class="icon-btn" data-action="edit" title="编辑">${ICONS.edit}</button>` : ''}
          <button class="icon-btn" data-action="preview" title="预览">${ICONS.eye}</button>
          <button class="icon-btn" data-action="download" title="下载">${ICONS.download}</button>
          <button class="icon-btn danger" data-action="delete" title="删除">${ICONS.trash}</button>
          <button class="icon-btn" data-action="menu" title="更多">${ICONS.more}</button>
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
       const fid = row.dataset.fileId || '';
       if (a === 'preview') previewFile(path, name);
       else if (a === 'edit') openNoteEditor({ path, name, fileId: fid });
       else if (a === 'menu') showFileMenu(e, path, name, false);
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
  if (!await confirmDialog({ title: '删除文件', message: `确定删除 "${path.split('/').pop()}"？删除后无法恢复。`, confirmText: '删除', danger: true })) return;
  try {
    const res = await API.del(`/api/files?path=${encodeURIComponent(path)}`);
    if (res.ok) { Toast.show('已删除', 'success'); loadFiles(); }
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
      <div class="chat-messages transfer-messages" id="transfer-messages">${transferLoadingHTML()}</div>
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
  const delBtn = `<button class="transfer-del" title="删除" data-action="delete-msg" data-id="${escapeHtml(msg.id)}">${ICONS.trash}</button>`;
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
function transferMsgSignature(msg) {
  if (msg.type === 'text') return `t|${msg.id}|${msg._status || ''}`;
  const f = msg.file || {};
  return `f|${msg.id}|${msg.type}|${f.guard_status || ''}|${f.name || ''}|${f.size || ''}`;
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
  return node;
}

// 原地修补已存在的节点：签名未变则跳过（媒体不重建、不重新解码）；变了才重排内层
// （乐观→确认变形时 id 变化 → 签名变 → 重建，按钮上的 data-id 一并更新为真实 id）
function patchTransferNode(node, msg) {
  const sig = transferMsgSignature(msg);
  if (node.dataset.sig === sig) return;
  node.dataset.sig = sig;
  node.innerHTML = transferMessageInnerHTML(msg);
  enhanceMaskedContent(node);
}

// 增量协调：按 key 对账，保留未变节点（媒体不重解码），只动真正变化的条目
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
    return;  // 空列表不算首屏填充：保持 hydrated=false，待真正出现内容时首屏仍不动画并直接吸底
  }
  const firstPaint = !transferHydrated;  // 进视图首次填充：直接吸底 + 跳过进场动画
  // 一遍扫完：清掉占位（loading / empty），同时收集可复用的 .transfer-msg（跳过无 key / 离场中的）
  const existing = new Map();
  Array.from(container.children).forEach(child => {
    if (!child.classList || !child.classList.contains('transfer-msg')) child.remove();
    else {
      const k = child.dataset && child.dataset.key;
      if (k && !child.dataset.leaving) existing.set(k, child);
    }
  });
  // 按 transferMessages 顺序对账：命中即修补/正位，未命中即新建（仅非首屏才播进场）
  let ref = container.firstChild;
  const skipDead = () => { while (ref && (!ref.dataset || !ref.dataset.key || ref.dataset.leaving)) ref = ref.nextSibling; };
  for (const msg of transferMessages) {
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
    node.classList.add('is-leaving');
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
    if (!res.ok) { const d = await res.json().catch(() => ({})); _markTransferFailed(tempId, d.detail || '发送失败'); return; }
    const msg = await res.json();
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

async function deleteTransferMessage(id) {
  if (!await confirmDialog({ title: '删除记录', message: '确定删除这条记录？', confirmText: '删除', danger: true })) return;
  // 尚未落库的乐观/失败消息（_status 非空）：仅本地移除，不调删除接口
  const local = transferMessages.find(m => m.id === id);
  if (local && local._status) {
    transferMessages = transferMessages.filter(m => m.id !== id);
    renderTransferMessages();
    return;
  }
  try {
    const res = await API.del(`/api/transfer/${id}`);
    if (res.ok) {
      transferMessages = transferMessages.filter(m => m.id !== id);
      renderTransferMessages();
      Toast.show('已删除', 'success');
    } else { const d = await res.json(); Toast.show(d.detail || '删除失败', 'error'); }
  } catch (err) { Toast.show('删除出错: ' + err.message, 'error'); }
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
    // 登录态由 cookie 决定：探测 /me，200 即已登录；失败（含静默刷新失败）回落地页
    try {
      const res = await API.get('/api/auth/me');
      if (!res || !res.ok) return;  // refresh 失败时 App.logout 已渲染落地页
      this.currentUser = await res.json();
    } catch {
      renderLanding(); return;
    }
  this.renderLayout();
  this.navigate('transfer');
  setupDragDrop();
  setupPaste();
  setupGlobalShortcuts();
  document.addEventListener('click', closeContextMenu);
   checkDownloadStatus();
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
    else if (view === 'chat') renderChat();
    else if (view === 'transfer') renderTransfer();
    else if (view === 'settings') renderSettings(opts.tab);
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
    renderLanding();
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
