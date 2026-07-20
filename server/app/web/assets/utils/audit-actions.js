// 审计事件词表 · 单一真源
//
// 用户端登录历史（label / 色点 / 分类筛选）与管理端审计日志（label）共用本表。
// 新增审计事件（后端 _log 的 action）只需在此登记一次——此前词表散落在
// app.js 与 admin.js 两份手同步映射里，download_grant 系事件因此长期裸显原文。
//
// category 供用户端登录历史筛选：login=登录 · security=密码/授权/令牌 · file=文件操作。
// 管理端专有事件（admin_*）不进用户端历史（后端按 user_id 过滤，本就看不到）。

export const AUDIT_ACTIONS = {
  // ---- 登录类 ----
  login_success:    { label: '登录成功', cls: 'ok',   category: 'login' },
  login_failed:     { label: '登录失败', cls: 'fail', category: 'login' },
  login_locked:     { label: '登录锁定', cls: 'fail', category: 'login' },
  login_blocked:    { label: '登录被拒（账号禁用）', cls: 'fail', category: 'login' },
  login_new_device: { label: '新设备登录', cls: 'warn', category: 'login' },
  register:         { label: '注册账号', cls: 'ok',   category: 'login' },

  // ---- 安全类：密码 / 步骤验证 / 令牌 / 下载授权 ----
  password_changed:       { label: '修改密码', cls: 'warn', category: 'security' },
  password_reset_success: { label: '重置密码成功', cls: 'warn', category: 'security' },
  password_reset_failed:  { label: '重置密码失败', cls: 'fail', category: 'security' },
  password_reset_locked:  { label: '重置锁定', cls: 'fail', category: 'security' },
  stepup_failed:          { label: '安全验证失败', cls: 'fail', category: 'security' },
  revoke_other_tokens:    { label: '退出其他设备', cls: 'warn', category: 'security' },
  revoke_all_tokens:      { label: '吊销全部令牌', cls: 'warn', category: 'security' },
  download_grant:         { label: '开启临时下载', cls: 'warn', category: 'security' },
  download_grant_failed:  { label: '下载授权失败', cls: 'fail', category: 'security' },
  download_grant_single:  { label: '授权单次下载', cls: 'warn', category: 'security' },
  download_revoke:        { label: '关闭临时下载', cls: 'warn', category: 'security' },

  // ---- 文件操作类 ----
  group_create:    { label: '创建分组', cls: 'ok',   category: 'file' },
  group_rename:    { label: '重命名分组', cls: 'warn', category: 'file' },
  group_delete:    { label: '删除分组', cls: 'fail', category: 'file' },
  file_move_group: { label: '移动到分组', cls: 'warn', category: 'file' },

  // ---- 管理端事件（管理端审计日志展示；用户端历史不出现）----
  admin_login_success:          { label: '管理员登录', cls: 'ok',   category: 'admin' },
  admin_login_failed:           { label: '管理员登录失败', cls: 'fail', category: 'admin' },
  admin_login_locked:           { label: '管理员登录锁定', cls: 'fail', category: 'admin' },
  admin_password_change:        { label: '管理员修改密码', cls: 'warn', category: 'admin' },
  admin_password_change_failed: { label: '管理员修改密码失败', cls: 'fail', category: 'admin' },
  admin_create_user:            { label: '创建用户', cls: 'ok',   category: 'admin' },
  admin_update_user:            { label: '修改用户', cls: 'warn', category: 'admin' },
  admin_delete_user:            { label: '删除用户', cls: 'fail', category: 'admin' },
  admin_create_token:           { label: '创建令牌', cls: 'ok',   category: 'admin' },
  admin_revoke_token:           { label: '吊销令牌', cls: 'warn', category: 'admin' },
  admin_revoke_all_tokens:      { label: '全部吊销令牌', cls: 'warn', category: 'admin' },
  admin_update_settings:        { label: '修改系统设置', cls: 'warn', category: 'admin' },
  admin_delete_group:           { label: '管理员删除分组', cls: 'fail', category: 'admin' },
  admin_create_llm:             { label: '创建大模型', cls: 'ok',   category: 'admin' },
  admin_update_llm:             { label: '修改大模型', cls: 'warn', category: 'admin' },
  admin_delete_llm:             { label: '删除大模型', cls: 'fail', category: 'admin' },
  admin_update_ai:              { label: '修改 AI 设置', cls: 'warn', category: 'admin' },
  admin_trash_purge:            { label: '清空回收站', cls: 'fail', category: 'admin' },
};

// 未登记事件回落显示原始 action（永不报错；词表缺登记由此可见）
export function auditLabel(action) {
  const m = AUDIT_ACTIONS[action];
  return m ? m.label : action;
}

export function auditCls(action) {
  const m = AUDIT_ACTIONS[action];
  return m ? m.cls : '';
}

export function auditCategory(action) {
  const m = AUDIT_ACTIONS[action];
  return m ? m.category : '';
}
