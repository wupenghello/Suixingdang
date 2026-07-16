import { describe, it, expect } from 'vitest';
import { parseServerTs } from '../../app/web/assets/utils/time.js';

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
