#!/usr/bin/env node
// F17 cache-busting 检查：防止改了前端静态文件却忘了升 ?v=（浏览器命中旧缓存）。
// 规则：若 git diff 含被 ?v= 引用的 .js/.css，则对应 HTML 必须也在 diff（说明 ?v= 已 bump）。
// CI 用：环境变量 BASE 指定比对基线（如 origin/main）。本地可 BASE=main node 跑。
// 顾问模式（CI continue-on-error）：git 不可用时跳过，不阻塞。
import { execSync } from 'node:child_process';

const base = process.env.BASE || 'HEAD~1';

let diff;
try {
  diff = execSync(`git diff --name-only ${base}...HEAD`, { encoding: 'utf8' })
    .trim().split('\n').filter(Boolean);
} catch (e) {
  console.log(`⚠ 无法获取 git diff（跳过 cache-busting 检查）：${(e.message || '').split('\n')[0]}`);
  process.exit(0);
}

if (!diff.length) {
  console.log('✓ 无改动，cache-busting 检查跳过');
  process.exit(0);
}

// 被版本戳引用的静态文件 → 必须与对应 HTML 同步 bump ?v=
const rules = [
  { asset: 'server/app/web/assets/app.js',   html: 'server/app/web/index.html' },
  { asset: 'server/app/web/assets/app.css',  html: 'server/app/web/index.html' },
  { asset: 'server/app/web/assets/admin.js', html: 'server/app/web/admin/index.html' },
  { asset: 'server/app/web/assets/admin.css', html: 'server/app/web/admin/index.html' },
];

const fails = [];
for (const { asset, html } of rules) {
  if (diff.includes(asset) && !diff.includes(html)) {
    fails.push(`✗ 改了 ${asset} 但没改 ${html}（需升 ?v= 破缓存）`);
  }
}

// utils/*.js 被 app.js 以 ?v= import（见 app.js 顶部）：改 utils 需同步升 app.js 的 import ?v= + index.html 的 app.js ?v=
if (diff.some(f => f.startsWith('server/app/web/assets/utils/'))) {
  if (!diff.includes('server/app/web/index.html')) {
    fails.push('✗ 改了 utils/*.js 但没改 index.html（需升 app.js ?v= + app.js 里 utils import 的 ?v=）');
  }
  if (!diff.includes('server/app/web/assets/app.js')) {
    fails.push('✗ 改了 utils/*.js 但没改 app.js（需同步升 utils import 的 ?v=，否则浏览器命中旧 utils 缓存）');
  }
}
// lib/ vendor（marked/dompurify/highlight/katex/mermaid，由 index.html/admin.html 用 ?v= 引用）：改 lib 需升对应 ?v=
if (diff.some(f => f.startsWith('server/app/web/assets/lib/')) &&
    !diff.includes('server/app/web/index.html') &&
    !diff.includes('server/app/web/admin/index.html')) {
  fails.push('✗ 改了 lib/*.js/css 但没改 index.html / admin/index.html（需升 lib ?v=）');
}

if (fails.length) {
  console.error(fails.join('\n'));
  console.error('\n修复：在对应 HTML 里把该文件的 ?v=N 升一版。');
  process.exit(1);
}
console.log('✓ cache-busting 检查通过（改动的静态文件都已同步 ?v=）');
