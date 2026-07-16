// Token 状态显示工具（从 app.js 抽离，行为不变）
// 依赖 parseServerTs（过期判断）、formatDateTime（过期时间显示）。
import { parseServerTs } from './time.js';
import { formatDateTime } from './format.js';

export function isTokenActive(t) {
  if (t.revoked) return false;
  if (t.expires_at && parseServerTs(t.expires_at) < Date.now()) return false;
  return true;
}
export function tokenStatusBadge(t) {
  if (t.revoked) return '<span class="badge badge-danger">已吊销</span>';
  if (t.expires_at && parseServerTs(t.expires_at) < Date.now()) return '<span class="badge badge-danger">已过期</span>';
  return '<span class="badge badge-success">有效</span>';
}
export function tokenKindBadge(t) {
  return t.kind === 'session'
    ? '<span class="badge badge-info">浏览器会话</span>'
    : '<span class="badge badge-info">设备令牌</span>';
}
export function tokenExpiryText(t) {
  if (!t.expires_at) return '永久';
  return formatDateTime(t.expires_at);
}
