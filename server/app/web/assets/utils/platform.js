// 平台检测 + 快捷键展示格式化（纯函数，零运行时依赖，vitest 单测覆盖）
//
// 背景：运行时绑定一直是 metaKey||ctrlKey 双接受（Mac 按 ⌘ 或 Ctrl 都生效），
// 但展示层硬编码 "Ctrl K"，Mac 用户看到 Ctrl 以为快捷键坏了。本模块统一
// "检测一次、格式化全部"：侧栏 kbd、快捷键帮助弹窗、设置页说明共用。
//
// 检测优先级：modKeyHint 偏好覆盖（设置页手选）> userAgentData.platform
//            > navigator.platform > userAgent 正则兜底。
// iPadOS 桌面模式伪装 MacIntel → 判为 Mac 语义（外接键盘确有 ⌘ 键，判定正确）。
//
// 格式化约定（对齐 macOS 菜单栏惯例）：
//   fmtKey('mod+k', 'mac')        → '⌘K'
//   fmtKey('mod+shift+k', 'mac')  → '⌘⇧K'
//   fmtKey('mod+k', 'win')        → 'Ctrl+K'
//   fmtKey('mod+enter', 'mac')    → '⌘↩'

const MAC_PLATFORM_RE = /^mac/i;
const MAC_UA_RE = /mac os x|iphone|ipad|ipod/i;

// 三级回落检测客户端是否 macOS 语义（纯函数，nav 可注入便于测试）
export function detectMacOS(nav) {
  nav = nav || (typeof navigator !== 'undefined' ? navigator : null);
  if (!nav) return false;
  const uad = nav.userAgentData;
  if (uad && typeof uad.platform === 'string' && uad.platform) {
    return MAC_PLATFORM_RE.test(uad.platform);
  }
  if (typeof nav.platform === 'string' && nav.platform) {
    return MAC_PLATFORM_RE.test(nav.platform);
  }
  if (typeof nav.userAgent === 'string') return MAC_UA_RE.test(nav.userAgent);
  return false;
}

const VALID_HINTS = ['auto', 'mac', 'win'];

// 偏好值归一：非法值（脏 localStorage / 旧版数据）一律回落 auto，永不抛错
export function normalizeHint(hint) {
  const h = String(hint == null ? '' : hint).toLowerCase();
  return VALID_HINTS.includes(h) ? h : 'auto';
}

// 解析最终修饰键平台：'auto' 走检测，'mac'/'win' 为设置页手动覆盖
export function resolveModKeyHint(hint, nav) {
  const h = normalizeHint(hint);
  if (h === 'mac') return 'mac';
  if (h === 'win') return 'win';
  return detectMacOS(nav) ? 'mac' : 'win';
}

const MAC_SYM = { mod: '⌘', shift: '⇧', alt: '⌥' };
const WIN_SYM = { mod: 'Ctrl', shift: 'Shift', alt: 'Alt' };

// 组合键 → 平台化展示串。字母键大写；标点键（, \ /）原样保留。
export function fmtKey(combo, hint, nav) {
  const resolved = resolveModKeyHint(hint, nav);
  const sym = resolved === 'mac' ? MAC_SYM : WIN_SYM;
  const parts = String(combo || '').split('+').filter(Boolean);
  const out = [];
  for (const p of parts) {
    const low = p.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(sym, low)) { out.push(sym[low]); continue; }
    if (low === 'enter') { out.push(resolved === 'mac' ? '↩' : 'Enter'); continue; }
    if (/^[a-z]$/i.test(p)) { out.push(p.toUpperCase()); continue; }
    out.push(p); // 标点键原样
  }
  return resolved === 'mac' ? out.join('') : out.join('+');
}

// 单独取修饰键标签（⌘ / Ctrl），用于行内说明文案
export function modLabel(hint, nav) {
  return resolveModKeyHint(hint, nav) === 'mac' ? '⌘' : 'Ctrl';
}
