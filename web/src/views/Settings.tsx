import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { ConfirmDialog, Dialog, Spinner, formatSize } from "../components/ui";
// toast 实际导出在 stores/toast（ui.tsx 未再导出，与 Files.tsx 的既有写法不同）
import { toast } from "../stores/toast";
import { formatDateTime, relativeTime } from "../lib/format";

/* ================= 分区定义 ================= */

const SECTIONS = [
  { key: "password", label: "修改密码", icon: "🔑" },
  { key: "history", label: "登录历史", icon: "🕘" },
  { key: "tokens", label: "设备令牌", icon: "🎟" },
  { key: "storage", label: "存储统计", icon: "📊" },
  { key: "about", label: "关于", icon: "ℹ️" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

/* ================= 修改密码 ================= */

const pwdHint = "至少 8 位，需同时包含字母和数字";

function PasswordSection() {
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    if (!oldPwd) return setErr("请输入当前密码");
    const strong = newPwd.length >= 8 && /[a-zA-Z]/.test(newPwd) && /\d/.test(newPwd);
    if (!strong) return setErr(`新密码不满足要求：${pwdHint}`);
    if (newPwd !== confirmPwd) return setErr("两次输入的新密码不一致");
    setBusy(true);
    try {
      await api.post("/api/auth/change-password", { old_password: oldPwd, new_password: newPwd });
      toast("密码已修改", "success");
      setOldPwd("");
      setNewPwd("");
      setConfirmPwd("");
    } catch (e: any) {
      // 422 = 新密码不合规（后端 validate_password），其余按通用错误
      setErr(e.status === 422 ? e.message : e.message || "修改失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard title="修改密码" desc="修改后当前浏览器保持登录，其他设备不受影响。">
      <div className="max-w-sm space-y-3.5">
        <Field label="当前密码">
          <input className="input" type="password" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} placeholder="登录用的密码" />
        </Field>
        <Field label="新密码" hint={pwdHint}>
          <input className="input" type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder="至少 8 位，含字母和数字" />
        </Field>
        <Field label="确认新密码">
          <input
            className="input"
            type="password"
            value={confirmPwd}
            onChange={(e) => setConfirmPwd(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="再输一次新密码"
          />
        </Field>
        {err && <div className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger">⚠ {err}</div>}
        <button className="btn-primary" onClick={submit} disabled={busy}>
          {busy && <Spinner className="mr-1.5 border-white border-t-transparent" />}
          确认修改
        </button>
      </div>
    </SectionCard>
  );
}

/* ================= 登录历史 ================= */

const ACTION_LABEL: Record<string, string> = {
  login_success: "登录成功",
  login_failed: "登录失败",
  login_locked: "登录锁定",
  login_blocked: "登录拦截",
  login_new_device: "新设备登录",
  register: "注册账号",
  password_changed: "修改密码",
  password_reset_success: "重置密码成功",
  password_reset_failed: "重置密码失败",
  stepup_failed: "安全验证失败",
  revoke_other_tokens: "退出其他设备",
  revoke_all_tokens: "紧急下线全部设备",
  download_grant: "下载授权",
  download_grant_single: "单次下载授权",
  download_revoke: "撤销下载授权",
};

const RISK_ACTIONS = new Set(["login_failed", "login_locked", "login_blocked", "stepup_failed", "password_reset_failed"]);

function HistorySection() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/auth/login-history", { query: { limit: 20 } });
      setItems(r.items || []);
    } catch (e: any) {
      toast(e.message || "加载登录历史失败", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SectionCard title="登录历史" desc="最近 20 条安全事件（登录、改密、授权等）。">
      {loading ? (
        <div className="space-y-2 pt-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-sunken" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="py-8 text-center text-[13px] text-ink-muted">暂无记录</div>
      ) : (
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr className="text-left text-[12px] text-ink-muted">
              <th className="w-40 border-b border-line pb-2 font-medium">时间</th>
              <th className="border-b border-line pb-2 font-medium">事件</th>
              <th className="w-32 border-b border-line pb-2 font-medium">IP</th>
              <th className="w-28 border-b border-line pb-2 font-medium">地域</th>
              <th className="w-44 border-b border-line pb-2 font-medium">设备</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const risky = RISK_ACTIONS.has(it.action);
              return (
                <tr key={i} className="transition-colors hover:bg-surface-hover/60">
                  <td className="border-b border-line-light py-2.5 text-[12.5px] tabular-nums text-ink-muted">
                    {it.created_at ? formatDateTime(it.created_at) : "—"}
                  </td>
                  <td className="border-b border-line-light py-2.5">
                    <span className={`text-[13px] font-medium ${risky ? "text-danger" : "text-ink"}`}>
                      {ACTION_LABEL[it.action] || it.action}
                    </span>
                    {it.detail && (
                      <div className="max-w-[320px] truncate text-[11.5px] text-ink-muted" title={it.detail}>
                        {it.detail}
                      </div>
                    )}
                  </td>
                  <td className="border-b border-line-light py-2.5 font-mono text-[12px] text-ink-secondary">
                    {it.ip || "—"}
                  </td>
                  <td className="border-b border-line-light py-2.5 text-[12.5px] text-ink-muted">{it.geo || "—"}</td>
                  <td className="border-b border-line-light py-2.5">
                    <span className="block max-w-[170px] truncate text-[12px] text-ink-muted" title={it.user_agent || ""}>
                      {it.user_agent || "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

/* ================= 设备令牌 ================= */

function TokensSection() {
  const [tokens, setTokens] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState("0");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ token: string; label: string } | null>(null);
  const [revokeId, setRevokeId] = useState<any | null>(null);
  const [revokeOthers, setRevokeOthers] = useState(false);
  const [busyAction, setBusyAction] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/auth/tokens");
      // 后端直接返回数组；兼容 {tokens: []} 包裹
      setTokens(Array.isArray(r) ? r : r.tokens || []);
    } catch (e: any) {
      toast(e.message || "加载令牌失败", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const doCreate = async () => {
    setCreating(true);
    try {
      // 后端以 Query 参数接收 label / expires_days
      const qs = new URLSearchParams({ label: label.trim() || "device", expires_days: days });
      const r = await api.post(`/api/auth/tokens?${qs.toString()}`);
      setCreated({ token: r.token || r.access_token || "", label: label.trim() || "device" });
      setLabel("");
      load();
    } catch (e: any) {
      toast(e.message || "创建失败", "error");
    } finally {
      setCreating(false);
    }
  };

  const submitRevoke = async () => {
    if (!revokeId) return;
    setBusyAction(true);
    try {
      await api.del(`/api/auth/tokens/${encodeURIComponent(revokeId.id)}`);
      toast(`已吊销：${revokeId.label || "令牌"}`, "success");
      setRevokeId(null);
      load();
    } catch (e: any) {
      toast(e.message || "吊销失败", "error");
    } finally {
      setBusyAction(false);
    }
  };

  const submitRevokeOthers = async () => {
    setBusyAction(true);
    try {
      const r = await api.del("/api/auth/tokens-others");
      toast(r?.message || "已退出其他设备", "success");
      setRevokeOthers(false);
      load();
    } catch (e: any) {
      toast(e.message || "操作失败", "error");
    } finally {
      setBusyAction(false);
    }
  };

  const copyToken = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      toast("已复制到剪贴板", "success");
    } catch {
      toast("复制失败，请手动选中复制", "error");
    }
  };

  return (
    <SectionCard title="设备令牌" desc="为命令行、脚本或移动设备签发长期令牌；当前浏览器会话不受影响。">
      {/* 创建表单 */}
      <div className="mb-5 flex flex-wrap items-end gap-2.5 rounded-md bg-sunken px-3.5 py-3">
        <div className="min-w-[160px] flex-1">
          <div className="mb-1 text-[11.5px] text-ink-muted">备注名</div>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="如：MacBook 终端" />
        </div>
        <div>
          <div className="mb-1 text-[11.5px] text-ink-muted">有效期</div>
          <select className="input !w-32" value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="0">永久有效</option>
            <option value="7">7 天</option>
            <option value="30">30 天</option>
            <option value="90">90 天</option>
            <option value="365">1 年</option>
          </select>
        </div>
        <button className="btn-primary" onClick={doCreate} disabled={creating}>
          {creating && <Spinner className="mr-1.5 border-white border-t-transparent" />}
          ＋ 创建令牌
        </button>
        <button className="btn-ghost hover:!border-danger hover:!text-danger" onClick={() => setRevokeOthers(true)}>
          注销其他设备
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-md bg-sunken" />
          ))}
        </div>
      ) : tokens.length === 0 ? (
        <div className="py-8 text-center text-[13px] text-ink-muted">还没有令牌，创建一个试试</div>
      ) : (
        <div className="space-y-2">
          {tokens.map((t) => (
            <div
              key={t.id}
              className={`group flex items-center gap-3 rounded-md border px-3.5 py-2.5 transition-all hover:shadow-1 ${
                t.revoked ? "border-line-light opacity-60" : "border-line hover:border-line-strong"
              }`}
            >
              <span className="text-[16px]">{t.kind === "session" ? "🌐" : "🎟"}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-[13.5px] font-medium">{t.label || "未命名令牌"}</span>
                  <span className="rounded bg-sunken px-1.5 py-px text-[10.5px] text-ink-muted">
                    {t.kind === "session" ? "浏览器会话" : "设备令牌"}
                  </span>
                  {t.is_current && (
                    <span className="rounded bg-primary-soft px-1.5 py-px text-[10.5px] font-medium text-primary">当前设备</span>
                  )}
                  {t.revoked && (
                    <span className="rounded bg-danger-soft px-1.5 py-px text-[10.5px] text-danger">已吊销</span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11.5px] text-ink-muted">
                  <span>创建于 {t.created_at ? formatDateTime(t.created_at) : "—"}</span>
                  <span>{t.last_used_at ? `最近使用 ${relativeTime(t.last_used_at)}` : "从未使用"}</span>
                  <span>{t.expires_at ? `到期 ${formatDateTime(t.expires_at)}` : "永久有效"}</span>
                </div>
              </div>
              {!t.revoked && !t.is_current && (
                <button
                  className="row-btn opacity-0 transition-opacity group-hover:opacity-100 hover:!text-danger"
                  title="吊销该令牌"
                  onClick={() => setRevokeId(t)}
                >
                  ❌
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 一次性明文展示 */}
      <Dialog open={!!created} onClose={() => setCreated(null)} title="令牌已创建" width={520}>
        <p className="mb-3 text-[13px] leading-relaxed text-ink-secondary">
          明文令牌只显示这一次，关闭后无法再查看，请立即复制保存。
        </p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md bg-sunken px-3 py-2.5 font-mono text-[12.5px]">
            {created?.token}
          </code>
          <button className="btn-primary shrink-0" onClick={copyToken}>📋 复制</button>
        </div>
        <div className="mt-4 flex justify-end">
          <button className="btn-ghost" onClick={() => setCreated(null)}>我已保存</button>
        </div>
      </Dialog>

      {/* 吊销单个 */}
      <ConfirmDialog
        open={!!revokeId}
        onClose={() => setRevokeId(null)}
        onConfirm={submitRevoke}
        title="吊销令牌"
        danger
        busy={busyAction}
        confirmText="吊销"
        body={<>确定吊销「{revokeId?.label || "该令牌"}」吗？吊销后使用该令牌的设备将立即失去访问权限。</>}
      />

      {/* 注销其他设备 */}
      <ConfirmDialog
        open={revokeOthers}
        onClose={() => setRevokeOthers(false)}
        onConfirm={submitRevokeOthers}
        title="注销其他设备"
        danger
        busy={busyAction}
        confirmText="注销其他设备"
        body={<>除当前浏览器外，所有设备与会话将被强制下线。确定继续吗？</>}
      />
    </SectionCard>
  );
}

/* ================= 存储统计 ================= */

function StorageSection() {
  const [stats, setStats] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const s = await api.get("/api/files/stats");
        // 字段容错：total_size_mb / used_bytes / used；quota_mb
        const used =
          s.used_bytes ?? s.used ?? ((s.total_size_mb ?? s.total_size ?? 0) as number) * 1024 * 1024;
        const quota = (s.quota_mb ?? 0) * 1024 * 1024;
        setStats({ files: s.total_files ?? s.files ?? 0, used, quota });
      } catch (e: any) {
        toast(e.message || "加载存储统计失败", "error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const pct = stats && stats.quota > 0 ? Math.min(100, (stats.used / stats.quota) * 100) : 0;
  const barColor = pct >= 95 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-primary";

  return (
    <SectionCard title="存储统计" desc="当前账户的文件总量与配额使用情况。">
      {loading || !stats ? (
        <div className="space-y-2">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-sunken" />
          ))}
        </div>
      ) : (
        <div className="max-w-xl space-y-5">
          <div className="grid grid-cols-3 gap-3">
            <StatTile icon="📄" label="文件数" value={String(stats.files)} />
            <StatTile icon="💾" label="已用空间" value={formatSize(stats.used)} />
            <StatTile icon="🗃" label="配额" value={stats.quota > 0 ? formatSize(stats.quota) : "不限"} />
          </div>
          {stats.quota > 0 ? (
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[12px] text-ink-muted">
                <span>使用进度</span>
                <span className="tabular-nums">
                  {formatSize(stats.used)} / {formatSize(stats.quota)}（{pct.toFixed(1)}%）
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-line">
                <div
                  className={`h-full rounded-full ${barColor} transition-all duration-500`}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
              {pct >= 80 && (
                <div className="mt-1.5 text-[12px] text-warning">
                  {pct >= 95 ? "⚠ 空间即将用尽，请清理回收站或删除大文件" : "空间已用大半，建议尽早整理"}
                </div>
              )}
            </div>
          ) : (
            <div className="text-[12.5px] text-ink-muted">当前账户未设配额上限。</div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

/* ================= 关于 ================= */

function AboutSection() {
  return (
    <SectionCard title="关于随行档" desc="">
      <div className="max-w-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-[22px] font-bold text-white shadow-2">
            随
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[17px] font-semibold">随行档</span>
              <span className="rounded bg-primary-soft px-1.5 py-px text-[11px] font-medium text-primary">v2.0</span>
            </div>
            <div className="mt-0.5 text-[12.5px] text-ink-muted">你的私人文件中枢——随手存，随时取</div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {["自托管", "加密归档", "零痕迹"].map((t) => (
            <span key={t} className="rounded-full border border-line bg-surface px-3 py-1 text-[12px] font-medium text-ink-secondary shadow-1">
              {t}
            </span>
          ))}
        </div>
        <p className="mt-4 text-[13px] leading-relaxed text-ink-secondary">
          文件库、AI 助手、笔记、传输助手与回收站的一体化档案室。数据在你自己的服务器上，
          会话令牌仅存于 HttpOnly Cookie，审计只记事件不记内容。
        </p>
      </div>
    </SectionCard>
  );
}

/* ================= 通用小组件 ================= */

function SectionCard({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-5 shadow-1">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {desc && <p className="mt-1 text-[12.5px] text-ink-muted">{desc}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12.5px] font-medium text-ink-secondary">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-ink-muted">{hint}</span>}
    </label>
  );
}

function StatTile({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="rounded-md bg-sunken px-3.5 py-3">
      <div className="flex items-center gap-1.5 text-[12px] text-ink-muted">
        <span>{icon}</span>
        {label}
      </div>
      <div className="mt-1 text-[18px] font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/* ================= 主视图 ================= */

export function SettingsView() {
  const [section, setSection] = useState<SectionKey>("password");

  return (
    <div className="flex h-full">
      {/* 左侧分区导航 */}
      <aside className="w-[200px] shrink-0 border-r border-line bg-sidebar px-3 py-4">
        <nav className="space-y-0.5">
          {SECTIONS.map((s) => {
            const active = section === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setSection(s.key)}
                className={`relative flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13.5px] transition-all duration-150 ${
                  active
                    ? "bg-primary-soft font-medium text-primary"
                    : "text-ink-secondary hover:bg-surface-hover hover:text-ink"
                }`}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r bg-primary" />
                )}
                <span className={`text-[14px] ${active ? "" : "opacity-80"}`}>{s.icon}</span>
                {s.label}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* 右侧内容 */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-[720px]">
          {section === "password" && <PasswordSection />}
          {section === "history" && <HistorySection />}
          {section === "tokens" && <TokensSection />}
          {section === "storage" && <StorageSection />}
          {section === "about" && <AboutSection />}
        </div>
      </div>
    </div>
  );
}
