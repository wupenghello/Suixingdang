// 回收站辅助函数(从 app.js 抽离,便于单测)
// 过期徽章三级配色: <1天红, 1-2天橙, 否则灰; 锁存永不过期
export function expBadge(remainingDays, locked) {
  if (locked) return { cls: 'lock', text: '锁存' };
  if (remainingDays <= 1) return { cls: 'danger', text: `${remainingDays.toFixed(1)} 天` };
  if (remainingDays <= 2) return { cls: 'warning', text: `${remainingDays.toFixed(1)} 天` };
  return { cls: 'normal', text: `${remainingDays.toFixed(1)} 天` };
}

// 回收站统计汇总(供前端渲染与测试共用)
export function trashStats(items, retentionDays) {
  const now = Date.now();
  let lockedCount = 0;
  let willExpire24h = 0;
  let totalSize = 0;
  for (const f of items) {
    const remaining = retentionDays - (now - new Date(f.deleted_at).getTime()) / 86400000;
    if (f.locked) lockedCount++;
    else if (remaining <= 1) willExpire24h++;
    totalSize += f.size || 0;
  }
  return { total: items.length, lockedCount, willExpire24h, totalSize };
}
