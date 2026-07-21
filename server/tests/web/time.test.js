import { describe, it, expect } from 'vitest';
import { parseServerTs, formatRelTime } from '../../app/web/assets/utils/time.js';

// parseServerTs 解析服务器 naive-UTC 时间戳：补 'T' 与 'Z'，返回绝对毫秒。
// 返回值是绝对时间戳（与时区无关），故本组断言不依赖运行机器时区。

describe('parseServerTs', () => {
  it('空值 → 0', () => {
    expect(parseServerTs(0)).toBe(0);
    expect(parseServerTs(null)).toBe(0);
    expect(parseServerTs(undefined)).toBe(0);
    expect(parseServerTs('')).toBe(0);
  });

  it('naive 时间戳补 Z（按 UTC 解析）', () => {
    expect(parseServerTs('2026-07-16T12:00:00')).toBe(Date.parse('2026-07-16T12:00:00Z'));
  });

  it('空格分隔自动转 T', () => {
    expect(parseServerTs('2026-07-16 12:00:00')).toBe(Date.parse('2026-07-16T12:00:00Z'));
  });

  it('带 Z 的时间戳保持不变', () => {
    expect(parseServerTs('2026-07-16T12:00:00Z')).toBe(Date.parse('2026-07-16T12:00:00Z'));
  });

  it('带时区偏移按原偏移解析', () => {
    // +08:00 → 等价 UTC 12:00
    expect(parseServerTs('2026-07-16T20:00:00+08:00')).toBe(Date.parse('2026-07-16T12:00:00Z'));
  });

  it('非法 → 0', () => {
    expect(parseServerTs('not-a-date')).toBe(0);
    expect(parseServerTs('abc def')).toBe(0);
  });
});

// formatRelTime：now 注入为 2026-07-21 12:00:00 UTC（毫秒），断言与机器时区无关。
const NOW = Date.parse('2026-07-21T12:00:00Z');
const sec = (iso) => Date.parse(iso) / 1000;

describe('formatRelTime', () => {
  it('空值/非法 → 空串', () => {
    expect(formatRelTime(0, NOW)).toBe('');
    expect(formatRelTime(null, NOW)).toBe('');
    expect(formatRelTime('x', NOW)).toBe('');
  });
  it('<1 分钟 → 刚刚', () => {
    expect(formatRelTime(sec('2026-07-21T11:59:30Z'), NOW)).toBe('刚刚');
  });
  it('分钟级', () => {
    expect(formatRelTime(sec('2026-07-21T11:55:00Z'), NOW)).toBe('5 分钟前');
  });
  it('小时级', () => {
    expect(formatRelTime(sec('2026-07-21T09:00:00Z'), NOW)).toBe('3 小时前');
  });
  it('天级（<7 天）', () => {
    expect(formatRelTime(sec('2026-07-19T12:00:00Z'), NOW)).toBe('2 天前');
  });
  it('≥7 天回落日期（同年不带年份）', () => {
    expect(formatRelTime(sec('2026-07-10T12:00:00Z'), NOW)).toBe('7月10日');
  });
  it('跨年带年份', () => {
    expect(formatRelTime(sec('2025-12-01T12:00:00Z'), NOW)).toBe('2025年12月1日');
  });
  it('未来时间不报负值（夹到 0 → 刚刚）', () => {
    expect(formatRelTime(sec('2026-07-22T12:00:00Z'), NOW)).toBe('刚刚');
  });
});
