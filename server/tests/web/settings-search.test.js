import { describe, it, expect } from 'vitest';
import {
  SETTINGS_SECTIONS,
  SETTINGS_INDEX,
  getSection,
  normalizeSectionId,
  normalizeAnchor,
  parseSettingsHash,
  serializeSettingsHash,
  filterSettingsIndex,
} from '../../app/web/assets/utils/settings-search.js';

describe('SETTINGS_SECTIONS / SETTINGS_INDEX（数据完整性）', () => {
  it('章节 id 唯一且为拆分后的 7 章（导航顺序即数组顺序）', () => {
    const ids = SETTINGS_SECTIONS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['account', 'security', 'privacy', 'devices', 'storage', 'index', 'about']);
  });

  it('导航条目单项化：label 不得为「X与Y」复合命名', () => {
    for (const s of SETTINGS_SECTIONS) {
      expect(s.label).not.toContain('与');
    }
  });

  it('每个章节都有 label/icon/desc，icon 键非空', () => {
    for (const s of SETTINGS_SECTIONS) {
      expect(s.label).toBeTruthy();
      expect(s.icon).toBeTruthy();
      expect(s.desc).toBeTruthy();
    }
  });

  it('搜索索引的 section 都指向合法章节，且 section+anchor 组合唯一', () => {
    const ids = new Set(SETTINGS_SECTIONS.map(s => s.id));
    const seen = new Set();
    for (const item of SETTINGS_INDEX) {
      expect(ids.has(item.section)).toBe(true);
      expect(item.anchor).toBeTruthy();
      expect(item.title).toBeTruthy();
      expect(Array.isArray(item.keywords)).toBe(true);
      expect(item.keywords.length).toBeGreaterThan(0);
      const key = `${item.section}/${item.anchor}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe('normalizeSectionId（章节归一 + 旧 tab 兼容）', () => {
  it('新 id 直通', () => {
    expect(normalizeSectionId('account')).toBe('account');
    expect(normalizeSectionId('devices')).toBe('devices');
    expect(normalizeSectionId('about')).toBe('about');
  });

  it('旧 tab id general 映射到 storage（localStorage 旧偏好兼容）', () => {
    expect(normalizeSectionId('general')).toBe('storage');
  });

  it('security/account 旧值保持不变（与新 id 重合）', () => {
    expect(normalizeSectionId('security')).toBe('security');
    expect(normalizeSectionId('account')).toBe('account');
  });

  it('非法值回落默认章节 account，大小写不敏感', () => {
    expect(normalizeSectionId('xxx')).toBe('account');
    expect(normalizeSectionId('')).toBe('account');
    expect(normalizeSectionId(null)).toBe('account');
    expect(normalizeSectionId(undefined)).toBe('account');
    expect(normalizeSectionId('STORAGE')).toBe('storage');
  });

  it('拒绝含特殊字符的注入尝试', () => {
    expect(normalizeSectionId('<script>')).toBe('account');
    expect(normalizeSectionId('storage/../account')).toBe('account');
  });
});

describe('normalizeAnchor（锚点白名单校验）', () => {
  it('登记过的锚点通过', () => {
    expect(normalizeAnchor('privacy', 'download')).toBe('download');
    expect(normalizeAnchor('privacy', 'pii')).toBe('pii');
    expect(normalizeAnchor('index', 'reindex')).toBe('reindex');
    expect(normalizeAnchor('devices', 'revoke-all')).toBe('revoke-all');
    expect(normalizeAnchor('account', 'history')).toBe('history');
  });

  it('空/缺失返回 null', () => {
    expect(normalizeAnchor('account', null)).toBeNull();
    expect(normalizeAnchor('account', '')).toBeNull();
    expect(normalizeAnchor('account', undefined)).toBeNull();
  });

  it('未登记锚点返回 null（防 hash 注入 / 跨章节错配）', () => {
    expect(normalizeAnchor('account', 'download')).toBeNull(); // download 属于 privacy
    expect(normalizeAnchor('account', '"><img onerror>')).toBeNull();
    expect(normalizeAnchor('security', 'nonexistent')).toBeNull();
  });
});

describe('parseSettingsHash（深链解析）', () => {
  it('合法深链：章节 + 锚点', () => {
    expect(parseSettingsHash('#/settings/privacy/download')).toEqual({ section: 'privacy', anchor: 'download' });
    expect(parseSettingsHash('#/settings/account')).toEqual({ section: 'account', anchor: null });
  });

  it('尾斜杠容忍 + 大小写不敏感', () => {
    expect(parseSettingsHash('#/settings/storage/')).toEqual({ section: 'storage', anchor: null });
    expect(parseSettingsHash('#/settings/Privacy/Download')).toEqual({ section: 'privacy', anchor: 'download' });
  });

  it('旧 tab 深链兼容（general → storage）', () => {
    expect(parseSettingsHash('#/settings/general')).toEqual({ section: 'storage', anchor: null });
  });

  it('非法 hash 一律回落 { account, null }，绝不抛错', () => {
    for (const bad of ['', '#', '#/settings', '#/other/account', '#/settings/<script>alert(1)</script>', '#/settings/a/b/c', 'not-a-hash', '#/settings/../../etc']) {
      expect(parseSettingsHash(bad)).toEqual({ section: 'account', anchor: null });
    }
  });

  it('非法锚点丢弃但保留合法章节', () => {
    expect(parseSettingsHash('#/settings/security/xxx')).toEqual({ section: 'security', anchor: null });
  });

  it('IA 拆分旧深链救援：锚点搬家后章节自动纠正（书签永久有效）', () => {
    expect(parseSettingsHash('#/settings/security/pii')).toEqual({ section: 'privacy', anchor: 'pii' });
    expect(parseSettingsHash('#/settings/security/download')).toEqual({ section: 'privacy', anchor: 'download' });
    expect(parseSettingsHash('#/settings/storage/reindex')).toEqual({ section: 'index', anchor: 'reindex' });
    expect(parseSettingsHash('#/settings/Security/PII')).toEqual({ section: 'privacy', anchor: 'pii' });
  });

  it('救援不放宽白名单：未登记锚点仍丢弃，不做任意跨章节匹配', () => {
    expect(parseSettingsHash('#/settings/security/nonexistent')).toEqual({ section: 'security', anchor: null });
    expect(parseSettingsHash('#/settings/privacy/xxx')).toEqual({ section: 'privacy', anchor: null });
  });

  it('已删除锚点的重定向：account/quota → storage/stats（配额卡收敛到存储章）', () => {
    expect(parseSettingsHash('#/settings/account/quota')).toEqual({ section: 'storage', anchor: 'stats' });
  });

  it('null/undefined 输入安全', () => {
    expect(parseSettingsHash(null)).toEqual({ section: 'account', anchor: null });
    expect(parseSettingsHash(undefined)).toEqual({ section: 'account', anchor: null });
  });
});

describe('serializeSettingsHash（深链序列化）', () => {
  it('章节 + 锚点', () => {
    expect(serializeSettingsHash('privacy', 'download')).toBe('#/settings/privacy/download');
    expect(serializeSettingsHash('account', null)).toBe('#/settings/account');
  });

  it('非法章节归一、非法锚点丢弃', () => {
    expect(serializeSettingsHash('bogus', 'x')).toBe('#/settings/account');
    expect(serializeSettingsHash('storage', 'bogus')).toBe('#/settings/storage');
    expect(serializeSettingsHash('general', null)).toBe('#/settings/storage');
  });

  it('与 parseSettingsHash 互逆（合法输入往返不变）', () => {
    for (const item of SETTINGS_INDEX) {
      const h = serializeSettingsHash(item.section, item.anchor);
      expect(parseSettingsHash(h)).toEqual({ section: item.section, anchor: item.anchor });
    }
  });
});

describe('filterSettingsIndex（页内搜索）', () => {
  it('空查询返回空数组', () => {
    expect(filterSettingsIndex('')).toEqual([]);
    expect(filterSettingsIndex('   ')).toEqual([]);
    expect(filterSettingsIndex(null)).toEqual([]);
  });

  it('中文关键词命中（标题优先）', () => {
    const r = filterSettingsIndex('下载');
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]).toMatchObject({ section: 'privacy', anchor: 'download', title: '临时下载' });
  });

  it('新章节可被口语词搜到（隐私 / 索引）', () => {
    expect(filterSettingsIndex('隐私').some(it => it.anchor === 'pii')).toBe(true);
    expect(filterSettingsIndex('privacy').some(it => it.anchor === 'pii')).toBe(true);
    expect(filterSettingsIndex('重建 索引')[0]).toMatchObject({ section: 'index', anchor: 'reindex' });
    expect(filterSettingsIndex('搜索不准').some(it => it.anchor === 'reindex')).toBe(true);
  });

  it('英文关键词命中', () => {
    const r = filterSettingsIndex('token');
    expect(r.some(it => it.anchor === 'tokens')).toBe(true);
    expect(r.some(it => it.anchor === 'revoke-all')).toBe(true); // keywords 含 token
  });

  it('title 命中排在 keywords 命中之前（相关度排序）', () => {
    const r = filterSettingsIndex('索引');
    expect(r[0]).toMatchObject({ anchor: 'reindex', title: '全文索引' });
  });

  it('多词 AND 语义：全部命中才返回', () => {
    const r = filterSettingsIndex('存储 配额');
    expect(r.length).toBeGreaterThan(0);
    // 配额已收敛到存储章（账户卡去重后不再命中 account）
    expect(r.every(it => it.section === 'storage')).toBe(true);
    expect(filterSettingsIndex('下载 不存在的词xyz')).toEqual([]);
  });

  it('无命中返回空数组而非报错', () => {
    expect(filterSettingsIndex('zzz完全无关')).toEqual([]);
  });

  it('结果只含白名单字段（section/anchor/title）', () => {
    const r = filterSettingsIndex('密码');
    expect(r.length).toBeGreaterThan(0);
    for (const it of r) {
      expect(Object.keys(it).sort()).toEqual(['anchor', 'section', 'title']);
    }
  });

  it('每个搜索结果都能被 normalizeAnchor 接受（索引与锚点白名单一致）', () => {
    for (const q of ['下载', '令牌', '密码', '索引', '账户', '脱敏', '退出', '隐私', '存储']) {
      for (const it of filterSettingsIndex(q)) {
        expect(normalizeAnchor(it.section, it.anchor)).toBe(it.anchor);
      }
    }
  });
});

describe('getSection', () => {
  it('返回章节元数据，未知 id 返回 null', () => {
    expect(getSection('account')).toMatchObject({ id: 'account', label: '账户' });
    expect(getSection('privacy')).toMatchObject({ id: 'privacy', label: '隐私' });
    expect(getSection('index')).toMatchObject({ id: 'index', label: '索引' });
    expect(getSection('devices')).toMatchObject({ id: 'devices', label: '设备' });
    expect(getSection('about')).toMatchObject({ id: 'about', label: '关于' });
    expect(getSection('nope')).toBeNull();
    expect(getSection(null)).toBeNull();
  });
});
