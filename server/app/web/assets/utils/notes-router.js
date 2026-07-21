// 笔记页 · 深链解析与序列化（纯函数层，便于单测；生产仍零构建）
//
// 与 utils/settings-search.js 同纪律：从 app.js 抽离，逻辑全在浏览器内，纯函数无副作用。
//
// 隐私约定：URL 的 hash 片段浏览器**不会**发给服务端（随行档零痕迹 DNA）；
// 且 URL 只承载 file_id（稳定、不可枚举的代理），**绝不**承载真实路径——
// 路径含斜杠/中文需重度转义且会泄露目录结构，违反「对外只用 file_id」的安全基线。
//
// 深链格式：
//   #/notes            笔记列表
//   #/notes/new        列表 + 新建编辑器
//   #/notes/<file_id>  列表 + 打开该笔记
//
// 安全：file_id 走白名单 [A-Za-z0-9_-]{1,64}；任何非法/越界/注入串一律回落列表，永不抛错。

// file_id 白名单（与后端生成的 id 字符集一致；超长或含非法字符即视为无效）
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const NOTES_HASH_PREFIX = '#/notes';

// 是否笔记深链（含 #/notes、#/notes/… ；不含 #/notesX 这类前缀碰撞）
export function isNotesHash(hash) {
  return /^#\/notes(?:\/|$)/.test(String(hash || '').trim());
}

// 解析 #/notes[/<file_id>|/new] → { noteId, isNew }
// 非法输入（XSS 尝试、含路径斜杠、超长、空串）一律回落 { noteId: null, isNew: false }
export function parseNotesHash(hash) {
  const m = /^#\/notes(?:\/(new|[A-Za-z0-9_-]{1,64}))?\/?$/.exec(String(hash || '').trim());
  if (!m) return { noteId: null, isNew: false };
  if (m[1] === 'new') return { noteId: null, isNew: true };
  if (m[1]) return { noteId: m[1], isNew: false };
  return { noteId: null, isNew: false }; // 裸 #/notes
}

// 序列化深链：isNew 优先；noteId 不合法时丢弃（回落列表），永不产出非法 URL
export function serializeNotesHash({ noteId, isNew } = {}) {
  if (isNew) return '#/notes/new';
  const id = noteId == null ? '' : String(noteId);
  if (id && ID_RE.test(id)) return '#/notes/' + id;
  return '#/notes';
}

// 在已加载的笔记列表里按 file_id 反查（兼容后端字段名 file_id / 旧 id）；查不到返回 null
export function resolveNoteById(notes, noteId) {
  if (!noteId || !Array.isArray(notes)) return null;
  return notes.find(n => (n.file_id || n.id) === noteId) || null;
}
