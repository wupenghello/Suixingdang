// 修改密码表单 · 共享接线层（用户端与管理端改密弹窗共用，消灭双端复制漂移）
//
// 各 SPA 只提供「弹窗壳 + API 调用」，本模块统一负责：
// 实时校验 + 强度条 · IME 组合守卫 · Enter 递进 · busy 防重 ·
// 按状态码路由错误（400=当前密码错 → 当前密码字段；422=策略失败 → 新密码字段）·
// 429 锁定倒计时（锁定期按钮不可点，防拒绝风暴叠审计行）· 零痕迹清值。
import { validatePasswordClient, scorePasswordStrength } from './password.js';
import { mountPasswordField } from './password-field.js';

// 三字段表单 markup（调用方塞进自己的弹窗壳；class 而非 id，允许同页多实例）
export function changePasswordFormHTML() {
  return `
    <div class="form-group">
      <label>当前密码</label>
      <input type="password" class="form-input cpd-old" placeholder="请输入当前密码" autocomplete="current-password">
      <div class="input-error-msg cpd-old-err"></div>
    </div>
    <div class="form-group">
      <label>新密码</label>
      <input type="password" class="form-input cpd-new" placeholder="至少 8 个字符" autocomplete="new-password">
      <div class="pwd-strength cpd-strength" aria-live="polite" hidden>
        <div class="pwd-strength-bar"><i></i></div><span class="pwd-strength-label"></span>
      </div>
      <div class="input-error-msg cpd-new-err"></div>
    </div>
    <div class="form-group">
      <label>确认新密码</label>
      <input type="password" class="form-input cpd-confirm" placeholder="再次输入新密码" autocomplete="new-password">
      <div class="input-error-msg cpd-confirm-err"></div>
    </div>`;
}

// 接线。opts：
//   username   用于「不与用户名相同」校验与强度罚分（管理端传管理员用户名，缺省 '' 跳过）
//   eyeIcon/eyeOffIcon  明文切换图标（可信 SVG 字符串，来自各端 ICONS）
//   submitBtn  确认按钮元素（本模块管它的 disabled / loading / 锁定倒计时文案）
//   submitLabel 按钮常态文案（默认「修改密码」）
//   onSubmit(oldPassword, newPassword) → { ok, status?, detail? }（调用方发起 API）
//   onSuccess(result)  提交成功后回调（调用方在此关窗 + Toast；result 即 onSubmit 的返回）
// 返回 { submit, isBusy, clear }：确认键点击由本模块接管。
export function wireChangePasswordForm(root, { username = '', eyeIcon = '', eyeOffIcon = '', submitBtn, submitLabel = '修改密码', onSubmit, onSuccess }) {
  const oldIn = root.querySelector('.cpd-old');
  const newIn = root.querySelector('.cpd-new');
  const confirmIn = root.querySelector('.cpd-confirm');
  const oldErr = root.querySelector('.cpd-old-err');
  const newErr = root.querySelector('.cpd-new-err');
  const confirmErr = root.querySelector('.cpd-confirm-err');
  const strengthEl = root.querySelector('.cpd-strength');
  [oldIn, newIn, confirmIn].forEach(inp => mountPasswordField(inp, { eyeIcon, eyeOffIcon }));

  let busy = false;
  let locked = false;   // 429 锁定倒计时期间为 true，压制 check() 的重新启用
  let lockTimer = null;

  const setErr = (input, errEl, msg) => {
    errEl.textContent = msg || '';
    input.classList.toggle('error', !!msg);
  };
  const check = () => {
    const newPwdErr = validatePasswordClient(newIn.value, username);
    const confirmOk = !!confirmIn.value && confirmIn.value === newIn.value;
    setErr(newIn, newErr, newIn.value ? newPwdErr : '');
    // 确认框已输入才提示不一致，避免空表单红字满屏
    setErr(confirmIn, confirmErr, confirmIn.value && !confirmOk ? '两次输入的密码不一致' : '');
    const s = scorePasswordStrength(newIn.value, username);
    strengthEl.classList.remove('lvl-1', 'lvl-2', 'lvl-3');
    if (s.level) strengthEl.classList.add('lvl-' + s.level);
    strengthEl.querySelector('.pwd-strength-label').textContent = s.label;
    strengthEl.hidden = !newIn.value;
    submitBtn.disabled = busy || locked || !(!!oldIn.value && !newPwdErr && confirmOk);
  };
  [oldIn, newIn, confirmIn].forEach(inp => inp.addEventListener('input', check));

  // IME 组合守卫：中文用户按 Enter 上屏不触发递进/提交（否则半截密码白烧限流计数）
  const imeGuard = (e) => e.isComposing || e.keyCode === 229;
  oldIn.addEventListener('keydown', (e) => { if (imeGuard(e)) return; if (e.key === 'Enter') { e.preventDefault(); newIn.focus(); } });
  newIn.addEventListener('keydown', (e) => { if (imeGuard(e)) return; if (e.key === 'Enter') { e.preventDefault(); confirmIn.focus(); } });
  confirmIn.addEventListener('keydown', (e) => {
    if (imeGuard(e)) return;
    if (e.key === 'Enter' && !submitBtn.disabled) { e.preventDefault(); submit(); }
  });

  // 429 锁定倒计时：锁定期按钮不可点（防用户反复点击叠 password_change_locked 审计行）
  const startLockdown = (detail) => {
    const m = /(\d+)\s*秒/.exec(detail || '');
    let secs = m ? parseInt(m[1], 10) : 30;
    locked = true;
    check();
    const tick = () => {
      if (secs <= 0 || !submitBtn.isConnected) {
        locked = false;
        submitBtn.textContent = submitLabel;
        check();
        return;
      }
      submitBtn.textContent = `已锁定 ${secs} 秒`;
      secs -= 1;
      lockTimer = setTimeout(tick, 1000);
    };
    tick();
  };

  const clear = () => {
    if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; }
    oldIn.value = ''; newIn.value = ''; confirmIn.value = '';  // 零痕迹
    setErr(oldIn, oldErr, ''); setErr(newIn, newErr, ''); setErr(confirmIn, confirmErr, '');
  };

  async function submit() {
    if (busy || submitBtn.disabled) return false;
    busy = true;
    submitBtn.disabled = true;
    submitBtn.textContent = '修改中…';
    try {
      const r = (await onSubmit(oldIn.value, newIn.value)) || {};
      if (r.ok) { clear(); if (onSuccess) onSuccess(r); return true; }
      // 按状态码路由错误字段，不依赖后端文案字符串匹配：
      // 400=当前密码错（步骤验证唯一失败原因）→ 当前密码字段；
      // 422=新密码策略失败 → 新密码字段；429=限流锁定 → 倒计时。
      const detail = r.detail || '修改失败';
      if (r.status === 429) { startLockdown(detail); }
      else if (r.status === 400) { setErr(oldIn, oldErr, detail); oldIn.focus(); }
      else { setErr(newIn, newErr, detail); newIn.focus(); }
      return false;
    } catch {
      setErr(oldIn, oldErr, '网络错误，请重试');
      return false;
    } finally {
      busy = false;
      submitBtn.textContent = submitLabel;
      check();  // 失败保留已输值，恢复按钮可用性（locked 时 check 会保持禁用）
    }
  }

  submitBtn.addEventListener('click', () => submit());
  check();
  setTimeout(() => oldIn.focus(), 0);
  return { submit, isBusy: () => busy, clear };
}
