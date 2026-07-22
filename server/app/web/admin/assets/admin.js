// 随行档 - 管理员后台 SPA (v3)

// 与用户端共享的模块：改密弹窗接线（消灭双端复制漂移）+ 审计词表单一真源
import { changePasswordFormHTML, wireChangePasswordForm } from './utils/password-dialog.js?v=96';
import { AUDIT_ACTIONS, auditLabel } from './utils/audit-actions.js?v=97';
// 统一反馈层（toast/confirm/alert/modal）· 与用户端 components/feedback 同形态
import { toast, confirm } from './utils/feedback.mjs?v=1';

const API = {
  // 管理员令牌存 HttpOnly cookie（与用户端一致），前端 JS 不可读，防 XSS 偷令牌。
  // 同源 fetch 自动带 cookie，无需手动附加 Authorization 头。
  async req(url, opts = {}) {
    const headers = { ...opts.headers };
    if (opts.body) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, { ...opts, headers });
    // cookie 失效/过期：清 cookie 并回登录页，避免显示误导性的"加载失败"
    if (res.status === 401) {
      // 会话失效：清 cookie 并回登录页；不在此 toast，由调用方按 res.ok 自行提示，避免重复 toast
      try { await fetch('/api/auth/admin/logout', { method: 'POST' }); } catch {}
      setTimeout(() => location.reload(), 800);
      return res;
    }
    return res;
  },
  get(u) { return this.req(u); },
  post(u, b) { return this.req(u, { method: 'POST', body: JSON.stringify(b) }); },
  put(u, b) { return this.req(u, { method: 'PUT', body: JSON.stringify(b) }); },
  del(u) { return this.req(u, { method: 'DELETE' }); },
};

// 审计事件标签来自共享词表 utils/audit-actions.js（与用户端单一真源，不再手同步）
const ACTION_LABELS = Object.fromEntries(Object.entries(AUDIT_ACTIONS).map(([k, v]) => [k, v.label]));
function actionLabel(a) { return ACTION_LABELS[a] || auditLabel(a); }

const ico = (n) => `<svg class="sx-ico" viewBox="0 0 24 24"><use href="#sx-ico-${n}"/></svg>`;
const ICONS = {
  dashboard: ico('layout-dashboard'),
  users: ico('users'),
  file: ico('file'),
  groups: ico('users'),
  log: ico('file-text'),
  settings: ico('settings'),
  logout: ico('log-out'),
  add: ico('plus'),
  edit: ico('pencil'),
  trash: ico('trash'),
  search: ico('search'),
  back: ico('arrow-left'),
  account: ico('user'),
  refresh: ico('refresh'),
  llm: ico('sparkles'),
  lock: ico('lock'),
  eye: ico('eye'),
  eyeOff: ico('eye-off'),
};

let currentView = 'dashboard';

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

// ============ 分页组件 ============
const pager = {
  users: { page: 1, pageSize: 10, total: 0 },
  files: { page: 1, pageSize: 10, total: 0 },
  groups: { page: 1, pageSize: 10, total: 0 },
  logs: { page: 1, pageSize: 10, total: 0 },
};

function paginationHTML(view, fnName) {
  const p = pager[view];
  const totalPages = Math.ceil(p.total / p.pageSize) || 1;
  if (totalPages <= 1) return `<div class="pagination"><span class="page-info">共 ${p.total} 条</span></div>`;
  const cur = p.page;
  let pages = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (cur > 4) pages.push('...');
    for (let i = Math.max(2, cur - 1); i <= Math.min(totalPages - 1, cur + 1); i++) pages.push(i);
    if (cur < totalPages - 3) pages.push('...');
    pages.push(totalPages);
  }
  const btns = pages.map(pg => pg === '...'
    ? '<span class="page-ellipsis">...</span>'
    : `<button class="page-btn ${pg === cur ? 'active' : ''}" data-action="${fnName}" data-page="${pg}">${pg}</button>`
  ).join('');
  return `<div class="pagination">
    <button class="page-btn" ${cur === 1 ? 'disabled' : ''} data-action="${fnName}" data-page="${cur - 1}">上一页</button>
    ${btns}
    <button class="page-btn" ${cur === totalPages ? 'disabled' : ''} data-action="${fnName}" data-page="${cur + 1}">下一页</button>
    <span class="page-info">共 ${p.total} 条 / ${totalPages} 页</span>
  </div>`;
}

// ============ Login ============
function renderLogin() {
  document.body.classList.remove('view-shell');
  document.getElementById('admin-app').innerHTML = `
    <div class="login-container">
      <aside class="login-brand">
        <div class="login-brand-top">
          <span class="login-brand-mark">管</span>
          <span class="login-brand-name">随行档 · 管理后台</span>
        </div>
        <div class="login-brand-body">
          <h2>集中管理<br>用户、文件与系统。</h2>
          <p>账号、配额、文件、令牌与系统设置，一处掌控。</p>
          <ul class="login-brand-points">
            <li>${ico('users')}用户与配额管理</li>
            <li>${ico('folder')}文件与令牌审计</li>
            <li>${ico('server')}系统运行监控</li>
          </ul>
        </div>
        <div class="login-brand-foot">© 2026 随行档 · 管理后台</div>
      </aside>
      <main class="login-main">
        <div class="login-card">
          <div class="login-logo">管</div>
          <h1>管理员登录</h1>
          <p class="subtitle">核验管理员凭证</p>
          <form id="admin-login-form">
            <div class="form-group"><label>管理员用户名</label><input type="text" id="login-user" class="form-input" autofocus></div>
            <div class="form-group"><label>密码</label><input type="password" id="login-pass" class="form-input"></div>
            <button type="submit" class="btn btn-primary btn-block">登录</button>
          </form>
        </div>
      </main>
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
      if (res.ok) { toast('登录成功', 'success'); init(); }
      else { toast(data.detail || '登录失败', 'error'); }
    } catch { toast('网络错误', 'error'); }
  });
}

// ============ 全局事件委托（CSP 禁用内联事件处理器与 javascript: URL） ============
// 管理后台动态渲染的按钮统一用 data-action + data-* 参数，由 #admin-app 单一委托分发。
let _adminDelegated = false;
function bindAdminDelegation() {
  if (_adminDelegated) return;
  const root = document.getElementById('admin-app');
  if (!root) return;
  _adminDelegated = true;
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    e.preventDefault();
    const a = el.dataset.action;
    if (a === 'navigate') return navigate(el.dataset.view);
    if (a === 'viewUserDetail') return viewUserDetail(el.dataset.userId);
    if (a === 'editUser') return showUserModal(el.dataset.userId, el.dataset.username, Number(el.dataset.quota), el.dataset.status);
    if (a === 'deleteUser') return deleteUser(el.dataset.userId, el.dataset.username);
    if (a === 'toggleUser') return toggleUser(el.dataset.userId, el.dataset.status);
    if (a === 'createUserToken') return createUserToken(el.dataset.userId);
    if (a === 'revokeAllUserTokens') return revokeAllUserTokens(el.dataset.userId);
    if (a === 'revokeUserToken') return revokeUserToken(el.dataset.userId, el.dataset.tokenId);
    if (a === 'adminDeleteGroup') return adminDeleteGroup(el.dataset.groupId, el.dataset.name);
    if (a === 'testLlmProvider') return testLlmProvider(el.dataset.providerId);
    if (a === 'editLlmProvider') return editLlmProvider(el.dataset.providerId);
    if (a === 'deleteLlmProvider') return deleteLlmProvider(el.dataset.providerId, el.dataset.name);
    // 分页：data-action 为 goXxxPage 函数名，data-page 为页码
    if (el.dataset.page !== undefined) {
      const fn = window[a];
      if (typeof fn === 'function') return fn(Number(el.dataset.page));
    }
  });
}

// ============ Layout ============
function renderLayout() {
  document.body.classList.add('view-shell');
  bindAdminDelegation();
  let sbCollapsed = false;
  try { sbCollapsed = localStorage.getItem('sxd_adminSidebarCollapsed') === '1'; } catch {}
  document.getElementById('admin-app').innerHTML = `
    <div class="admin-layout">
      <div class="admin-sidebar${sbCollapsed ? ' collapsed' : ''}">
        <div class="admin-logo">
          <div class="admin-logo-icon">管</div>
          <div class="admin-logo-text">管理后台</div>
        </div>
        <div class="admin-nav">
          <div class="admin-nav-item active" data-view="dashboard" title="系统概览">${ICONS.dashboard} 系统概览</div>
          <div class="admin-nav-item" data-view="users" title="用户管理">${ICONS.users} 用户管理</div>
          <div class="admin-nav-item" data-view="files" title="全局文件">${ICONS.file} 全局文件</div>
         <div class="admin-nav-item" data-view="groups" title="分组管理">${ICONS.groups} 分组管理</div>
          <div class="admin-nav-item" data-view="llm" title="大模型配置">${ICONS.llm} 大模型配置</div>
         <div class="admin-nav-item" data-view="settings" title="系统设置">${ICONS.settings} 系统设置</div>
         <div class="admin-nav-item" data-view="logs" title="审计日志">${ICONS.log} 审计日志</div>
          <div class="admin-nav-item" data-view="account" title="账户">${ICONS.account} 账户</div>
        </div>
        <div style="padding:12px">
          <div class="admin-nav-item" id="btn-logout" title="退出登录">${ICONS.logout} 退出登录</div>
        </div>
        <button class="admin-sidebar-toggle" id="admin-sidebar-toggle" aria-expanded="${!sbCollapsed}"
                title="${sbCollapsed ? '展开侧栏' : '收起侧栏'}">
          ${ico('chevron-left')}
        </button>
      </div>
      <div class="admin-main" id="admin-main"></div>
    </div>`;
  document.querySelectorAll('.admin-nav-item[data-view]').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.view));
  });
  document.getElementById('btn-logout').addEventListener('click', () => { fetch('/api/auth/admin/logout', { method: 'POST' }).finally(() => location.reload()); });
  const sbToggle = document.getElementById('admin-sidebar-toggle');
  if (sbToggle) {
    sbToggle.addEventListener('click', () => {
      const sb = document.querySelector('.admin-sidebar');
      const c = sb.classList.toggle('collapsed');
      try { localStorage.setItem('sxd_adminSidebarCollapsed', c ? '1' : '0'); } catch {}
      sbToggle.title = c ? '展开侧栏' : '收起侧栏';
      sbToggle.setAttribute('aria-expanded', String(!c));
    });
  }
}

function navigate(view) {
  currentView = view;
  document.querySelectorAll('.admin-nav-item[data-view]').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
 if (view === 'dashboard') renderDashboard();
 else if (view === 'users') renderUsers();
 else if (view === 'files') renderFiles();
 else if (view === 'groups') renderGroups();
 else if (view === 'llm') renderLlm();
 else if (view === 'settings') renderSettings();
 else if (view === 'logs') renderLogs();
 else if (view === 'account') renderAccount();
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
            <td class="td-meta">${u.last_login || '-'}</td>
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
      <div class="search-box">${ICONS.search}<input type="text" id="user-search" placeholder="搜索用户名..." class="search-input" style="width:140px"></div>
      <button class="btn btn-primary" id="btn-add-user">${ICONS.add} 添加用户</button>
    </div>
    <div id="users-content">加载中...</div>`;
  document.getElementById('btn-add-user').addEventListener('click', () => showUserModal());
  let st;
  document.getElementById('user-search').addEventListener('input', (e) => {
    clearTimeout(st); st = setTimeout(() => loadUsers(e.target.value, 1), 300);
  });
  await loadUsers('');
}

async function loadUsers(search, page) {
  page = page || 1;
  pager.users.page = page;
  try {
    let url = `/api/admin/users?page=${page}&page_size=${pager.users.pageSize}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    const res = await API.get(url);
    const data = await res.json();
    pager.users.total = data.total || 0;
    if (!data.users.length) {
      document.getElementById('users-content').innerHTML = '<p class="empty-text">没有匹配的用户</p>';
      return;
    }
    document.getElementById('users-content').innerHTML = `
      <table class="data-table">
        <thead><tr><th>用户名</th><th>状态</th><th>配额</th><th>文件数</th><th>已用</th><th>最近登录</th><th>操作</th></tr></thead>
        <tbody>
          ${data.users.map(u => `<tr>
            <td><strong>${esc(u.username)}</strong></td>
            <td>${u.status === 'active' ? '<span class="badge badge-success">正常</span>' : '<span class="badge badge-danger">禁用</span>'}</td>
            <td>${u.quota_mb > 0 ? u.quota_mb + ' MB' : '无限'}</td>
            <td>${u.file_count}</td>
            <td>${u.used_mb} MB</td>
            <td class="td-meta">${u.last_login || '-'}</td>
            <td class="td-actions">
              <button class="btn btn-secondary btn-icon" data-action="viewUserDetail" data-user-id="${u.id}" title="详情">${ICONS.file}</button>
              <button class="btn btn-secondary btn-icon" data-action="editUser" data-user-id="${u.id}" data-username="${esc(u.username)}" data-quota="${u.quota_mb}" data-status="${u.status}" title="编辑">${ICONS.edit}</button>
              <button class="btn btn-danger btn-icon" data-action="deleteUser" data-user-id="${u.id}" data-username="${esc(u.username)}" title="删除">${ICONS.trash}</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${paginationHTML('users', 'goUsersPage')}`;
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
        <button class="btn btn-secondary btn-icon" data-action="navigate" data-view="users" title="返回">${ICONS.back}</button>
        <h2>${esc(u.username)}</h2>
        <div class="admin-spacer"></div>
        ${u.status === 'active'
          ? `<button class="btn btn-danger" data-action="toggleUser" data-user-id="${u.id}" data-status="disabled">禁用用户</button>`
          : `<button class="btn btn-primary" data-action="toggleUser" data-user-id="${u.id}" data-status="active">启用用户</button>`}
      </div>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">文件数</div><div class="stat-value">${u.file_count}</div></div>
        <div class="stat-card"><div class="stat-label">已用空间</div><div class="stat-value">${u.used_mb}<span class="stat-unit"> MB</span></div></div>
        <div class="stat-card"><div class="stat-label">配额</div><div class="stat-value">${u.quota_mb > 0 ? u.quota_mb + '<span class="stat-unit"> MB</span>' : '无限'}</div></div>
        <div class="stat-card"><div class="stat-label">状态</div><div class="stat-value stat-value-sm">${u.status === 'active' ? '正常' : '已禁用'}</div></div>
      </div>
      <div class="user-detail-meta">
       创建: ${u.created_at.split('.')[0]} | 最近登录: ${u.last_login ? u.last_login.split('.')[0] : '从未'} | 密保: ${u.has_security_question ? '已设置' : '未设置'}
     </div>
      <div class="user-detail-block">
        <div class="user-detail-block-head">
          <h3>${ICONS.llm} AI 助手权限</h3>
          <div class="admin-spacer" style="flex:1"></div>
          <label class="checkbox-label">
            <input type="checkbox" id="user-ai-enabled" ${u.ai_enabled ? 'checked' : ''} class="checkbox-input"> 允许使用 AI 助手
          </label>
        </div>
        <div class="form-group user-detail-form-group" id="user-llm-assign-area">
          <label>分配大模型（不选则用默认）</label>
          <select id="user-llm-provider" class="form-input form-max"></select>
          <button class="btn btn-primary" style="margin-left:8px" id="btn-save-user-ai">保存</button>
        </div>
      </div>
      <h3 class="user-detail-h3">
        访问令牌 (<span id="user-tokens-count">0</span>)
        <div class="admin-spacer" style="flex:1"></div>
        <button class="btn btn-primary" data-action="createUserToken" data-user-id="${u.id}">${ICONS.add} 创建令牌</button>
        <button class="btn btn-danger" data-action="revokeAllUserTokens" data-user-id="${u.id}">全部吊销</button>
      </h3>
      <div id="user-tokens-content">加载中...</div>
      <h3 class="user-detail-h3">最近文件 (${d.files.length})</h3>
      <table class="data-table">
        <thead><tr><th>文件名</th><th>大小</th><th>分组</th><th>Guard</th><th>上传时间</th></tr></thead>
        <tbody>
          ${d.files.length ? d.files.map(f => `<tr>
            <td>${esc(f.name)}</td>
            <td>${f.size} B</td>
            <td>${f.group_name ? '<span class="badge badge-info">' + esc(f.group_name) + '</span>' : '-'}</td>
            <td>${f.guard_status === 'safe' ? '-' : '<span class="badge badge-danger">' + esc(f.guard_status) + '</span>'}</td>
            <td class="td-meta">${f.uploaded_at.split('.')[0]}</td>
          </tr>`).join('') : '<tr><td colspan="5" class="empty-text">暂无文件</td></tr>'}
        </tbody>
      </table>
      <h3 class="user-detail-h3">操作日志 (${d.logs.length})</h3>
      <table class="data-table">
        <thead><tr><th>时间</th><th>操作</th><th>详情</th><th>IP</th></tr></thead>
        <tbody>
          ${d.logs.length ? d.logs.map(l => `<tr>
            <td class="td-meta">${l.time.split('.')[0]}</td>
            <td><span class="badge ${l.action.includes('fail') || l.action.includes('delete') ? 'badge-danger' : 'badge-success'}">${esc(actionLabel(l.action))}</span></td>
            <td class="td-detail">${esc(l.detail) || '-'}</td>
            <td class="td-meta">${l.ip || '-'}</td>
          </tr>`).join('') : '<tr><td colspan="4" class="empty-text">暂无日志</td></tr>'}
        </tbody>
    </table>`;
    loadUserTokens(u.id);
    loadUserAiSettings(u);
  } catch { toast('加载用户详情失败', 'error'); }
}
window.viewUserDetail = viewUserDetail;

async function loadUserAiSettings(u) {
  // 先同步拿到当前用户详情渲染出的按钮与下拉框，再异步加载可分配模型列表。
  // 若放在 await 之后获取，快速切换用户时会把 A 用户的处理器绑到 B 用户的按钮上，
  // 导致保存请求发到错误的用户端点。
  const sel = document.getElementById('user-llm-provider');
  const btn = document.getElementById('btn-save-user-ai');
  if (btn) btn.addEventListener('click', async () => {
    const body = {
      ai_enabled: document.getElementById('user-ai-enabled').checked,
      llm_provider_id: document.getElementById('user-llm-provider').value,
    };
    try {
      const res = await API.put(`/api/admin/users/${u.id}/ai`, body);
      if (res.ok) toast('AI 设置已保存', 'success');
      else { const d = await res.json().catch(() => ({})); toast(d.detail || '保存失败', 'error'); }
    } catch { toast('保存失败，请检查网络', 'error'); }
  });
  if (!sel) return;
  try {
    const res = await API.get('/api/admin/llm/assignable');
    const data = await res.json();
    const providers = data.providers || [];
    sel.innerHTML = '<option value="">使用默认模型</option>' +
      providers.map(p => `<option value="${p.id}" ${p.id === u.llm_provider_id ? 'selected' : ''}>${esc(p.name)} (${esc(p.model)})${p.is_default ? ' [默认]' : ''}</option>`).join('');
  } catch {
    // 列表加载失败时给出提示，避免管理员在不知情的情况下保存并清空已有分配。
    toast('可分配模型列表加载失败，保存将清除当前分配', 'warning', 5000);
  }
}

async function toggleUser(id, status) {
  try {
    const res = await API.put(`/api/admin/users/${id}`, { status });
    if (res.ok) { toast(status === 'disabled' ? '用户已禁用' : '用户已启用', 'success'); viewUserDetail(id); }
  } catch { toast('操作失败', 'error'); }
}
window.toggleUser = toggleUser;

// ============ User Access Tokens ============
async function loadUserTokens(userId) {
  const el = document.getElementById('user-tokens-content');
  if (!el) return;
  try {
    const res = await API.get(`/api/admin/users/${userId}/tokens`);
    const tokens = await res.json();
    const countEl = document.getElementById('user-tokens-count');
    if (countEl) countEl.textContent = tokens.length;
    if (!tokens.length) {
      el.innerHTML = '<p class="empty-text--sm">暂无访问令牌</p>';
      return;
    }
    const now = Date.now();
   el.innerHTML = `
     <table class="data-table">
        <thead><tr><th>标签</th><th>类型</th><th>状态</th><th>来源 IP / 地域</th><th>创建时间</th><th>最后使用</th><th>过期时间</th><th>操作</th></tr></thead>
       <tbody>
         ${tokens.map(t => {
           const expired = t.expires_at && new Date(t.expires_at).getTime() < now;
           let badge;
           if (t.revoked) badge = '<span class="badge badge-danger">已吊销</span>';
           else if (expired) badge = '<span class="badge badge-danger">已过期</span>';
            else badge = '<span class="badge badge-success">有效</span>' + (t.download_granted ? '<span class="badge badge-warning">下载中</span>' : '');
            const location = t.ip ? `${esc(t.geo ? t.geo + ' ' : '')}${esc(t.ip)}` : '-';
           const action = (t.revoked || expired) ? '-' : `<button class="btn btn-danger btn-icon" data-action="revokeUserToken" data-user-id="${userId}" data-token-id="${t.id}" title="吊销">${ICONS.trash}</button>`;
           return `<tr>
             <td>${esc(t.label) || '-'}</td>
             <td>${t.kind === 'session' ? '浏览器会话' : '设备令牌'}</td>
             <td>${badge}</td>
              <td class="td-meta">${location}</td>
             <td class="td-meta">${t.created_at ? t.created_at.split('.')[0] : '-'}</td>
             <td class="td-meta">${t.last_used_at ? t.last_used_at.split('.')[0] : '从未'}</td>
             <td class="td-meta">${t.expires_at ? t.expires_at.split('.')[0] : '永久'}</td>
             <td>${action}</td>
           </tr>`;
         }).join('')}
       </tbody>
     </table>`;
  } catch { el.innerHTML = '<p class="empty-text">加载令牌失败</p>'; }
}
window.loadUserTokens = loadUserTokens;

async function createUserToken(userId) {
  const label = prompt('令牌标签（如：家里电脑、公司电脑、守护进程）：', 'device');
  if (label === null) return;
  const daysStr = prompt('过期天数（0=永久）：', '0');
  if (daysStr === null) return;
  const days = parseInt(daysStr);
  try {
    const res = await API.post(`/api/admin/users/${userId}/tokens`, { label: label.trim() || 'device', expires_days: isNaN(days) ? 0 : days });
    if (res.ok) {
      const data = await res.json();
      prompt('访问令牌已创建（请妥善保存，仅显示一次）：', data.token);
      toast('令牌已创建', 'success');
      loadUserTokens(userId);
    } else { const d = await res.json(); toast(d.detail || '创建失败', 'error'); }
  } catch { toast('创建失败', 'error'); }
}
window.createUserToken = createUserToken;

async function revokeUserToken(userId, tokenId) {
  const ok = await confirm({
    title: '吊销令牌', danger: true, confirmText: '吊销',
    body: '确定吊销该访问令牌？吊销后该令牌将立即无法访问。',
  });
  if (!ok) return;
  try {
    const res = await API.del(`/api/admin/users/${userId}/tokens/${tokenId}`);
    if (res.ok) { toast('令牌已吊销', 'success'); loadUserTokens(userId); }
    else { const d = await res.json(); toast(d.detail || '吊销失败', 'error'); }
  } catch { toast('吊销失败', 'error'); }
}
window.revokeUserToken = revokeUserToken;

async function revokeAllUserTokens(userId) {
  const ok = await confirm({
    title: '吊销全部令牌', danger: true, confirmText: '吊销',
    body: '确定吊销该用户的全部令牌（含浏览器会话）？所有设备与会话将立即下线。',
  });
  if (!ok) return;
  try {
    const res = await API.del(`/api/admin/users/${userId}/tokens`);
    if (res.ok) { const d = await res.json(); toast(d.message, 'success'); loadUserTokens(userId); }
    else { const d = await res.json(); toast(d.detail || '操作失败', 'error'); }
  } catch { toast('操作失败', 'error'); }
}
window.revokeAllUserTokens = revokeAllUserTokens;

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
        <button class="btn btn-secondary" id="m-cancel">取消</button>
        <button class="btn btn-primary" id="m-save">${isEdit ? '保存' : '创建'}</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('m-cancel').addEventListener('click', () => modal.remove());
  document.getElementById('m-save').addEventListener('click', async () => {
    const mU = document.getElementById('m-username');
    const mP = document.getElementById('m-password');
    const mQ = document.getElementById('m-quota');
    const mS = document.getElementById('m-status');
    if (isEdit) {
      const body = { quota_mb: parseInt(mQ ? mQ.value : (quota || 0)), status: mS ? mS.value : 'active' };
      if (mP && mP.value) body.password = mP.value;
      const res = await API.put(`/api/admin/users/${id}`, body);
      if (res.ok) { toast('已更新', 'success'); modal.remove(); loadUsers(''); }
      else { const dt = await res.json(); toast(dt.detail || '更新失败', 'error'); }
    } else {
      const res = await API.post('/api/admin/users', {
        username: mU ? mU.value : '', password: mP ? mP.value : '',
        quota_mb: parseInt(mQ ? mQ.value : 0),
      });
      if (res.ok) { toast('用户已创建', 'success'); modal.remove(); loadUsers(''); }
      else { const dt = await res.json(); toast(dt.detail || '创建失败', 'error'); }
    }
  });
}

async function deleteUser(id, name) {
  const ok = await confirm({
    title: '删除用户', danger: true, confirmText: '删除',
    body: `确定删除用户 "${name}"？该用户的所有文件和数据将被永久删除！`,
  });
  if (!ok) return;
  const res = await API.del(`/api/admin/users/${id}`);
  if (res.ok) { toast('用户已删除', 'success'); loadUsers(''); }
  else { toast('删除失败', 'error'); }
}
window.editUser = showUserModal;
window.deleteUser = deleteUser;

// ============ Global Files ============
async function renderFiles() {
  document.getElementById('admin-main').innerHTML = `
    <div class="admin-topbar">
      <h2>全局文件</h2>
      <div class="admin-spacer"></div>
      <div class="search-box">${ICONS.search}<input type="text" id="file-search" placeholder="搜索文件名..." class="search-input" style="width:160px"></div>
      <button class="btn btn-secondary btn-icon" id="btn-refresh-files" title="刷新">${ICONS.refresh}</button>
    </div>
    <div id="files-content">加载中...</div>`;
  document.getElementById('btn-refresh-files').addEventListener('click', () => loadFiles('', 1));
  let st;
  document.getElementById('file-search').addEventListener('input', (e) => {
    clearTimeout(st); st = setTimeout(() => loadFiles(e.target.value, 1), 300);
  });
  await loadFiles('');
}

async function loadFiles(search, page) {
  page = page || 1;
  pager.files.page = page;
  try {
    let url = `/api/admin/files?page=${page}&page_size=${pager.files.pageSize}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    const res = await API.get(url);
    const data = await res.json();
    pager.files.total = data.total || 0;
    if (!data.files.length) {
      document.getElementById('files-content').innerHTML = '<p class="empty-text">没有文件</p>';
      return;
    }
    document.getElementById('files-content').innerHTML = `
      <table class="data-table">
        <thead><tr><th>文件名</th><th>所属用户</th><th>大小</th><th>分组</th><th>Guard</th><th>上传时间</th></tr></thead>
        <tbody>
          ${data.files.map(f => `<tr>
            <td>${esc(f.name)}</td>
            <td><strong>${esc(f.owner)}</strong></td>
            <td>${f.size > 1048576 ? (f.size/1048576).toFixed(1) + ' MB' : f.size > 1024 ? (f.size/1024).toFixed(1) + ' KB' : f.size + ' B'}</td>
            <td>${f.group_name ? '<span class="badge badge-info">' + esc(f.group_name) + '</span>' : '-'}</td>
            <td>${f.guard_status === 'safe' ? '-' : '<span class="badge badge-danger">' + esc(f.guard_status) + '</span>'}</td>
            <td class="td-meta">${f.uploaded_at.split('.')[0]}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${paginationHTML('files', 'goFilesPage')}`;
  } catch { document.getElementById('files-content').innerHTML = '<p>加载失败</p>'; }
}

// ============ Groups ============
function fmtBytes(n) {
  if (!n) return '0 B';
  return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B';
}

async function renderGroups() {
  document.getElementById('admin-main').innerHTML = `
    <div class="admin-topbar">
      <h2>分组管理</h2>
      <div class="admin-spacer"></div>
      <div class="search-box">${ICONS.search}<input type="text" id="group-search" placeholder="搜索分组或用户..." class="search-input" style="width:180px"></div>
      <button class="btn btn-secondary btn-icon" id="btn-refresh-groups" title="刷新">${ICONS.refresh}</button>
    </div>
    <div id="groups-content">加载中...</div>`;
  document.getElementById('btn-refresh-groups').addEventListener('click', () => loadGroups('', 1));
  let st;
  document.getElementById('group-search').addEventListener('input', (e) => {
    clearTimeout(st); st = setTimeout(() => loadGroups(e.target.value, 1), 300);
  });
  await loadGroups('');
}

async function loadGroups(search, page) {
  page = page || 1;
  pager.groups.page = page;
  try {
    let url = `/api/admin/groups?page=${page}&page_size=${pager.groups.pageSize}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    const res = await API.get(url);
    const data = await res.json();
    pager.groups.total = data.total || 0;
    const el = document.getElementById('groups-content');
    if (!data.groups.length) {
      el.innerHTML = '<p class="empty-text">暂无分组</p>';
      return;
    }
    el.innerHTML = `
      <table class="data-table">
        <thead><tr><th>分组名称</th><th>所属用户</th><th>文件数</th><th>占用空间</th><th>创建时间</th><th>操作</th></tr></thead>
        <tbody>
          ${data.groups.map(g => `<tr>
            <td><strong>${esc(g.name)}</strong></td>
            <td><a href="#" data-action="viewUserDetail" data-user-id="${g.owner_id}" class="td-link">${esc(g.owner)}</a></td>
            <td>${g.file_count}</td>
            <td>${fmtBytes(g.size)}</td>
            <td class="td-meta">${g.created_at.split('.')[0]}</td>
            <td><button class="btn btn-danger btn-sm" data-action="adminDeleteGroup" data-group-id="${g.id}" data-name="${esc(g.name)}">删除</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${paginationHTML('groups', 'goGroupsPage')}`;
  } catch { document.getElementById('groups-content').innerHTML = '<p>加载失败</p>'; }
}

async function adminDeleteGroup(id, name) {
  const ok = await confirm({
    title: '删除分组', danger: true, confirmText: '删除',
    body: `确定删除分组 "${name}"？分组内文件不会被删除，仅解除关联。`,
  });
  if (!ok) return;
  const res = await API.del(`/api/admin/groups/${id}`);
  if (res.ok) { toast('分组已删除', 'success'); loadGroups(document.getElementById('group-search') ? document.getElementById('group-search').value : '', pager.groups.page); }
  else { const d = await res.json(); toast(d.detail || '删除失败', 'error'); }
}
window.adminDeleteGroup = adminDeleteGroup;

// ============ LLM 配置 ============
async function renderLlm() {
  document.getElementById('admin-main').innerHTML = `
    <div class="admin-topbar">
      <h2>大模型配置</h2>
      <div class="admin-spacer"></div>
      <button class="btn btn-primary" id="btn-add-llm">${ICONS.add} 添加大模型</button>
    </div>
    <div class="section-hint">
      管理多个大模型，分配给不同用户使用。标记为「默认」的模型会自动分配给未指定模型的用户。
    </div>
    <div id="llm-content" class="section-body">加载中...</div>`;
  document.getElementById('btn-add-llm').addEventListener('click', () => showLlmModal());
  await loadLlmProviders();
}

async function loadLlmProviders() {
  try {
    const res = await API.get('/api/admin/llm/providers');
    const data = await res.json();
    const list = data.providers || [];
    if (!list.length) {
      document.getElementById('llm-content').innerHTML = `
        <div class="llm-empty">
          <p>尚未配置任何大模型</p>
          <p>点击右上角「添加大模型」开始配置</p>
        </div>`;
      return;
    }
    document.getElementById('llm-content').innerHTML = `
      <table class="data-table">
        <thead><tr><th>名称</th><th>提供商</th><th>模型</th><th>Base URL</th><th>API Key</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          ${list.map(p => `<tr>
            <td><strong>${esc(p.name)}</strong>${p.is_default ? ' <span class="badge badge-info">默认</span>' : ''}</td>
            <td>${esc(p.provider)}</td>
            <td>${esc(p.model)}</td>
            <td class="td-ellipsis">${esc(p.base_url)}</td>
            <td>${p.has_key ? '<span class="badge badge-success">已设置</span>' : '<span class="badge badge-danger">未设置</span>'}</td>
            <td>${p.enabled ? '<span class="badge badge-success">启用</span>' : '<span class="badge badge-danger">禁用</span>'}</td>
            <td class="td-actions">
              <button class="btn btn-secondary btn-icon" data-action="testLlmProvider" data-provider-id="${p.id}" title="测试连通">${ICONS.refresh}</button>
              <button class="btn btn-secondary btn-icon" data-action="editLlmProvider" data-provider-id="${p.id}" title="编辑">${ICONS.edit}</button>
              <button class="btn btn-danger btn-icon" data-action="deleteLlmProvider" data-provider-id="${p.id}" data-name="${esc(p.name)}" title="删除">${ICONS.trash}</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch {
    const el = document.getElementById('llm-content');
    if (el) el.innerHTML = '<p>加载失败</p>';
  }
}

function showLlmModal(id) {
  const isEdit = !!id;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-wide">
      <h3>${isEdit ? '编辑大模型' : '添加大模型'}</h3>
      <div class="form-group">
        <label>名称</label>
        <input type="text" id="llm-name" class="form-input" placeholder="如：DeepSeek 生产环境">
      </div>
      <div class="form-group">
        <label>提供商类型</label>
        <select id="llm-provider-type" class="form-input">
          <option value="deepseek">DeepSeek</option>
          <option value="openai">OpenAI</option>
          <option value="custom">自定义（OpenAI 兼容）</option>
        </select>
      </div>
      <div class="form-group">
        <label>API Key${isEdit ? '（留空则不修改）' : ''}</label>
        <input type="password" id="llm-api-key" class="form-input" placeholder="sk-...">
      </div>
      <div class="form-group">
        <label>Base URL</label>
        <input type="text" id="llm-base-url" class="form-input" placeholder="https://api.deepseek.com">
      </div>
      <div class="form-group">
        <label>模型名称</label>
        <input type="text" id="llm-model" class="form-input" placeholder="deepseek-chat">
      </div>
      <div style="display:flex;gap:16px;margin-bottom:16px">
        <label class="checkbox-label">
          <input type="checkbox" id="llm-enabled" checked> 启用
        </label>
        <label class="checkbox-label">
          <input type="checkbox" id="llm-default"> 设为默认
        </label>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-secondary" id="llm-cancel">取消</button>
        <button class="btn btn-primary" id="llm-save">保存</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // 如果是编辑，加载现有数据（加载完成前禁用保存，避免用表单默认值覆盖原配置）
  if (isEdit) {
    const saveBtn = document.getElementById('llm-save');
    saveBtn.disabled = true;
    API.get('/api/admin/llm/providers').then(async res => {
      const data = await res.json();
      if (!overlay.isConnected) return;  // 模态框已关闭，无需回填
      const p = (data.providers || []).find(x => x.id === id);
      if (p) {
        document.getElementById('llm-name').value = p.name;
        document.getElementById('llm-provider-type').value = p.provider;
        document.getElementById('llm-base-url').value = p.base_url;
        document.getElementById('llm-model').value = p.model;
        document.getElementById('llm-enabled').checked = p.enabled;
        document.getElementById('llm-default').checked = p.is_default;
      }
      saveBtn.disabled = false;
    }).catch(() => {
      if (overlay.isConnected) { overlay.remove(); toast('加载配置失败，请重试', 'error'); }
    });
  }

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('llm-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('llm-save').addEventListener('click', async () => {
    const body = {
      name: document.getElementById('llm-name').value.trim(),
      provider: document.getElementById('llm-provider-type').value,
      api_key: document.getElementById('llm-api-key').value.trim(),
      base_url: document.getElementById('llm-base-url').value.trim(),
      model: document.getElementById('llm-model').value.trim(),
      enabled: document.getElementById('llm-enabled').checked,
      is_default: document.getElementById('llm-default').checked,
    };
    if (!body.name) { toast('名称不能为空', 'error'); return; }
    if (!isEdit && !body.api_key) { toast('API Key 不能为空', 'error'); return; }
    if (!body.model) { toast('模型名称不能为空', 'error'); return; }
    const saveBtn = document.getElementById('llm-save');
    saveBtn.disabled = true;  // 防止重复提交导致重复创建
    try {
      const res = isEdit
        ? await API.put(`/api/admin/llm/providers/${id}`, body)
        : await API.post('/api/admin/llm/providers', body);
      if (res.ok) {
        toast(isEdit ? '大模型已更新' : '大模型已添加', 'success');
        overlay.remove();
        loadLlmProviders();
      } else {
        const d = await res.json().catch(() => ({}));
        toast(d.detail || '保存失败', 'error');
      }
    } catch {
      toast('保存失败，请检查网络', 'error');
    } finally {
      if (overlay.isConnected) saveBtn.disabled = false;
    }
  });
}

async function editLlmProvider(id) { showLlmModal(id); }
window.editLlmProvider = editLlmProvider;

async function deleteLlmProvider(id, name) {
  const ok = await confirm({
    title: '删除大模型', danger: true, confirmText: '删除',
    body: `确定删除大模型「${name}」？已分配此模型的用户将回退到默认模型。`,
  });
  if (!ok) return;
  const res = await API.del(`/api/admin/llm/providers/${id}`);
  if (res.ok) { toast('大模型已删除', 'success'); loadLlmProviders(); }
  else { const d = await res.json(); toast(d.detail || '删除失败', 'error'); }
}
window.deleteLlmProvider = deleteLlmProvider;

async function testLlmProvider(id) {
  toast('正在测试连通性...', 'info', 5000);
  try {
    const res = await API.post(`/api/admin/llm/providers/${id}/test`);
    const d = await res.json();
    if (d.ok) toast(`连通成功，模型回复：${d.reply || '(空)'}`, 'success', 5000);
    else toast(`连通失败：${d.error || '未知错误'}`, 'error', 5000);
  } catch {
    toast('连通测试请求失败，请检查网络或后端服务', 'error', 5000);
  }
}
window.testLlmProvider = testLlmProvider;

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
          <select id="set-register" class="form-input form-max">
            <option value="true" ${s.allow_register === 'true' ? 'selected' : ''}>开放注册</option>
            <option value="false" ${s.allow_register !== 'true' ? 'selected' : ''}>关闭注册（仅管理员创建）</option>
          </select>
        </div>
        <div class="form-group">
          <label>新用户默认配额 (MB，0=无限)</label>
          <input type="number" id="set-quota" class="form-input form-max" value="${s.default_quota_mb}">
        </div>
      </div>
      <div class="settings-section settings-group-gap">
        <h3>阿里云短信（登录 / 注册 / 找回）</h3>
        <p style="opacity:.7;font:12px/1.5 system-ui;margin:0 0 12px">未配置时登录注册回退为纯密码流程。AccessKey 在服务端 Fernet 加密落盘。</p>
        <div class="form-group">
          <label>启用短信</label>
          <select id="set-sms-enabled" class="form-input form-max">
            <option value="true" ${s.sms_enabled === 'true' ? 'selected' : ''}>启用</option>
            <option value="false" ${s.sms_enabled !== 'true' ? 'selected' : ''}>关闭</option>
          </select>
        </div>
        <div class="form-group">
          <label>AccessKeyId</label>
          <input id="set-sms-ak-id" class="form-input form-max" value="${esc(s.sms_aliyun_access_key_id || '')}" placeholder="RAM 子账号 AccessKeyId">
        </div>
        <div class="form-group">
          <label>AccessKeySecret</label>
          <input id="set-sms-ak-secret" type="password" class="form-input form-max" placeholder="${s.sms_aliyun_access_key_secret_masked ? '已设置（留空则不修改）' : 'RAM 子账号 AccessKeySecret'}">
        </div>
        <div class="form-group">
          <label>短信签名</label>
          <input id="set-sms-sign" class="form-input form-max" value="${esc(s.sms_aliyun_sign_name || '')}" placeholder="如：随行档">
        </div>
        <div class="form-group">
          <label>模板 CODE</label>
          <input id="set-sms-tpl" class="form-input form-max" value="${esc(s.sms_aliyun_template_code || '')}" placeholder="如：SMS_123456789">
        </div>
        <div class="form-group">
          <label>模板变量名</label>
          <input class="form-input form-max" value="code（默认，一般无需修改）" disabled style="opacity:.6">
        </div>
        <div class="form-group">
          <label>强制登录需短信</label>
          <select id="set-sms-req-login" class="form-input form-max">
            <option value="true" ${s.sms_required_for_login === 'false' ? '' : 'selected'}>是</option>
            <option value="false" ${s.sms_required_for_login === 'false' ? 'selected' : ''}>否</option>
          </select>
        </div>
        <div class="form-group">
          <label>强制注册需短信</label>
          <select id="set-sms-req-register" class="form-input form-max">
            <option value="true" ${s.sms_required_for_register === 'false' ? '' : 'selected'}>是</option>
            <option value="false" ${s.sms_required_for_register === 'false' ? 'selected' : ''}>否</option>
          </select>
        </div>
        <div class="form-group">
          <label>验证码有效期（秒，60-3600）</label>
          <input type="number" id="set-sms-ttl" class="form-input form-max" value="${s.sms_code_ttl_seconds || 300}" min="60" max="3600">
        </div>
        <div class="form-group">
          <label>单码最多错误次数（3-10）</label>
          <input type="number" id="set-sms-max" class="form-input form-max" value="${s.sms_max_attempts || 5}" min="3" max="10">
        </div>
        <div class="form-group">
          <label>同手机号重发间隔（秒，30-300）</label>
          <input type="number" id="set-sms-cooldown" class="form-input form-max" value="${s.sms_cooldown_seconds || 60}" min="30" max="300">
        </div>
        <div class="form-group">
          <label>单手机号日上限（5-100）</label>
          <input type="number" id="set-sms-daily" class="form-input form-max" value="${s.sms_daily_limit_per_phone || 20}" min="5" max="100">
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn btn-primary" id="btn-save-settings">保存设置</button>
          <button class="btn btn-secondary" id="btn-test-sms">发送测试短信</button>
          <span id="test-sms-status" style="font:12px system-ui;opacity:.7"></span>
        </div>
      </div>
      <div class="settings-section settings-group-gap">
        <h3>系统信息</h3>
        <table class="info-table">
          <tr><td>应用版本</td><td>${si.app_version}</td></tr>
          <tr><td>Python 版本</td><td>${si.python_version}</td></tr>
          <tr><td>运行平台</td><td>${si.platform}</td></tr>
          <tr><td>存储目录</td><td>${si.storage_dir}</td></tr>
          <tr><td>数据库路径</td><td>${si.database_path}</td></tr>
          <tr><td>LLM 提供商</td><td>${si.llm_provider}</td></tr>
          <tr><td>LLM 模型</td><td>${si.llm_model}</td></tr>
          <tr><td>已启用模型数</td><td>${si.llm_count ?? '-'}</td></tr>
        </table>
      </div>`;
    document.getElementById('btn-save-settings').addEventListener('click', async () => {
      const secret = document.getElementById('set-sms-ak-secret').value;
      const body = {
        allow_register: document.getElementById('set-register').value === 'true',
        default_quota_mb: parseInt(document.getElementById('set-quota').value || '0'),
        sms_enabled: document.getElementById('set-sms-enabled').value === 'true',
        sms_aliyun_access_key_id: document.getElementById('set-sms-ak-id').value.trim(),
        sms_aliyun_sign_name: document.getElementById('set-sms-sign').value.trim(),
        sms_aliyun_template_code: document.getElementById('set-sms-tpl').value.trim(),
        sms_required_for_login: document.getElementById('set-sms-req-login').value === 'true',
        sms_required_for_register: document.getElementById('set-sms-req-register').value === 'true',
        sms_code_ttl_seconds: parseInt(document.getElementById('set-sms-ttl').value || '300'),
        sms_max_attempts: parseInt(document.getElementById('set-sms-max').value || '5'),
        sms_cooldown_seconds: parseInt(document.getElementById('set-sms-cooldown').value || '60'),
        sms_daily_limit_per_phone: parseInt(document.getElementById('set-sms-daily').value || '20'),
      };
      if (secret && secret !== '****') body.sms_aliyun_access_key_secret = secret;
      const res = await API.put('/api/admin/settings', body);
      if (res.ok) toast('设置已保存', 'success');
      else { const d = await res.json(); toast(d.detail || '保存失败', 'error'); }
    });
    document.getElementById('btn-test-sms').addEventListener('click', async () => {
      const phone = prompt('输入接收测试短信的手机号：');
      if (!phone) return;
      const st = document.getElementById('test-sms-status');
      st.textContent = '发送中...';
      try {
        const res = await API.post('/api/admin/settings/sms/test', { phone });
        const d = await res.ok ? await res.json() : { detail: (await res.json()).detail };
        if (res.ok) { st.textContent = `✓ ${d.message || '已发送'}`; st.style.color = 'var(--success, #2e7d32)'; }
        else { st.textContent = `✗ ${d.detail || '失败'}`; st.style.color = 'var(--danger, #c62828)'; }
      } catch (e) { st.textContent = `✗ ${e.message || '网络错误'}`; st.style.color = 'var(--danger, #c62828)'; }
    });
  } catch { document.getElementById('settings-content').innerHTML = '<p>加载失败</p>'; }
}

// ============ Account ============
async function renderAccount() {
  document.getElementById('admin-main').innerHTML = `
    <div class="admin-topbar"><h2>账户</h2></div>
    <div id="account-content">加载中...</div>`;
  try {
    const res = await API.get('/api/admin/me');
    const me = await res.json();
    document.getElementById('account-content').innerHTML = `
      <div class="settings-section" style="max-width:460px">
        <h3>管理员信息</h3>
        <table class="info-table">
          <tr><td>用户名</td><td>${esc(me.username)}</td></tr>
          <tr><td>角色</td><td>管理员</td></tr>
        </table>
      </div>
      <div class="settings-section settings-group-gap" style="max-width:460px">
        <div class="admin-setting-head">
          <div>
            <h3 style="margin:0">修改密码</h3>
            <p class="admin-setting-desc">修改后当前会话保持有效，下次登录需使用新密码</p>
          </div>
          <button class="btn btn-primary" id="btn-admin-change-pwd">${ICONS.lock}<span style="margin-left:6px">修改密码</span></button>
        </div>
      </div>`;
    document.getElementById('btn-admin-change-pwd').addEventListener('click', () => showAdminChangePasswordDialog(me.username));
  } catch { document.getElementById('account-content').innerHTML = '<p>加载失败</p>'; }
}

// 修改密码弹窗：与用户端共用 utils/password-dialog.js 接线层（D14：消灭复制漂移）。
// 弹窗壳仍用管理端自有的 modal-overlay（admin 无 openModal），但 busy 期间 Esc 不可撤销。
function showAdminChangePasswordDialog(username) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h3>修改密码</h3>
      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px">修改后当前会话保持有效，下次登录需使用新密码。</p>
      ${changePasswordFormHTML()}
      <div class="modal-actions">
        <button class="btn btn-secondary" id="acp-cancel">取消</button>
        <button class="btn btn-primary" id="acp-submit" disabled>修改密码</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => { document.removeEventListener('keydown', esc); overlay.remove(); };
  let ctl = null;
  // 在途请求期间 Esc 不可撤销（后端可能已执行变更）
  const esc = (e) => { if (e.key === 'Escape' && !(ctl && ctl.isBusy())) close(); };
  document.addEventListener('keydown', esc);
  overlay.addEventListener('click', (e) => { if (e.target === overlay && !(ctl && ctl.isBusy())) close(); });
  overlay.querySelector('#acp-cancel').addEventListener('click', close);

  ctl = wireChangePasswordForm(overlay, {
    username,  // 真实管理员用户名：激活「不与用户名相同」校验与强度罚分（D7）
    eyeIcon: ICONS.eye,
    eyeOffIcon: ICONS.eyeOff,
    submitBtn: overlay.querySelector('#acp-submit'),
    onSubmit: async (oldPwd, newPwd) => {
      try {
        const res = await API.put('/api/admin/me/password', { old_password: oldPwd, new_password: newPwd });
        const d = await res.json().catch(() => ({}));
        if (res.ok) return { ok: true };
        return { ok: false, status: res.status, detail: (d && d.detail) || '修改失败' };
      } catch { return { ok: false, status: 0, detail: '网络错误，请重试' }; }
    },
    onSuccess: () => { close(); toast('密码已修改', 'success'); },
  });
}

// ============ Logs ============
async function renderLogs() {
  document.getElementById('admin-main').innerHTML = `
    <div class="admin-topbar">
      <h2>审计日志</h2>
      <div class="admin-spacer"></div>
      <div class="search-box">${ICONS.search}<input type="text" id="log-search" placeholder="搜索操作类型..." class="search-input" style="width:160px"></div>
    </div>
    <div id="logs-content">加载中...</div>`;
  let st;
  document.getElementById('log-search').addEventListener('input', (e) => {
    clearTimeout(st); st = setTimeout(() => loadLogs(e.target.value, 1), 300);
  });
  await loadLogs('');
}

async function loadLogs(action, page) {
  page = page || 1;
  pager.logs.page = page;
  try {
    let url = `/api/admin/logs?page=${page}&page_size=${pager.logs.pageSize}`;
    if (action) url += `&action=${encodeURIComponent(action)}`;
    const res = await API.get(url);
    const data = await res.json();
    pager.logs.total = data.total || 0;
    document.getElementById('logs-content').innerHTML = `
      <table class="data-table">
        <thead><tr><th>时间</th><th>用户</th><th>操作</th><th>详情</th><th>IP</th></tr></thead>
        <tbody>
          ${data.logs.map(l => `<tr>
            <td class="td-meta">${l.time.split('.')[0]}</td>
            <td>${esc(l.username)}</td>
            <td><span class="badge ${l.action.includes('fail') || l.action.includes('delete') ? 'badge-danger' : 'badge-success'}">${esc(actionLabel(l.action))}</span></td>
            <td class="td-detail">${esc(l.detail) || '-'}</td>
            <td class="td-meta">${l.ip || '-'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${paginationHTML('logs', 'goLogsPage')}`;
  } catch { document.getElementById('logs-content').innerHTML = '<p>加载失败</p>'; }
}

// ============ 分页跳转 ============
function goUsersPage(page) { loadUsers(document.getElementById('user-search') ? document.getElementById('user-search').value : '', page); }
function goFilesPage(page) { loadFiles(document.getElementById('file-search') ? document.getElementById('file-search').value : '', page); }
function goGroupsPage(page) { loadGroups(document.getElementById('group-search') ? document.getElementById('group-search').value : '', page); }
function goLogsPage(page) { loadLogs(document.getElementById('log-search') ? document.getElementById('log-search').value : '', page); }
window.goUsersPage = goUsersPage;
window.goFilesPage = goFilesPage;
window.goGroupsPage = goGroupsPage;
window.goLogsPage = goLogsPage;

// ============ Init ============
async function init() {
  // 登录态由 cookie 决定：探测 /api/admin/me，失败回登录页（用裸 fetch，避免 401 触发 reload 循环）
  try {
    const res = await fetch('/api/admin/me');
    if (!res.ok) { renderLogin(); return; }
  } catch { renderLogin(); return; }
  renderLayout();
  navigate('dashboard');
}

init();
