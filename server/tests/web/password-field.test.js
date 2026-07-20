// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { capsLockFromEvent, mountPasswordField } from '../../app/web/assets/utils/password-field.js';

// jsdom 无真实键盘修饰键状态：用 defineProperty 覆写 getModifierState 精确控制输入。
function keyEvent(capsOn) {
  const ev = new KeyboardEvent('keydown');
  Object.defineProperty(ev, 'getModifierState', { value: (k) => k === 'CapsLock' && capsOn });
  return ev;
}

describe('capsLockFromEvent', () => {
  it('CapsLock 开 → true，关 → false', () => {
    expect(capsLockFromEvent(keyEvent(true))).toBe(true);
    expect(capsLockFromEvent(keyEvent(false))).toBe(false);
  });

  it('事件不支持 getModifierState → null（调用方据此不展示提示）', () => {
    expect(capsLockFromEvent({})).toBeNull();
    expect(capsLockFromEvent(null)).toBeNull();
  });

  it('getModifierState 抛错 → null（探测失败不影响输入）', () => {
    const ev = { getModifierState() { throw new Error('boom'); } };
    expect(capsLockFromEvent(ev)).toBeNull();
  });
});

describe('mountPasswordField', () => {
  let input;
  beforeEach(() => {
    document.body.innerHTML = '<div class="form-group"><input type="password" id="pwd" class="form-input"></div>';
    input = document.getElementById('pwd');
  });

  it('包裹原 input 并生成眼睛按钮 + CapsLock 提示（原 id/值不变）', () => {
    input.value = 'secret123';
    const r = mountPasswordField(input);
    expect(r).toBeTruthy();
    expect(input.id).toBe('pwd');
    expect(input.value).toBe('secret123');
    expect(input.parentElement.classList.contains('pwd-field-inner')).toBe(true);
    expect(r.toggle.getAttribute('data-action')).toBe('toggle-pwd-visibility');
    expect(r.caps.hidden).toBe(true);
  });

  it('点击眼睛：password ↔ text 切换，aria-label 同步，焦点回到输入框', () => {
    const { toggle } = mountPasswordField(input, { eyeIcon: '<svg>eye</svg>', eyeOffIcon: '<svg>off</svg>' });
    toggle.click();
    expect(input.type).toBe('text');
    expect(toggle.getAttribute('aria-label')).toBe('隐藏密码');
    expect(toggle.classList.contains('is-on')).toBe(true);
    expect(document.activeElement).toBe(input);
    toggle.click();
    expect(input.type).toBe('password');
    expect(toggle.getAttribute('aria-label')).toBe('显示密码');
  });

  it('CapsLock 开启时按键 → 提示出现；关闭/失焦 → 提示隐藏', () => {
    const { caps } = mountPasswordField(input);
    input.focus();
    input.dispatchEvent(keyEvent(true));
    expect(caps.hidden).toBe(false);
    input.dispatchEvent(keyEvent(false));
    expect(caps.hidden).toBe(true);
    // 再开后失焦：隐藏
    input.dispatchEvent(keyEvent(true));
    expect(caps.hidden).toBe(false);
    input.dispatchEvent(new Event('blur'));
    expect(caps.hidden).toBe(true);
  });

  it('幂等：重复挂载返回 null，不叠加包裹层', () => {
    const first = mountPasswordField(input);
    const second = mountPasswordField(input);
    expect(first).toBeTruthy();
    expect(second).toBeNull();
    expect(document.querySelectorAll('.pwd-field').length).toBe(1);
  });

  it('空 input → null（防御性）', () => {
    expect(mountPasswordField(null)).toBeNull();
  });
});
