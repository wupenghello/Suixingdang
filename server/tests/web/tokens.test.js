import { describe, it, expect } from 'vitest';
import {
  isTokenActive,
  tokenStatusBadge,
  tokenKindBadge,
  tokenExpiryText,
} from '../../app/web/assets/utils/tokens.js';

// 依赖 parseServerTs（过期判断）、formatDateTime（过期显示）。
// 过期判断用固定年份（2020 已过 / 2099 未到），与运行日期无关，稳定。

describe('isTokenActive', () => {
  it('revoked → false', () => {
    expect(isTokenActive({ revoked: true })).toBe(false);
  });
  it('已过期 → false', () => {
    expect(isTokenActive({ revoked: false, expires_at: '2020-01-01T00:00:00' })).toBe(false);
  });
  it('有效（无过期或未来过期）→ true', () => {
    expect(isTokenActive({ revoked: false })).toBe(true);
    expect(isTokenActive({ revoked: false, expires_at: '2099-01-01T00:00:00' })).toBe(true);
  });
});

describe('tokenStatusBadge', () => {
  it('revoked → 已吊销（badge-danger）', () => {
    const out = tokenStatusBadge({ revoked: true });
    expect(out).toContain('已吊销');
    expect(out).toContain('badge-danger');
  });
  it('已过期 → 已过期（badge-danger）', () => {
    const out = tokenStatusBadge({ revoked: false, expires_at: '2020-01-01T00:00:00' });
    expect(out).toContain('已过期');
    expect(out).toContain('badge-danger');
  });
  it('有效 → 有效（badge-success）', () => {
    const out = tokenStatusBadge({ revoked: false });
    expect(out).toContain('有效');
    expect(out).toContain('badge-success');
  });
});

describe('tokenKindBadge', () => {
  it('session → 浏览器会话', () => {
    expect(tokenKindBadge({ kind: 'session' })).toContain('浏览器会话');
  });
  it('非 session → 设备令牌', () => {
    expect(tokenKindBadge({ kind: 'device' })).toContain('设备令牌');
  });
});

describe('tokenExpiryText', () => {
  it('无 expires_at → 永久', () => {
    expect(tokenExpiryText({})).toBe('永久');
  });
  it('有 expires_at → 格式化日期（含年份）', () => {
    const out = tokenExpiryText({ expires_at: '2026-07-16T12:00:00' });
    expect(typeof out).toBe('string');
    expect(out).toMatch(/2026/);
  });
});
