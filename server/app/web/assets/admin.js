// 随行档 - 管理员后台 SPA (v3)

const API = {
  _token: localStorage.getItem('admin_token'),
  set(token) { this._token = token; localStorage.setItem('admin_token', token); },
  clear() { this._token = null; localStorage.removeItem('admin_token'); },
  async req(url, opts = {}) {
    const headers = { ...opts.headers };
    if (this._token) headers['Authorization'] = `Bearer ${this._token}`;
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(url, { ...opts, headers });
  },
  get(u) { return this.req(u); },
  post(u, b) { return this.req(u, { method: 'POST', body: JSON.stringify(b) }); },
  put(u, b) { return this.req(u, { method: 'PUT', body: JSON.stringify(b) }); },
  del(u) { return this.req(u, { method: 'DELETE' }); },
};

const ACTION_LABELS = {
  login_success: '登录成功',
  login_failed: '登录失败',
  login_blocked: '登录被拒（账号禁用）',
  login_totp_failed: '二次验证失败',
  register: '注册账号',
  password_reset_success: '重置密码成功',
  password_reset_failed: '重置密码失败',
  admin_login_success: '管理员登录',
  admin_login_failed: '管理员登录失败',
  admin_create_user: '创建用户',
  admin_update_user: '修改用户',
  admin_delete_user: '删除用户',
  admin_update_settings: '修改系统设置',
};
function actionLabel(a) { return ACTION_LABELS[a] || a; }

const Toast = {
  show(msg, type = 'info', dur = 3000) {
    let c = document.getElementById('toasts');
    if (!c) { c = document.createElement('div'); c.id = 'toasts'; c.className = 'toast-container'; document.body.appendChild(c); }
    const el = document.createElement('div');
    el.className = `toast ${type}`; el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 200); }, dur);
  }
};

const ICONS = {
  dashboard: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>',
  log: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>',
  add: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>',
};

let currentView = 'dashboard';

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

// ============ Login ============
function renderLogin() {
  document.getElementById('admin-app').innerHTML = `
    <div class="login-container">
      <div class="login-card">
        <div class="login-logo">管</div>
        <h1>管理后台</h1>
        <p class="subtitle">随行档 · 系统管理</p>
        <form id="admin-login-form">
          <div class="form-group"><label>管理员用户名</label><input type="text" id="login-user" class="form-input" autofocus></div>
          <div class="form-group"><label>密码</label><input type="password" id="login-pass" class="form-input"></div>
          <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;padding:10px">登录</button>
        </form>
      </div>
    </div>`;
  document.getElementById('admin-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = document.getElementById('login-user').value;
    const p = document.getElementById('login-pass').value;
    try {
      const res = await fetch('/api/auth/admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p }),
      });
      const data = await res.json();
      if (res.ok) { API.set(data.access_token); Toast.show('登录成功', 'success'); init(); }
      else { Toast.show(data.detail || '登录失败', 'error'); }
    } catch { Toast.show('网络错误', 'error'); }
  });
}

// ============ Layout ============
function renderLayout() {
  document.getElementById('admin-app').innerHTML = `
    <div class="admin-layout">
      <div class="admin-sidebar">
        <div class="admin-logo">
          <div class="admin-logo-icon">管</div>
          <div class="admin-logo-text">管理后台</div>
        </div>
        <div class="admin-nav">
          <div class="admin-nav-item active" data-view="dashboard">${ICONS.dashboard} 系统概览</div>
          <div class="admin-nav-item" data-view="users">${ICONS.users} 用户管理</div>
          <div class="admin-nav-item" data-view="files">${ICONS.file} 全局文件</div>
          <div class="admin-nav-item" data-view="settings">${ICONS.settings} 系统设置</div>
          <div class="admin-nav-item" data-view="logs">${ICONS.log} 审计日志</div>
        </div>
        <div style="padding:12px">
          <div class="admin-nav-item" id="btn-logout">${ICONS.logout} 退出登录</div>
        </div>
      </div>
      <div class="admin-main" id="admin-main"></div>
    </div>`;
  document.querySelectorAll('.admin-nav-item[data-view]').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.view));
  });
  document.getElementById('btn-logout').addEventListener('click', () => { API.clear(); location.reload(); });
}

function navigate(view) {
  currentView = view;
  document.querySelectorAll('.admin-nav-item[data-view]').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  if (view === 'dashboard') renderDashboard();
  else if (view === 'users') renderUsers();
  else if (view === 'files') renderFiles();
  else if (view === 'settings') renderSettings();
  else if (view === 'logs') renderLogs();
}

// ============ Dashboard ============
async function renderDashboard() {
  document.getElementById('admin-main').innerHTML = `
    <div class="admin-topbar"><h2>系统概览</h2></div>
    <div id="dash-content">加载中...</div>`;
  try {
    const res = await API.get('/api/admin/stats');
    const d = await res.json();
    document.getElementById('dash-content').innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">用户总数</div><div class="stat-value">${d.total_users}</div></div>
        <div class="stat-card"><div class="stat-label">活跃用户</div><div class="stat-value">${d.active_users}</div></div>
        <div class="stat-card"><div class="stat-label">近7天活跃</div><div class="stat-value">${d.recent_active}</div></div>
        <div class="stat-card"><div class="stat-label">已禁用</div><div class="stat-value">${d.disabled_users}</div></div>
        <div class="stat-card"><div class="stat-label">文件总数</div><div class="stat-value">${d.total_files}</div></div>
        <div class="stat-card"><div class="stat-label">存储用量</div><div class="stat-value">${d.total_size_mb}<span class="stat-unit"> MB</span></div></div>
        <div class="stat-card"><div class="stat-label">磁盘总量</div><div class="stat-value">${d.disk.total_gb}<span class="stat-unit"> GB</span></div></div>
        <div class="stat-card"><div class="stat-label">可用空间</div><div class="stat-value">${d.disk.free_gb}<span class="stat-unit"> GB</span></div></div>
      </div>
      <h3 style="margin:24px 0 12px;font-size:15px">用户存储排行</h3>
      <table class="data-table">
        <thead><tr><th>用户</th><th>状态</th><th>文件数</th><th>已用空间</th><th>最近登录</th></tr></thead>
        <tbody>
          ${d.user_stats.map(u => `<tr>
            <td><strong>${esc(u.username)}</strong></td>
            <td>${u.status === 'active' ? '<span class="badge badge-success">正常</span>' : '<span class="badge badge-danger">已禁用</span>'}</td>
            <td>${u.file_count}</td>
            <td>${u.used_mb} MB</td>
            <td style="font-size:12px;color:var(--text-muted)">${u.last_login || '-'}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch { document.getElementById('dash-content').innerHTML = '<p>加载失败，请检查权限</p>'; }
}

// ============ Users ============
async function renderUsers() {
  document.getElementById('admin-main').innerHTML = `
    <div class="admin-topbar">
      <h2>用户管理</h2>
      <div class="admin-spacer"></div>
      <div class="search-box">${ICONS.search}<input type="text" id="user-search" placeholder="搜索用户名..." style="background:transparent;border:none;outline:none;color:var(--text);font-size:13px;width:140px"></div>
      <button class="btn btn-primary" id="btn-add-user">${ICONS.add} 添加用户</button>
    </div>
    <div id="users-content">加载中...</div>`;
  document.getElementById('btn-add-user').addEventListener('click', () => showUserModal());
  let st;
  document.getElementById('user-search').addEventListener('input', (e) => {
    clearTimeout(st); st = setTimeout(() => loadUsers(e.target.value), 300);
  });
  await loadUsers('');
}

async function loadUsers(search) {
  try {
    const url = search ? `/api/admin/users?search=${encodeURIComponent(search)}` : '/api/admin/users';
    const res = await API.get(url);
    const data = await res.json();
    if (!data.users.length) {
      document.getElementById('users-content').innerHTML = '<p style="color:var(--text-muted);padding:20px">没有匹配的用户</p>';
      return;
    }
    document.getElementById('users-content').innerHTML = `
      <table class="data-table">
        <thead><tr><th>用户名</th><th>状态</th><th>配额</th><th>文件数</th><th>已用</th><th>双因子</th><th>最近登录</th><th>操作</th></tr></thead>
        <tbody>
          ${data.users.map(u => `<tr>
            <td><strong>${esc(u.username)}</strong></td>
            <td>${u.status === 'active' ? '<span class="badge badge-success">正常</span>' : '<span class="badge badge-danger">禁用</span>'}</td>
            <td>${u.quota_mb > 0 ? u.quota_mb + ' MB' : '无限'}</td>
            <td>${u.file_count}</td>
            <td>${u.used_mb} MB</td>
            <td>${u.totp_enabled ? '已启用' : '-'}</td>
            <td style="font-size:12px;color:var(--text-muted)">${u.last_login || '-'}</td>
            <td style="display:flex;gap:4px">
              <button class="btn btn-secondary btn-icon" onclick="viewUserDetail('${u.id}')" title="详情">${ICONS.file}</button>
              <button class="btn btn-secondary btn-icon" onclick="editUser('${u.id}','${esc(u.username)}',${u.quota_mb},'${u.status}')" title="编辑">${ICONS.edit}</button>
              <button class="btn btn-danger btn-icon" onclick="deleteUser('${u.id}','${esc(u.username)}')" title="删除">${ICONS.trash}</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch { document.getElementById('users-content').innerHTML = '<p>加载失败</p>'; }
}

// ============ User Detail ============
async function viewUserDetail(userId) {
  try {
    const res = await API.get(`/api/admin/users/${userId}/detail`);
    const d = await res.json();
    const u = d.user;
    document.getElementById('admin-main').innerHTML = `
      <div class="admin-topbar">
        <button class="btn btn-secondary btn-icon" onclick="navigate('users')" title="返回">${ICONS.back}</button>
        <h2>${esc(u.username)}</h2>
        <div class="admin-spacer"></div>
        ${u.status === 'active'
          ? `<button class="btn btn-danger" onclick="toggleUser('${u.id}','disabled')">禁用用户</button>`
          : `<button class="btn btn-primary" onclick="toggleUser('${u.id}','active')">启用用户</button>`}
      </div>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">文件数</div><div class="stat-value">${u.file_count}</div></div>
        <div class="stat-card"><div class="stat-label">已用空间</div><div class="stat-value">${u.used_mb}<span class="stat-unit"> MB</span></div></div>
        <div class="stat-card"><div class="stat-label">配额</div><div class="stat-value">${u.quota_mb > 0 ? u.quota_mb + '<span class="stat-unit"> MB</span>' : '无限'}</div></div>
        <div class="stat-card"><div class="stat-label">状态</div><div class="stat-value" style="font-size:16px">${u.status === 'active' ? '正常' : '已禁用'}</div></div>
      </div>
      <div style="margin-bottom:8px;font-size:13px;color:var(--text-muted)">
        创建: ${u.created_at.split('.')[0]} | 最近登录: ${u.last_login ? u.last_login.split('.')[0] : '从未'} | 双因子: ${u.totp_enabled ? '已启用' : '未启用'} | 密保: ${u.has_security_question ? '已设置' : '未设置'}
      </div>
      <h3 style="margin:20px 0 8px;font-size:14px">最近文件 (${d.files.length})</h3>
      <table class="data-table">
        <thead><tr><th>文件名</th><th>大小</th><th>标签</th><th>Guard</th><th>上传时间</th></tr></thead>
        <tbody>
          ${d.files.length ? d.files.map(f => `<tr>
            <td>${esc(f.name)}</td>
            <td>${f.size} B</td>
            <td>${f.tag ? '<span class="badge badge-success">' + esc(f.tag) + '</span>' : '-'}</td>
            <td>${f.guard_status === 'safe' ? '-' : '<span class="badge badge-danger">' + esc(f.guard_status) + '</span>'}</td>
            <td style="font-size:12px;color:var(--text-muted)">${f.uploaded_at.split('.')[0]}</td>
          </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">暂无文件</td></tr>'}
        </tbody>
      </table>
      <h3 style="margin:20px 0 8px;font-size:14px">操作日志 (${d.logs.length})</h3>
      <table class="data-table">
        <thead><tr><th>时间</th><th>操作</th><th>详情</th><th>IP</th></tr></thead>
        <tbody>
          ${d.logs.length ? d.logs.map(l => `<tr>
            <td style="font-size:12px;color:var(--text-muted)">${l.time.split('.')[0]}</td>
            <td><span class="badge ${l.action.includes('fail') || l.action.includes('delete') ? 'badge-danger' : 'badge-success'}">${esc(actionLabel(l.action))}</span></td>
            <td style="font-size:12px">${esc(l.detail) || '-'}</td>
            <td style="font-size:12px;color:var(--text-muted)">${l.ip || '-'}</td>
          </tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">暂无日志</td></tr>'}
        </tbody>
      </table>`;
  } catch { Toast.show('加载用户详情失败', 'error'); }
}
window.viewUserDetail = viewUserDetail;

async function toggleUser(id, status) {
  try {
    const res = await API.put(`/api/admin/users/${id}`, { status });
    if (res.ok) { Toast.show(status === 'disabled' ? '用户已禁用' : '用户已启用', 'success'); viewUserDetail(id); }
  } catch { Toast.show('操作失败', 'error'); }
}
window.toggleUser = toggleUser;

// ============ User Modal ============
function showUserModal(id, username, quota, status) {
  const isEdit = !!id;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? '编辑用户' : '添加用户'}</h3>
      ${isEdit ? '' : `<div class="form-group"><label>用户名</label><input type="text" id="m-username" class="form-input"></div>`}
      <div class="form-group"><label>密码${isEdit ? '（留空不改）' : ''}</label><input type="password" id="m-password" class="form-input"></div>
      <div class="form-group"><label>存储配额 (MB，0=无限)</label><input type="number" id="m-quota" class="form-input" value="${quota || 0}"></div>
      ${isEdit ? `<div class="form-group"><label>状态</label><select id="m-status" class="form-input"><option value="active" ${status === 'active' ? 'selected' : ''}>正常</option><option value="disabled" ${status === 'disabled' ? 'selected' : ''}>禁用</option></select></div>` : ''}
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
        <button class="btn btn-primary" id="m-save">${isEdit ? '保存' : '创建'}</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('m-save').addEventListener('click', async () => {
    const mU = document.getElementById('m-username');
    const mP = document.getElementById('m-password');
    const mQ = document.getElementById('m-quota');
    const mS = document.getElementById('m-status');
    if (isEdit) {
      const body = { quota_mb: parseInt(mQ ? mQ.value : (quota || 0)), status: mS ? mS.value : 'active' };
      if (mP && mP.value) body.password = mP.value;
      const res = await API.put(`/api/admin/users/${id}`, body);
      if (res.ok) { Toast.show('已更新', 'success'); modal.remove(); loadUsers(''); }
      else { const dt = await res.json(); Toast.show(dt.detail || '更新失败', 'error'); }
    } else {
      const res = await API.post('/api/admin/users', {
        username: mU ? mU.value : '', password: mP ? mP.value : '',
        quota_mb: parseInt(mQ ? mQ.value : 0),
      });
      if (res.ok) { Toast.show('用户已创建', 'success'); modal.remove(); loadUsers(''); }
      else { const dt = await res.json(); Toast.show(dt.detail || '创建失败', 'error'); }
    }
  });
}

async function deleteUser(id, name) {
  if (!confirm(`确定删除用户 "${name}"？该用户的所有文件和数据将被永久删除！`)) return;
  const res = await API.del(`/api/admin/users/${id}`);
  if (res.ok) { Toast.show('用户已删除', 'success'); loadUsers(''); }
  else { Toast.show('删除失败', 'error'); }
}
window.editUser = showUserModal;
window.deleteUser = deleteUser;

// ============ Global Files ============
async function renderFiles() {
  document.getElementById('admin-main').innerHTML = `
    <div class="admin-topbar">
      <h2>全局文件</h2>
      <div class="admin-spacer"></div>
      <div class="search-box">${ICONS.search}<input type="text" id="file-search" placeholder="搜索文件名..." style="background:transparent;border:none;outline:none;color:var(--text);font-size:13px;width:160px"></div>
      <button class="btn btn-secondary btn-icon" id="btn-refresh-files" title="刷新">${ICONS.refresh}</button>
    </div>
    <div id="files-content">加载中...</div>`;
  document.getElementById('btn-refresh-files').addEventListener('click', () => loadFiles(''));
  let st;
  document.getElementById('file-search').addEventListener('input', (e) => {
    clearTimeout(st); st = setTimeout(() => loadFiles(e.target.value), 300);
  });
  await loadFiles('');
}

async function loadFiles(search) {
  try {
    const url = search ? `/api/admin/files?search=${encodeURIComponent(search)}` : '/api/admin/files';
    const res = await API.get(url);
    const data = await res.json();
    if (!data.files.length) {
      document.getElementById('files-content').innerHTML = '<p style="color:var(--text-muted);padding:20px">没有文件</p>';
      return;
    }
    document.getElementById('files-content').innerHTML = `
      <table class="data-table">
        <thead><tr><th>文件名</th><th>所属用户</th><th>大小</th><th>标签</th><th>Guard</th><th>上传时间</th></tr></thead>
        <tbody>
          ${data.files.map(f => `<tr>
            <td>${esc(f.name)}</td>
            <td><strong>${esc(f.owner)}</strong></td>
            <td>${f.size > 1048576 ? (f.size/1048576).toFixed(1) + ' MB' : f.size > 1024 ? (f.size/1024).toFixed(1) + ' KB' : f.size + ' B'}</td>
            <td>${f.tag ? '<span class="badge badge-success">' + esc(f.tag) + '</span>' : '-'}</td>
            <td>${f.guard_status === 'safe' ? '-' : '<span class="badge badge-danger">' + esc(f.guard_status) + '</span>'}</td>
            <td style="font-size:12px;color:var(--text-muted)">${f.uploaded_at.split('.')[0]}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <p style="margin-top:12px;font-size:12px;color:var(--text-muted)">共 ${data.total} 个文件</p>`;
  } catch { document.getElementById('files-content').innerHTML = '<p>加载失败</p>'; }
}

// ============ Settings ============
async function renderSettings() {
  document.getElementById('admin-main').innerHTML = `
    <div class="admin-topbar"><h2>系统设置</h2></div>
    <div id="settings-content">加载中...</div>`;
  try {
    const [res1, res2] = await Promise.all([API.get('/api/admin/settings'), API.get('/api/admin/system-info')]);
    const s = await res1.json();
    const si = await res2.json();
    document.getElementById('settings-content').innerHTML = `
      <div class="settings-section">
        <h3>注册与配额</h3>
        <div class="form-group">
          <label>开放用户注册</label>
          <select id="set-register" class="form-input" style="max-width:300px">
            <option value="true" ${s.allow_register === 'true' ? 'selected' : ''}>开放注册</option>
            <option value="false" ${s.allow_register !== 'true' ? 'selected' : ''}>关闭注册（仅管理员创建）</option>
          </select>
        </div>
        <div class="form-group">
          <label>新用户默认配额 (MB，0=无限)</label>
          <input type="number" id="set-quota" class="form-input" style="max-width:300px" value="${s.default_quota_mb}">
        </div>
        <button class="btn btn-primary" id="btn-save-settings">保存设置</button>
      </div>
      <div class="settings-section" style="margin-top:24px">
        <h3>系统信息</h3>
        <table class="info-table">
          <tr><td>应用版本</td><td>${si.app_version}</td></tr>
          <tr><td>Python 版本</td><td>${si.python_version}</td></tr>
          <tr><td>运行平台</td><td>${si.platform}</td></tr>
          <tr><td>存储目录</td><td>${si.storage_dir}</td></tr>
          <tr><td>数据库路径</td><td>${si.database_path}</td></tr>
          <tr><td>LLM 提供商</td><td>${si.llm_provider}</td></tr>
          <tr><td>LLM 模型</td><td>${si.llm_model}</td></tr>
        </table>
      </div>`;
    document.getElementById('btn-save-settings').addEventListener('click', async () => {
      const body = {
        allow_register: document.getElementById('set-register').value === 'true',
        default_quota_mb: parseInt(document.getElementById('set-quota').value),
      };
      const res = await API.put('/api/admin/settings', body);
      if (res.ok) Toast.show('设置已保存', 'success');
      else { const d = await res.json(); Toast.show(d.detail || '保存失败', 'error'); }
    });
  } catch { document.getElementById('settings-content').innerHTML = '<p>加载失败</p>'; }
}

// ============ Logs ============
async function renderLogs() {
  document.getElementById('admin-main').innerHTML = `
    <div class="admin-topbar">
      <h2>审计日志</h2>
      <div class="admin-spacer"></div>
      <div class="search-box">${ICONS.search}<input type="text" id="log-search" placeholder="搜索操作类型..." style="background:transparent;border:none;outline:none;color:var(--text);font-size:13px;width:160px"></div>
    </div>
    <div id="logs-content">加载中...</div>`;
  let st;
  document.getElementById('log-search').addEventListener('input', (e) => {
    clearTimeout(st); st = setTimeout(() => loadLogs(e.target.value), 300);
  });
  await loadLogs('');
}

async function loadLogs(action) {
  try {
    const url = action ? `/api/admin/logs?action=${encodeURIComponent(action)}&limit=200` : '/api/admin/logs?limit=200';
    const res = await API.get(url);
    const data = await res.json();
    document.getElementById('logs-content').innerHTML = `
      <table class="data-table">
        <thead><tr><th>时间</th><th>用户</th><th>操作</th><th>详情</th><th>IP</th></tr></thead>
        <tbody>
          ${data.logs.map(l => `<tr>
            <td style="font-size:12px;color:var(--text-muted);white-space:nowrap">${l.time.split('.')[0]}</td>
            <td>${esc(l.username)}</td>
            <td><span class="badge ${l.action.includes('fail') || l.action.includes('delete') ? 'badge-danger' : 'badge-success'}">${esc(actionLabel(l.action))}</span></td>
            <td style="font-size:12px">${esc(l.detail) || '-'}</td>
            <td style="font-size:12px;color:var(--text-muted)">${l.ip || '-'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <p style="margin-top:12px;font-size:12px;color:var(--text-muted)">共 ${data.total} 条日志</p>`;
  } catch { document.getElementById('logs-content').innerHTML = '<p>加载失败</p>'; }
}

// ============ Init ============
function init() {
  if (!API._token) { renderLogin(); return; }
  renderLayout();
  navigate('dashboard');
}

init();
