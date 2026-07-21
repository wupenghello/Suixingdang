import { describe, it, expect } from 'vitest';
import {
  NOTES_HASH_PREFIX,
  isNotesHash,
  parseNotesHash,
  serializeNotesHash,
  resolveNoteById,
} from '../../app/web/assets/utils/notes-router.js';

describe('isNotesHash（前缀判定，防 #/notesX 碰撞）', () => {
  it.each(['#/notes', '#/notes/', '#/notes/new', '#/notes/abc_123-XYZ'])(
    '命中：%s', (h) => expect(isNotesHash(h)).toBe(true));
  it.each(['', '#', '#/', '#/note', '#/notesX', '#/notes2', '#/settings/notes', 'notes', '#/notes-extra'])(
    '不命中：%s', (h) => expect(isNotesHash(h)).toBe(false));
});

describe('parseNotesHash（解析）', () => {
  it('裸 #/notes → 列表态', () => {
    expect(parseNotesHash('#/notes')).toEqual({ noteId: null, isNew: false });
    expect(parseNotesHash('#/notes/')).toEqual({ noteId: null, isNew: false });
  });
  it('#/notes/new → 新建态', () => {
    expect(parseNotesHash('#/notes/new')).toEqual({ noteId: null, isNew: true });
    expect(parseNotesHash('#/notes/new/')).toEqual({ noteId: null, isNew: true });
  });
  it('合法 file_id → 打开态（含字母数字下划线连字符）', () => {
    expect(parseNotesHash('#/notes/abc_123-XYZ')).toEqual({ noteId: 'abc_123-XYZ', isNew: false });
    expect(parseNotesHash('#/notes/n01')).toEqual({ noteId: 'n01', isNew: false });
  });
  it('空串 / 无关 hash → 回落列表，不抛错', () => {
    expect(parseNotesHash('')).toEqual({ noteId: null, isNew: false });
    expect(parseNotesHash(undefined)).toEqual({ noteId: null, isNew: false });
    expect(parseNotesHash('#')).toEqual({ noteId: null, isNew: false });
    expect(parseNotesHash('#/settings/account')).toEqual({ noteId: null, isNew: false });
  });
});

describe('parseNotesHash（注入 / 越界防御）', () => {
  it('含路径斜杠的多段深链 → 回落（不解析出子路径）', () => {
    expect(parseNotesHash('#/notes/aaa/bbb')).toEqual({ noteId: null, isNew: false });
    expect(parseNotesHash('#/notes/../etc')).toEqual({ noteId: null, isNew: false });
  });
  it('XSS / 伪协议 / 特殊字符 → 回落（白名单外字符一律拒绝）', () => {
    expect(parseNotesHash('#/notes/"><img src=x onerror=alert(1)>')).toEqual({ noteId: null, isNew: false });
    expect(parseNotesHash('#/notes/javascript:alert(1)')).toEqual({ noteId: null, isNew: false });
    expect(parseNotesHash('#/notes/abc%2Fdef')).toEqual({ noteId: null, isNew: false });
    expect(parseNotesHash('#/notes/带中文')).toEqual({ noteId: null, isNew: false });
  });
  it('超长 id（>64）→ 回落', () => {
    const long = 'a'.repeat(65);
    expect(parseNotesHash('#/notes/' + long)).toEqual({ noteId: null, isNew: false });
    expect(parseNotesHash('#/notes/' + 'a'.repeat(64))).toEqual({ noteId: 'a'.repeat(64), isNew: false });
  });
  it('前后空白被 trim 后正常解析', () => {
    expect(parseNotesHash('  #/notes/n01  ')).toEqual({ noteId: 'n01', isNew: false });
  });
});

describe('serializeNotesHash（序列化）', () => {
  it('isNew 优先', () => {
    expect(serializeNotesHash({ isNew: true })).toBe('#/notes/new');
    expect(serializeNotesHash({ noteId: 'n01', isNew: true })).toBe('#/notes/new');
  });
  it('合法 noteId 成链', () => {
    expect(serializeNotesHash({ noteId: 'n01' })).toBe('#/notes/n01');
  });
  it('非法/缺失 noteId → 回落列表（不产出非法 URL）', () => {
    expect(serializeNotesHash({})).toBe('#/notes');
    expect(serializeNotesHash({ noteId: null })).toBe('#/notes');
    expect(serializeNotesHash({ noteId: 'bad id' })).toBe('#/notes');
    expect(serializeNotesHash({ noteId: '../x' })).toBe('#/notes');
  });
});

describe('parse ↔ serialize 往返', () => {
  it.each([
    [{ noteId: 'n01' }, { noteId: 'n01', isNew: false }],
    [{ isNew: true }, { noteId: null, isNew: true }],
    [{}, { noteId: null, isNew: false }],
  ])('serialize(%o) 再 parse 回到 %o', (input, expected) => {
    expect(parseNotesHash(serializeNotesHash(input))).toEqual(expected);
  });
  it('非法 noteId 经 serialize 回落后再 parse 仍为列表态', () => {
    expect(parseNotesHash(serializeNotesHash({ noteId: 'evil/x' }))).toEqual({ noteId: null, isNew: false });
  });
});

describe('resolveNoteById（列表反查）', () => {
  const notes = [
    { file_id: 'f1', name: 'a.md' },
    { id: 'f2', name: 'b.md' }, // 兼容旧字段名
  ];
  it('按 file_id 命中', () => {
    expect(resolveNoteById(notes, 'f1')).toEqual(notes[0]);
  });
  it('兼容 id 字段命中', () => {
    expect(resolveNoteById(notes, 'f2')).toEqual(notes[1]);
  });
  it('未命中 / 空 id / 非数组 → null', () => {
    expect(resolveNoteById(notes, 'nope')).toBe(null);
    expect(resolveNoteById(notes, '')).toBe(null);
    expect(resolveNoteById(null, 'f1')).toBe(null);
  });
});

describe('常量', () => {
  it('NOTES_HASH_PREFIX 与解析前缀一致', () => {
    expect(NOTES_HASH_PREFIX).toBe('#/notes');
    expect(isNotesHash(NOTES_HASH_PREFIX)).toBe(true);
  });
});
