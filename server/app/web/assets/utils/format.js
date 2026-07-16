// 格式化工具（从 app.js 抽离，行为不变）
import { parseServerTs } from './time.js';
import { escapeHtml } from './dom.js';

export function formatSize(bytes) {
  if (!bytes) return '-';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(typeof ts === 'number' ? ts * 1000 : ts);
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export function formatDateTime(ts) {
  // 复用 parseServerTs 统一服务器 naive-UTC 时间戳的解析逻辑
  const ms = parseServerTs(ts);
  if (!ms) return escapeHtml(ts ? String(ts) : '');
  return new Date(ms).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
