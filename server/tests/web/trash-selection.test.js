import { describe, it, expect } from 'vitest';
import { createTrashSelection } from '../../app/web/assets/utils/trash-selection.js';

const items = (n) => Array.from({ length: n }, (_, i) => ({ file_id: `f${i + 1}` }));

describe('createTrashSelection（回收站选择状态机）', () => {
  it('初始态：未在选择模式、无选中', () => {
    const s = createTrashSelection();
    expect(s.mode).toBe(false);
    expect(s.size).toBe(0);
    expect(s.ids()).toEqual([]);
    expect(s.has('f1')).toBe(false);
  });

  it('enterMode 进入选择模式（不清空 selection）', () => {
    const s = createTrashSelection();
    s.add('f1');
    s.enterMode();
    expect(s.mode).toBe(true);
    expect(s.size).toBe(1);
  });

  it('exitMode 退出选择模式并清空 selection', () => {
    const s = createTrashSelection();
    s.enterMode();
    s.add('f1').add('f2');
    s.exitMode();
    expect(s.mode).toBe(false);
    expect(s.size).toBe(0);
    expect(s.ids()).toEqual([]);
  });

  it('toggleMode 在两种模式间切换；退出时清空', () => {
    const s = createTrashSelection();
    s.toggleMode();
    expect(s.mode).toBe(true);
    s.add('f1');
    s.toggleMode();
    expect(s.mode).toBe(false);
    expect(s.size).toBe(0); // 退出即清空
  });

  it('toggleOne：首次点击自动进入选择模式并选中', () => {
    const s = createTrashSelection();
    s.toggleOne('f1');
    expect(s.mode).toBe(true);
    expect(s.has('f1')).toBe(true);
    expect(s.size).toBe(1);
  });

  it('toggleOne：再次点击同一项取消选中', () => {
    const s = createTrashSelection();
    s.toggleOne('f1');
    s.toggleOne('f1');
    expect(s.has('f1')).toBe(false);
    expect(s.size).toBe(0);
    // 取消最后一项后仍留在选择模式（模式与选中解耦，由 exitMode 显式退出）
    expect(s.mode).toBe(true);
  });

  it('toggleOne 逐项累加', () => {
    const s = createTrashSelection();
    s.toggleOne('f1');
    s.toggleOne('f2');
    s.toggleOne('f3');
    expect(s.size).toBe(3);
    expect(s.ids().sort()).toEqual(['f1', 'f2', 'f3']);
  });

  it('add / remove / clear 基础操作', () => {
    const s = createTrashSelection();
    s.enterMode();
    s.add('f1').add('f1'); // 重复添加幂等
    expect(s.size).toBe(1);
    s.remove('f1');
    expect(s.has('f1')).toBe(false);
    s.add('a').add('b');
    s.clear();
    expect(s.size).toBe(0);
    expect(s.mode).toBe(true); // clear 不清模式
  });

  it('toggleAll：空选择 → 全选', () => {
    const s = createTrashSelection();
    s.toggleAll(items(3));
    expect(s.mode).toBe(true);
    expect(s.size).toBe(3);
    expect(s.ids().sort()).toEqual(['f1', 'f2', 'f3']);
  });

  it('toggleAll：已全选 → 清空（取消全选）', () => {
    const s = createTrashSelection();
    s.toggleAll(items(3));
    expect(s.size).toBe(3);
    s.toggleAll(items(3)); // 再次：清空
    expect(s.size).toBe(0);
    expect(s.mode).toBe(true);
  });

  it('toggleAll：部分选中 → 视为全选（而非清空）', () => {
    const s = createTrashSelection();
    s.toggleOne('f1'); // 仅选中 1/3
    s.toggleAll(items(3));
    expect(s.size).toBe(3); // 全选，不是清空
  });

  it('toggleAll 空列表不进入选择模式（无意义）', () => {
    const s = createTrashSelection();
    s.toggleAll([]);
    expect(s.size).toBe(0);
    expect(s.mode).toBe(true); // 仍进入模式（与有项行为一致），但无选中
  });

  it('stats：派生态实时算 — 空 / 部分 / 全选 / 总数0', () => {
    const s = createTrashSelection();
    expect(s.stats(items(3))).toEqual({ selected: 0, total: 3, allSelected: false, indeterminate: false });
    s.toggleOne('f1');
    expect(s.stats(items(3))).toEqual({ selected: 1, total: 3, allSelected: false, indeterminate: true });
    s.toggleAll(items(3));
    expect(s.stats(items(3))).toEqual({ selected: 3, total: 3, allSelected: true, indeterminate: false });
    // 对空数组算 stats：selection 仍持有 3 项，total=0 → 非全选非半选
    expect(s.stats([])).toEqual({ selected: 3, total: 0, allSelected: false, indeterminate: false });
  });

  it('ids() 返回副本，外部修改不影响内部', () => {
    const s = createTrashSelection();
    s.add('f1').add('f2');
    const a = s.ids();
    a.push('malicious');
    expect(s.size).toBe(2);
    expect(s.has('malicious')).toBe(false);
  });

  it('链式调用：工厂方法均返回 self', () => {
    const s = createTrashSelection();
    expect(s.enterMode()).toBe(s);
    expect(s.exitMode()).toBe(s);
    expect(s.toggleMode()).toBe(s);
    expect(s.add('x')).toBe(s);
    expect(s.remove('x')).toBe(s);
    expect(s.clear()).toBe(s);
    expect(s.toggleOne('x')).toBe(s);
    expect(s.toggleAll(items(1))).toBe(s);
  });
});
