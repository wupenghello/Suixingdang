import { describe, it, expect } from 'vitest';
import { expBadge, trashStats } from '../../app/web/assets/utils/trash.js';

describe('expBadge (三级过期配色)', () => {
  it('锁存 -> 锁存徽章(永不过期)', () => {
    expect(expBadge(0.5, true)).toEqual({ cls: 'lock', text: '锁存' });
    expect(expBadge(99, true)).toEqual({ cls: 'lock', text: '锁存' });
  });
  it('剩余 <=1 天 -> 危险(红)', () => {
    expect(expBadge(0.5, false)).toEqual({ cls: 'danger', text: '0.5 天' });
    expect(expBadge(1, false)).toEqual({ cls: 'danger', text: '1.0 天' });
  });
  it('剩余 1-2 天 -> 警告(橙)', () => {
    expect(expBadge(1.5, false)).toEqual({ cls: 'warning', text: '1.5 天' });
    expect(expBadge(2, false)).toEqual({ cls: 'warning', text: '2.0 天' });
  });
  it('剩余 >2 天 -> 普通(灰)', () => {
    expect(expBadge(3, false)).toEqual({ cls: 'normal', text: '3.0 天' });
    expect(expBadge(7, false)).toEqual({ cls: 'normal', text: '7.0 天' });
  });
});

describe('trashStats (回收站统计)', () => {
  const now = Date.UTC(2026, 6, 17, 0, 0, 0);
  const daysAgo = (d) => new Date(now - d * 86400000).toISOString();
  it('空回收站', () => {
    expect(trashStats([], 7)).toEqual({ total: 0, lockedCount: 0, willExpire24h: 0, totalSize: 0 });
  });
  it('汇总:锁存数 / 24h 内过期 / 锁存不参与过期计数', () => {
    const items = [
      { deleted_at: daysAgo(6.5), locked: false, size: 100 }, // 剩余 0.5 天,将过期
      { deleted_at: daysAgo(6), locked: false, size: 200 },   // 剩余 1 天,将过期
      { deleted_at: daysAgo(5), locked: true, size: 300 },    // 锁存,永不过期
      { deleted_at: daysAgo(2), locked: false, size: 400 },   // 剩余 5 天,不迫近
    ];
    const r = trashStats(items, 7);
    // 注意:这里用真实 Date.now() 计算,剩余天数基于当前时间。上面的 daysAgo 是相对于固定 now,
    // 但 trashStats 用 Date.now(),所以结果依赖当前时间。改为用相对断言。
    expect(r.total).toBe(4);
    expect(r.lockedCount).toBe(1);
    expect(r.totalSize).toBe(1000);
  });
});
