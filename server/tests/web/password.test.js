import { describe, it, expect } from 'vitest';
import { validatePasswordClient, scorePasswordStrength } from '../../app/web/assets/utils/password.js';

// 客户端结构校验镜像 server/app/core/security.py validate_password：
// 长度 ≥8 / 不与用户名相同（弱口令名单在服务端，客户端不测）。
describe('validatePasswordClient', () => {
  it('空密码 → 提示输入', () => {
    expect(validatePasswordClient('')).toBe('请输入新密码');
    expect(validatePasswordClient(null)).toBe('请输入新密码');
  });

  it('少于 8 位 → 长度提示（与 security.py 文案一致）', () => {
    expect(validatePasswordClient('Ab1!xy')).toBe('密码至少 8 个字符');
    expect(validatePasswordClient('1234567')).toBe('密码至少 8 个字符');
  });

  it('8 位达标 → 通过', () => {
    expect(validatePasswordClient('12345678')).toBeNull();
  });

  it('与用户名相同（大小写不敏感）→ 拒绝', () => {
    expect(validatePasswordClient('zhangsan', 'ZhangSan')).toBe('密码不能与用户名相同');
    expect(validatePasswordClient('admin123', 'ADMIN123')).toBe('密码不能与用户名相同');
  });

  it('无用户名上下文时不做用户名比较', () => {
    expect(validatePasswordClient('whatever123')).toBeNull();
  });
});

describe('scorePasswordStrength', () => {
  it('空 → level 0 无标签', () => {
    expect(scorePasswordStrength('')).toEqual({ level: 0, label: '' });
  });

  it('不足 8 位无论多复杂都是弱', () => {
    expect(scorePasswordStrength('aA1!bB').level).toBe(1);
    expect(scorePasswordStrength('aA1!bB').label).toBe('弱');
  });

  it('等于用户名 → 弱', () => {
    expect(scorePasswordStrength('zhangsan', 'zhangsan').level).toBe(1);
  });

  it('8 位纯小写 → 弱档（单一字符类）', () => {
    expect(scorePasswordStrength('abcdefgh').level).toBe(1);
  });

  it('8 位小写+数字 → 中档', () => {
    const r = scorePasswordStrength('abcd1234');
    expect(r.level).toBe(2);
    expect(r.label).toBe('中');
  });

  it('12 位以上 + 三类字符 → 强', () => {
    const r = scorePasswordStrength('Abcdef123456');
    expect(r.level).toBe(3);
    expect(r.label).toBe('强');
  });

  it('四类字符齐全的长密码 → 强', () => {
    expect(scorePasswordStrength('Abc123!@#xyz').level).toBe(3);
  });

  it('包含用户名降档：本可评强，含用户名后降为中', () => {
    const base = scorePasswordStrength('Xy9!Xy9!Xy9!');      // 无用户名 → 强
    const withName = scorePasswordStrength('Xy9!admin!9yX', 'admin'); // 含用户名降一档
    expect(base.level).toBe(3);
    expect(withName.level).toBeLessThan(base.level);
  });
});
