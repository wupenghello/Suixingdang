// 设置页 · 页内搜索与深链纯函数层（从 app.js 抽离，便于单测；生产仍零构建）
//
// 隐私约定：SETTINGS_INDEX 是纯静态常量，filterSettingsIndex 全程在浏览器内完成匹配——
// 搜索词不发任何请求、不写 localStorage、不落日志（随行档零痕迹 DNA）。
//
// 深链格式：#/settings/<section>[/<anchor>]
//   例：#/settings/privacy/download → 隐私 · 临时下载
//
// 旧章节深链（IA 拆分前）永久兼容：security/pii、security/download 已迁至 privacy，
// storage/reindex 已迁至 index——parseSettingsHash 做注册表全局锚点救援（见下）。

// ---- 章节定义（导航顺序即此数组顺序；about 为导航底部弱化项）----
// IA 原则：一个条目只承载一个概念，禁止「X与Y」复合命名（2026-07 导航单项化重构）
export const SETTINGS_SECTIONS = [
  { id: 'account',  label: '账户',       icon: 'user',     desc: '账户信息、安全状态与登录历史' },
  { id: 'security', label: '安全',       icon: 'shield',   desc: '修改密码，旧令牌与会话立即失效' },
  { id: 'privacy',  label: '隐私',       icon: 'eye',      desc: 'PII 服务端脱敏与零痕迹临时下载' },
  { id: 'devices',  label: '设备',       icon: 'monitor',  desc: '设备与浏览器会话令牌、紧急吊销' },
  { id: 'storage',  label: '存储',       icon: 'database', desc: '存储用量与配额' },
  { id: 'index',    label: '索引',       icon: 'search',   desc: '语义索引状态与重建' },
  { id: 'about',    label: '关于',       icon: 'info',     desc: '产品定位与版本信息' },
];

// ---- 搜索索引（title 命中权重高于 keywords；keywords 覆盖中英文与口语别名） ----
export const SETTINGS_INDEX = [
  { section: 'account',  anchor: 'profile',    title: '账户信息',       keywords: ['账户', '用户名', '角色', '状态', '注册时间', 'account', 'profile'] },
  { section: 'account',  anchor: 'history',    title: '登录历史',       keywords: ['登录', '历史', '记录', '活动', '新设备', 'login', 'history'] },
  { section: 'account',  anchor: 'logout',     title: '退出登录',       keywords: ['退出', '登出', 'logout'] },
  { section: 'security', anchor: 'password',   title: '修改密码',       keywords: ['密码', '改密', '重置', 'password', 'change'] },
  { section: 'privacy',  anchor: 'pii',        title: 'PII 服务端脱敏', keywords: ['隐私', '脱敏', '遮罩', '身份证', '手机', '邮箱', 'api key', '银行卡', 'pii', 'mask', 'privacy'] },
  { section: 'privacy',  anchor: 'download',   title: '临时下载',       keywords: ['隐私', '下载', '窗口', '授权', '零痕迹', '单次', 'download', 'grant'] },
  { section: 'devices',  anchor: 'tokens',     title: '访问令牌',       keywords: ['令牌', '设备', '会话', '守护进程', 'daemon', '创建令牌', 'token'] },
  { section: 'devices',  anchor: 'revoke-all', title: '紧急吊销全部',   keywords: ['吊销', '下线', '离职', '紧急', 'revoke', '退出其他设备', 'token'] },
  { section: 'storage',  anchor: 'stats',      title: '存储统计',       keywords: ['存储', '用量', '配额', '空间', '磁盘', '文件总数', 'storage', 'stats', 'quota'] },
  { section: 'index',    anchor: 'reindex',    title: '全文索引',       keywords: ['索引', '重建', '语义', '搜索', '搜索不准', 'index', 'reindex', 'rebuild', 'search'] },
];

// 旧 Tab id → 新章节 id 兼容映射（localStorage 旧偏好 / 旧 openSettings 调用方）
const LEGACY_TAB_MAP = { general: 'storage' };

// 已删除/迁移锚点的重定向（深链救援的补充：锚点本体已不存在，指向新家）
// quota 卡片从账户章移除（与存储章重复）→ 指到存储统计
const LEGACY_ANCHOR_REDIRECT = { quota: { section: 'storage', anchor: 'stats' } };

export function getSection(id) {
  return SETTINGS_SECTIONS.find(s => s.id === id) || null;
}

// 章节 id 归一：新 id 直通，旧 id 映射，非法值回落默认章节 account（永不抛错）
export function normalizeSectionId(id) {
  const raw = String(id || '').toLowerCase();
  const mapped = LEGACY_TAB_MAP[raw] || raw;
  return SETTINGS_SECTIONS.some(s => s.id === mapped) ? mapped : 'account';
}

// 锚点校验：仅接受 SETTINGS_INDEX 中登记的锚点，非法/缺失返回 null（防 hash 注入）
export function normalizeAnchor(section, anchor) {
  if (!anchor) return null;
  const raw = String(anchor).toLowerCase();
  return SETTINGS_INDEX.some(it => it.section === section && it.anchor === raw) ? raw : null;
}

// 解析 #/settings/<section>[/<anchor>] → { section, anchor }
// 非法输入（含 XSS 尝试）一律回落 { section: 'account', anchor: null }
// 锚点搬家救援：IA 拆分后锚点迁往新章节（security/pii→privacy/pii 等），
// 旧深链的锚点不属于该章节时按注册表全局反查纠正章节——白名单成员校验不放宽。
export function parseSettingsHash(hash) {
  const m = /^#\/settings\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?\/?$/i.exec(String(hash || '').trim());
  if (!m) return { section: 'account', anchor: null };
  let section = normalizeSectionId(m[1]);
  let anchor = normalizeAnchor(section, m[2]);
  if (m[2] && !anchor) {
    const hit = SETTINGS_INDEX.find(it => it.anchor === m[2].toLowerCase());
    if (hit) { section = hit.section; anchor = hit.anchor; }
    else {
      const redirect = LEGACY_ANCHOR_REDIRECT[m[2].toLowerCase()];
      if (redirect) { section = redirect.section; anchor = redirect.anchor; }
    }
  }
  return { section, anchor };
}

// 序列化深链（章节非法时归一，锚点非法时丢弃）
export function serializeSettingsHash(section, anchor) {
  const s = normalizeSectionId(section);
  const a = normalizeAnchor(s, anchor);
  return '#/settings/' + s + (a ? '/' + a : '');
}

// 页内搜索：返回命中的设置项（{section, anchor, title}），按相关度排序。
// 规则：查询按空白拆词，每个词都必须命中（AND）；title 命中 +3、前缀再 +2、keywords 命中 +1。
export function filterSettingsIndex(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const item of SETTINGS_INDEX) {
    const title = item.title.toLowerCase();
    const kws = item.keywords.join(' ').toLowerCase();
    let score = 0;
    let hit = true;
    for (const t of tokens) {
      if (title.includes(t)) score += 3;
      else if (kws.includes(t)) score += 1;
      else { hit = false; break; }
    }
    if (hit && title.startsWith(tokens[0])) score += 2;
    if (hit) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, 'zh-Hans-CN'));
  return scored.map(({ item }) => ({ section: item.section, anchor: item.anchor, title: item.title }));
}
