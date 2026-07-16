import { describe, it, expect } from 'vitest';
import { formatSize, formatDate, formatDateTime } from '../../app/web/assets/utils/format.js';

describe('formatSize', () => {
  it('falsy 输入（0 / null / undefined）→ -', () => {
    expect(formatSize(0)).toBe('-');
    expect(formatSize(null)).toBe('-');
    expect(formatSize(undefined)).toBe('-');
  });

  it('已知边界：负数未被 !bytes 拦截，产生 "NaN undefined"（非法输入，非本次修复范围，记录真实行为）', () => {
    // formatSize 契约为字节大小（非负）；原代码 if(!bytes) 只挡 falsy 不挡负数。
    expect(formatSize(-1)).toBe('NaN undefined');
  });

  it('量级正确', () => {
    expect(formatSize(1024)).toBe('1 KB');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(1048576)).toBe('1 MB');
    expect(formatSize(1073741824)).toBe('1 GB');
    expect(formatSize(1099511627776)).toBe('1 TB');
  });

  it('B 级原样 + 小数保留 1 位', () => {
    expect(formatSize(500)).toBe('500 B');
    expect(formatSize(1023)).toBe('1023 B');
  });
});

// formatDate / formatDateTime 依赖 toLocaleDateString/toLocaleString('zh-CN')，
// 输出含 ICU locale 细节（分隔符/空格随 Node 版本），故只断言「不抛错 + 含关键数字」，
// 不断言精确字符串，避免跨机器/CI 的假阴性。

describe('formatDate', () => {
  it('空值 → 空串', () => {
    expect(formatDate(0)).toBe('');
    expect(formatDate(null)).toBe('');
    expect(formatDate('')).toBe('');
  });

  it('合法日期返回非空且含月份（用月断言避免时区漂移）', () => {
    // 2026-07-16 在任何时区都是 7 月（日号会随时区 ±1，但月不变），故断言 /7月/ 而非 /16/
    const out = formatDate('2026-07-16T12:00:00Z');
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
    expect(out).toMatch(/7月/);
  });

  it('数字秒级时间戳（×1000 后格式化，覆盖 number 分支）', () => {
    // 1752676800 = 2026-07-16 12:00:00 UTC 的秒级时间戳；断言月避免时区漂移
    const out = formatDate(1752676800);
    expect(typeof out).toBe('string');
    expect(out).toMatch(/7月/);
  });
});

describe('formatDateTime', () => {
  it('空值 → 空串', () => {
    expect(formatDateTime(0)).toBe('');
    expect(formatDateTime(null)).toBe('');
    expect(formatDateTime('')).toBe('');
  });

  it('非法字符串原样转义返回', () => {
    // parseServerTs 返回 0 → 走 escapeHtml 分支，原样返回（无特殊字符故不变）
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });

  it('合法 naive 时间戳返回带年份（年稳定，不依赖时区）', () => {
    const out = formatDateTime('2026-07-16 12:00:00');
    expect(typeof out).toBe('string');
    expect(out).toMatch(/2026/);
  });

  it('含 HTML 特殊字符的非法值被转义（防注入到时间显示位）', () => {
    const out = formatDateTime('<x>');
    expect(out).toBe('&lt;x&gt;');
  });
});
