import { describe, it, expect } from 'vitest';
import { AUDIT_ACTIONS, auditLabel, auditCls, auditCategory } from '../../app/web/assets/utils/audit-actions.js';

// 审计词表单一真源（用户端登录历史 + 管理端审计日志共用）。
// 回归 D12：download_grant 系事件此前在两份手同步词表里都缺登记，裸显原文。
describe('AUDIT_ACTIONS', () => {
  it('安全类事件覆盖完整（含 download_grant 系与统一 stepup 词）', () => {
    const security = Object.keys(AUDIT_ACTIONS).filter(a => AUDIT_ACTIONS[a].category === 'security');
    for (const a of ['password_changed', 'stepup_failed', 'revoke_all_tokens', 'revoke_other_tokens',
      'download_grant', 'download_grant_failed', 'download_grant_single', 'download_revoke',
      'password_reset_success', 'password_reset_failed', 'password_reset_locked']) {
      expect(security).toContain(a);
    }
  });

  it('后端实际产生的事件都有登记（抽查）', () => {
    for (const a of ['login_success', 'login_failed', 'login_locked', 'login_blocked', 'login_new_device',
      'register', 'admin_login_success', 'admin_password_change', 'admin_update_user', 'group_create']) {
      expect(AUDIT_ACTIONS[a]).toBeTruthy();
    }
  });

  it('每条登记都有 label / 合法 cls / category', () => {
    for (const [action, m] of Object.entries(AUDIT_ACTIONS)) {
      expect(m.label, action).toBeTruthy();
      expect(['ok', 'warn', 'fail'], action).toContain(m.cls);
      expect(['login', 'security', 'file', 'admin'], action).toContain(m.category);
    }
  });
});

describe('auditLabel / auditCls / auditCategory', () => {
  it('已登记事件返回登记值', () => {
    expect(auditLabel('password_changed')).toBe('修改密码');
    expect(auditCls('stepup_failed')).toBe('fail');
    expect(auditCategory('download_grant_failed')).toBe('security');
  });

  it('未登记事件回落原始 action / 空 cls / 空分类（永不报错）', () => {
    expect(auditLabel('some_future_action')).toBe('some_future_action');
    expect(auditCls('some_future_action')).toBe('');
    expect(auditCategory('some_future_action')).toBe('');
  });
});
