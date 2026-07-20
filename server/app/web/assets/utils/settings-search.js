// 设置页 · 页内搜索与深链纯函数层（从 app.js 抽离，便于单测；生产仍零构建）
//
// 隐私约定：SETTINGS_INDEX 是纯静态常量，filterSettingsIndex 全程在浏览器内完成匹配——
// 搜索词不发任何请求、不写 localStorage、不落日志（随行档零痕迹 DNA）。
//
// 深链格式：#/settings/<section>[/<anchor>]
//   例：#/settings/security/download → 安全与隐私 · 临时下载

// ---- 章节定义（导航顺序即此数组顺序；about 为导航底部弱化项） ----
export const SETTINGS_SECTIONS = [
  { id: 'account',  label: '账户',       icon: 'user',     desc: '账户信息、配额与登录记录' },
  { id: 'security', label: '安全与隐私', icon: 'shield',   desc: '密码、PII 脱敏与临时下载' },
  { id: 'devices',  label: '设备与会话', icon: 'monitor',  desc: '设备令牌与紧急吊销' },
  { id: 'storage',  label: '存储与索引', icon: 'database', desc: '存储用量与语义索引' },
  { id: 'about',    label: '关于随行档', icon: 'info',     desc: '产品定位与链接' },
];

// ---- 搜索索引（title 命中权重高于 keywords；keywords 覆盖中英文与口语别名） ----
export const SETTINGS_INDEX = [
  { section: 'account',  anchor: 'profile',    title: '账户信息',       keywords: ['账户', '用户名', '角色', '状态', '注册时间', '已用空间', 'account', 'profile'] },
  { section: 'account',  anchor: 'quota',      title: '存储配额',       keywords: ['配额', '空间', '用量', 'quota'] },
  { section: 'account',  anchor: 'history',    title: '登录历史',       keywords: ['登录', '历史', '记录', '新设备', 'login', 'history'] },
  { section: 'account',  anchor: 'logout',     title: '退出登录',       keywords: ['退出', '登出', 'logout'] },
  { section: 'security', anchor: 'password',   title: '修改密码',       keywords: ['密码', '改密', '重置', 'password', 'change'] },
  { section: 'security', anchor: 'pii',        title: 'PII 服务端脱敏', keywords: ['脱敏', '遮罩', '身份证', '手机', '邮箱', 'api key', '银行卡', 'pii', 'mask'] },
  { section: 'security', anchor: 'download',   title: '临时下载',       keywords: ['下载', '窗口', '授权', '零痕迹', '单次', 'download', 'grant'] },
  { section: 'devices',  anchor: 'tokens',     title: '访问令牌',       keywords: ['令牌', '设备', '会话', '守护进程', 'daemon', '创建令牌', 'token'] },
  { section: 'devices',  anchor: 'revoke-all', title: '紧急吊销全部',   keywords: ['吊销', '下线', '离职', '紧急', 'revoke', '退出其他设备', 'token'] },
  { section: 'storage',  anchor: 'stats',      title: '存储统计',       keywords: ['存储', '用量', '磁盘', '文件总数', 'storage', 'stats'] },
  { section: 'storage',  anchor: 'reindex',    title: '全文索引',       keywords: ['索引', '重建', '语义', '搜索', 'index', 'reindex', 'rebuild'] },
];

// 旧 Tab id → 新章节 id 兼容映射（localStorage 旧偏好 / 旧 openSettings 调用方）
const LEGACY_TAB_MAP = { general: 'storage' };

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
export function parseSettingsHash(hash) {
  const m = /^#\/settings\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?\/?$/i.exec(String(hash || '').trim());
  if (!m) return { section: 'account', anchor: null };
  const section = normalizeSectionId(m[1]);
  return { section, anchor: normalizeAnchor(section, m[2]) };
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
