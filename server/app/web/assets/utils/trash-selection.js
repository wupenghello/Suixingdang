// 回收站选择状态机（纯逻辑，零 DOM / 零副作用，便于单测）
// app.js 通过 createTrashSelection() 持有实例；所有选择变更经此对象，保证状态单一来源。
// 设计要点：
//   - toggleOne 自动进入选择模式（点行复选框无需先点「批量选择」）
//   - toggleAll 在「全选↔取消全选」间切换；部分选中视为「可全选」
//   - exitMode 同时清空 selection，保证「选择模式」与「有选中项」语义解耦

export function createTrashSelection() {
  const selection = new Set();
  let selectMode = false;

  const self = {
    get mode() { return selectMode; },
    get size() { return selection.size; },
    ids() { return [...selection]; },
    has(id) { return selection.has(id); },

    enterMode() { selectMode = true; return self; },
    exitMode() { selectMode = false; selection.clear(); return self; },
    toggleMode() { if (selectMode) self.exitMode(); else self.enterMode(); return self; },

    add(id) { selection.add(id); return self; },
    remove(id) { selection.delete(id); return self; },
    clear() { selection.clear(); return self; },

    // 点行复选框：自动进入选择模式，再 toggle 该项
    toggleOne(id) {
      if (!selectMode) selectMode = true;
      if (selection.has(id)) selection.delete(id); else selection.add(id);
      return self;
    },

    // 全选 / 取消全选。items: [{file_id}]。
    // 已全选 → 清空；否则（含部分选中）→ 全选。
    toggleAll(items) {
      if (!selectMode) selectMode = true;
      const allSel = items.length > 0 && selection.size === items.length;
      if (allSel) selection.clear();
      else items.forEach(i => selection.add(i.file_id));
      return self;
    },

    // 派生态（不存，实时算）
    stats(items) {
      const n = selection.size;
      const t = items.length;
      return {
        selected: n,
        total: t,
        allSelected: t > 0 && n === t,
        indeterminate: n > 0 && n < t,
      };
    },
  };
  return self;
}
