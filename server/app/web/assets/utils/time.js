// 时间解析工具（从 app.js 抽离，行为不变）
// 解析服务器 naive-UTC 时间戳：补 'T' 与 'Z'，统一为合法 Date 字符串后取毫秒。

export function parseServerTs(ts) {
  if (!ts) return 0;
  let s = String(ts);
  if (s.indexOf('T') === -1) s = s.replace(' ', 'T');
  if (!/[+-]\d{2}:?\d{2}$/.test(s) && !s.endsWith('Z')) s += 'Z';
  const d = new Date(s);
  return isNaN(d) ? 0 : d.getTime();
}

// 相对时间（笔记卡片 meta 用）：sec 为秒级 unix 时间戳；now 可注入便于单测。
// <1m 刚刚 / <60m N 分钟前 / <24h N 小时前 / <7d N 天前 / 否则 M月D日（跨年带年份）。
export function formatRelTime(sec, now = Date.now()) {
  const t = Number(sec) * 1000;
  if (!t || isNaN(t)) return '';
  const diff = Math.max(0, now - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return m + ' 分钟前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时前';
  const d = Math.floor(h / 24);
  if (d < 7) return d + ' 天前';
  const dt = new Date(t);
  const md = (dt.getMonth() + 1) + '月' + dt.getDate() + '日';
  return dt.getFullYear() === new Date(now).getFullYear() ? md : dt.getFullYear() + '年' + md;
}
