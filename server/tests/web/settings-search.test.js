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
  it('章节 id 唯一且含 account/security/devices/storage/about', () => {
    const ids = SETTINGS_SECTIONS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['account', 'security', 'devices', 'storage', 'about']));
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
    expect(normalizeAnchor('security', 'download')).toBe('download');
    expect(normalizeAnchor('devices', 'revoke-all')).toBe('revoke-all');
    expect(normalizeAnchor('account', 'history')).toBe('history');
  });

  it('空/缺失返回 null', () => {
    expect(normalizeAnchor('account', null)).toBeNull();
    expect(normalizeAnchor('account', '')).toBeNull();
    expect(normalizeAnchor('account', undefined)).toBeNull();
  });

  it('未登记锚点返回 null（防 hash 注入 / 跨章节错配）', () => {
    expect(normalizeAnchor('account', 'download')).toBeNull(); // download 属于 security
    expect(normalizeAnchor('account', '"><img onerror>')).toBeNull();
    expect(normalizeAnchor('security', 'nonexistent')).toBeNull();
  });
});

describe('parseSettingsHash（深链解析）', () => {
  it('合法深链：章节 + 锚点', () => {
    expect(parseSettingsHash('#/settings/security/download')).toEqual({ section: 'security', anchor: 'download' });
    expect(parseSettingsHash('#/settings/account')).toEqual({ section: 'account', anchor: null });
  });

  it('尾斜杠容忍 + 大小写不敏感', () => {
    expect(parseSettingsHash('#/settings/storage/')).toEqual({ section: 'storage', anchor: null });
    expect(parseSettingsHash('#/settings/Security/Download')).toEqual({ section: 'security', anchor: 'download' });
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

  it('null/undefined 输入安全', () => {
    expect(parseSettingsHash(null)).toEqual({ section: 'account', anchor: null });
    expect(parseSettingsHash(undefined)).toEqual({ section: 'account', anchor: null });
  });
});

describe('serializeSettingsHash（深链序列化）', () => {
  it('章节 + 锚点', () => {
    expect(serializeSettingsHash('security', 'download')).toBe('#/settings/security/download');
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
    expect(r[0]).toMatchObject({ section: 'security', anchor: 'download', title: '临时下载' });
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
    expect(r.every(it => ['account', 'storage'].includes(it.section))).toBe(true);
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
    for (const q of ['下载', '令牌', '密码', '索引', '账户', '脱敏', '退出']) {
      for (const it of filterSettingsIndex(q)) {
        expect(normalizeAnchor(it.section, it.anchor)).toBe(it.anchor);
      }
    }
  });
});

describe('getSection', () => {
  it('返回章节元数据，未知 id 返回 null', () => {
    expect(getSection('account')).toMatchObject({ id: 'account', label: '账户' });
    expect(getSection('nope')).toBeNull();
    expect(getSection(null)).toBeNull();
  });
});
