import { describe, it, expect } from 'vitest';
import {
  detectMacOS,
  normalizeHint,
  resolveModKeyHint,
  fmtKey,
  modLabel,
} from '../../app/web/assets/utils/platform.js';

// 平台检测 + 快捷键展示格式化：Mac 渲染 ⌘K、Windows/Linux 渲染 Ctrl+K。
// 运行时绑定始终 metaKey||ctrlKey 双接受，本模块只负责"展示说本地语言"。

describe('detectMacOS（三级回落检测链）', () => {
  it('userAgentData.platform 优先（新 Chrome）', () => {
    expect(detectMacOS({ userAgentData: { platform: 'macOS' }, platform: 'Win32' })).toBe(true);
    expect(detectMacOS({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' })).toBe(false);
  });

  it('回落 navigator.platform（Safari / 旧浏览器）', () => {
    expect(detectMacOS({ platform: 'MacIntel' })).toBe(true);
    expect(detectMacOS({ platform: 'Win32' })).toBe(false);
    expect(detectMacOS({ platform: 'Linux x86_64' })).toBe(false);
  });

  it('iPadOS 桌面模式伪装 MacIntel → Mac 语义（外接键盘确有 ⌘）', () => {
    expect(detectMacOS({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0)' })).toBe(true);
  });

  it('最终兜底 userAgent 正则', () => {
    expect(detectMacOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })).toBe(true);
    expect(detectMacOS({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe(false);
  });

  it('空对象 / null 不抛错，返回 false', () => {
    expect(detectMacOS({})).toBe(false);
    expect(detectMacOS(null)).toBe(false);
  });
});

describe('normalizeHint（偏好值归一）', () => {
  it('合法值直通（大小写不敏感）', () => {
    expect(normalizeHint('auto')).toBe('auto');
    expect(normalizeHint('MAC')).toBe('mac');
    expect(normalizeHint('Win')).toBe('win');
  });

  it('非法值 / 脏数据回落 auto，永不抛错', () => {
    expect(normalizeHint('linux')).toBe('auto');
    expect(normalizeHint('')).toBe('auto');
    expect(normalizeHint(null)).toBe('auto');
    expect(normalizeHint(undefined)).toBe('auto');
    expect(normalizeHint(42)).toBe('auto');
  });
});

describe('resolveModKeyHint（手动覆盖优先于自动检测）', () => {
  const macNav = { platform: 'MacIntel' };
  const winNav = { platform: 'Win32' };

  it('auto 跟随检测结果', () => {
    expect(resolveModKeyHint('auto', macNav)).toBe('mac');
    expect(resolveModKeyHint('auto', winNav)).toBe('win');
  });

  it('mac/win 覆盖检测（设置页手选）', () => {
    expect(resolveModKeyHint('win', macNav)).toBe('win');
    expect(resolveModKeyHint('mac', winNav)).toBe('mac');
  });

  it('非法偏好回落 auto 再检测', () => {
    expect(resolveModKeyHint('garbage', macNav)).toBe('mac');
  });
});

describe('fmtKey（组合键 → 平台化展示串）', () => {
  it('Mac：⌘ 紧凑无分隔符', () => {
    expect(fmtKey('mod+k', 'mac')).toBe('⌘K');
    expect(fmtKey('mod+shift+k', 'mac')).toBe('⌘⇧K');
    expect(fmtKey('mod+alt+i', 'mac')).toBe('⌘⌥I');
  });

  it('Windows：Ctrl 以 + 连接', () => {
    expect(fmtKey('mod+k', 'win')).toBe('Ctrl+K');
    expect(fmtKey('mod+shift+k', 'win')).toBe('Ctrl+Shift+K');
  });

  it('Enter 平台化：Mac ↩ / Win Enter', () => {
    expect(fmtKey('mod+enter', 'mac')).toBe('⌘↩');
    expect(fmtKey('mod+enter', 'win')).toBe('Ctrl+Enter');
  });

  it('标点键原样保留（, \\ /）', () => {
    expect(fmtKey('mod+,', 'mac')).toBe('⌘,');
    expect(fmtKey('mod+\\', 'win')).toBe('Ctrl+\\');
    expect(fmtKey('mod+/', 'mac')).toBe('⌘/');
  });

  it('auto 提示 + 注入 nav 走检测', () => {
    expect(fmtKey('mod+k', 'auto', { platform: 'MacIntel' })).toBe('⌘K');
    expect(fmtKey('mod+k', 'auto', { platform: 'Win32' })).toBe('Ctrl+K');
  });

  it('空输入不抛错', () => {
    expect(fmtKey('', 'mac')).toBe('');
    expect(fmtKey(null, 'win')).toBe('');
  });
});

describe('modLabel（修饰键单标签）', () => {
  it('Mac ⌘ / Win Ctrl', () => {
    expect(modLabel('mac')).toBe('⌘');
    expect(modLabel('win')).toBe('Ctrl');
    expect(modLabel('auto', { platform: 'MacIntel' })).toBe('⌘');
  });
});
