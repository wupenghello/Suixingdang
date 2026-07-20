// 密码强度与客户端结构校验纯函数层（可单测、零依赖、不触网）
//
// 服务端策略（server/app/core/security.py validate_password）是唯一真源：
//   长度 ≥8 / 不在弱口令名单 / 不与用户名相同。
// 客户端只镜像「无需联网也能判定」的两条结构规则（长度、用户名）做实时反馈，
// 弱口令名单（WEAK_PASSWORDS）在服务端演进，前端不复制维护——服务端兜底为准。

// 校验新密码结构。通过返回 null，否则返回错误文案（与 security.py 文案对齐）。
export function validatePasswordClient(password, username = '') {
  const pwd = String(password || '');
  if (!pwd) return '请输入新密码';
  if (pwd.length < 8) return '密码至少 8 个字符';
  if (username && pwd.toLowerCase() === String(username).toLowerCase()) {
    return '密码不能与用户名相同';
  }
  return null;
}

// 强度评分：{ level: 0=空 | 1=弱 | 2=中 | 3=强, label: '' | '弱' | '中' | '强' }
// 依据：长度档位（≥12 得 2 分，≥8 得 1 分）+ 字符类别多样度
// （小写/大写/数字/符号，≥4 类 +2，≥2 类 +1），含用户名重罚 -2（用户名子串是撞库首选）。
// 未达 8 位或等于用户名直接判弱——长度不达标时多样性没有意义。
export function scorePasswordStrength(password, username = '') {
  const pwd = String(password || '');
  if (!pwd) return { level: 0, label: '' };
  const uname = String(username || '').toLowerCase();
  if (pwd.length < 8 || (uname && pwd.toLowerCase() === uname)) {
    return { level: 1, label: '弱' };
  }
  let score = pwd.length >= 12 ? 2 : 1;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pwd)).length;
  if (kinds >= 4) score += 2;
  else if (kinds >= 2) score += 1;
  if (uname && pwd.toLowerCase().includes(uname)) score -= 2;
  if (score <= 1) return { level: 1, label: '弱' };
  if (score === 2) return { level: 2, label: '中' };
  return { level: 3, label: '强' };
}
