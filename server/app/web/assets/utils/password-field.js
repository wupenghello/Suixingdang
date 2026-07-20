// 密码输入框增强：明文切换（眼睛按钮）+ CapsLock 大写锁定提示。
//
// 装饰器模式：mountPasswordField(input) 包裹既有 <input>，不改其 id/name/表单语义，
// 可在任意密码框（登录/改密/下载授权/步骤验证）上复用。
// CSP 合规：按钮事件走 addEventListener + data-action 标记，无内联处理器。

// 从键盘事件读取 CapsLock 状态。环境不支持 getModifierState 时返回 null（调用方不展示提示）。
export function capsLockFromEvent(e) {
  try {
    if (e && typeof e.getModifierState === 'function') return !!e.getModifierState('CapsLock');
  } catch { /* 吞掉异常：提示是锦上添花，不能因探测失败影响输入 */ }
  return null;
}

// 装饰一个密码输入框，返回 { wrap, toggle, caps }。
// eyeIcon / eyeOffIcon 为可信 SVG 字符串（由调用方从 ICONS 传入）；缺省用文字兜底。
// 重复挂载幂等（dataset.pwdMounted 守卫），避免章节重渲染时叠加。
export function mountPasswordField(input, { eyeIcon = '', eyeOffIcon = '' } = {}) {
  if (!input || input.dataset.pwdMounted === '1') return null;
  input.dataset.pwdMounted = '1';

  const wrap = document.createElement('div');
  wrap.className = 'pwd-field';
  const inner = document.createElement('div');
  inner.className = 'pwd-field-inner';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(inner);
  inner.appendChild(input);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'pwd-eye';
  toggle.setAttribute('data-action', 'toggle-pwd-visibility');
  toggle.setAttribute('aria-label', '显示密码');
  toggle.innerHTML = eyeIcon || '显示';
  inner.appendChild(toggle);

  const caps = document.createElement('div');
  caps.className = 'pwd-capslock';
  caps.hidden = true;
  caps.textContent = '大写锁定已开启';
  wrap.appendChild(caps);

  const syncCaps = (e) => {
    const on = capsLockFromEvent(e);
    if (on === null) return;
    caps.hidden = !(on && document.activeElement === input);
  };
  toggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.classList.toggle('is-on', show);
    toggle.innerHTML = show ? (eyeOffIcon || '隐藏') : (eyeIcon || '显示');
    toggle.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
    input.focus();
  });
  input.addEventListener('keydown', syncCaps);
  input.addEventListener('keyup', syncCaps);
  input.addEventListener('blur', () => { caps.hidden = true; });

  return { wrap, toggle, caps };
}
