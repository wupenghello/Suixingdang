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
