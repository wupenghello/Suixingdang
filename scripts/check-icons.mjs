#!/usr/bin/env node
// 图标系统一致性校验：
//   1. 三端 sprite（canonical / web / admin / landing）symbol id 集合完全一致
//   2. 源码（web/src + admin/assets）无 emoji 图标残留
// 供 CI（.github/workflows/test.yml webapp job）与本地 scripts/build_web.sh 调用。
// 退出码非 0 即失败。
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const log = (...a) => console.log("[check-icons]", ...a);
const fail = (m) => {
  console.error("[check-icons] FAIL:", m);
  process.exit(1);
};

/* ---- 1. sprite symbol id parity ---- */
const SPRITE_FILES = [
  "web/public/assets/icons.svg",
  "web/index.html",
  "server/app/web/admin/index.html",
  "server/app/web/landing.html",
];
const SYM_RE = /<symbol id="(sx-ico-[a-z0-9-]+)"/g;
const ids = (file) => {
  const s = readFileSync(resolve(root, file), "utf8");
  return new Set([...s.matchAll(SYM_RE)].map((m) => m[1]));
};

const sets = SPRITE_FILES.map((f) => ({ f, s: ids(f) }));
const base = sets[0].s;
if (base.size === 0) fail("canonical icons.svg 无 symbol");
log("canonical symbols:", base.size);
for (const { f, s } of sets) {
  const missing = [...base].filter((x) => !s.has(x));
  const extra = [...s].filter((x) => !base.has(x));
  if (missing.length || extra.length) {
    fail(`${f}: missing=[${missing.join(",")}] extra=[${extra.join(",")}]`);
  }
  log(`${f}: ${s.size} symbols OK`);
}
log(`sprite parity OK across ${sets.length} surfaces`);

/* ---- 2. emoji 图标残留扫描 ---- */
// 覆盖：emoji 表情 / 杂项符号 / 印刷符号 / 技术符号(⏳) / 箭头 / 几何(⬆⬇)
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}☀-⛿✀-➿⌀-⏿⬀-⯿←-⇿]/u;
function scanDir(dir, exts, out = []) {
  let entries;
  try {
    entries = readdirSync(resolve(root, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      scanDir(rel, exts, out);
      continue;
    }
    if (e.name.includes(".test.")) continue;
    if (!exts.some((x) => e.name.endsWith(x))) continue;
    const lines = readFileSync(resolve(root, rel), "utf8").split("\n");
    lines.forEach((l, i) => {
      const t = l.trim();
      // 跳过注释行（// / * / /*）——文本箭头 -> 等合法存在于注释，非图标
      if (/^(\/\/|\*|\/\*)/.test(t)) return;
      if (EMOJI_RE.test(l)) out.push(`${rel}:${i + 1}  ${t.slice(0, 60)}`);
    });
  }
  return out;
}

const hits = [
  ...scanDir("web/src", [".ts", ".tsx"]),
  ...scanDir("server/app/web/admin/assets", [".js"]),
];
if (hits.length) {
  fail(`emoji 图标残留 ${hits.length} 处（应为线性 <Icon>/<use>）：\n${hits.join("\n")}`);
}
log("无 emoji 图标残留（web/src + admin/assets）");

log("ALL OK ✔");
