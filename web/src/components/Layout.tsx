import React, { useEffect, useState } from "react";
import { useAuth } from "../stores/auth";
import { api } from "../api/client";
import { formatSize } from "./ui";
import { Icon } from "./Icon";

export interface NavItem {
  key: string;
  label: string;
  icon: string;
  hash: string;
}

const NAV: NavItem[] = [
  { key: "files", label: "文件库", icon: "folder", hash: "#/files" },
  { key: "chat", label: "AI 助手", icon: "sparkles", hash: "#/chat" },
  { key: "notes", label: "笔记", icon: "note", hash: "#/notes" },
  { key: "transfer", label: "传输助手", icon: "package", hash: "#/transfer" },
  { key: "trash", label: "回收站", icon: "trash", hash: "#/trash" },
  { key: "settings", label: "设置", icon: "settings", hash: "#/settings" },
];

/** hash 路由当前段（#/files/... → files）。 */
export function useCurrentView(): string {
  const [view, setView] = useState(() => parseHash());
  useEffect(() => {
    const onChange = () => setView(parseHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return view;
}

function parseHash(): string {
  const h = window.location.hash.replace(/^#\/?/, "");
  return h.split("/")[0] || "files";
}

export function navigate(hash: string) {
  window.location.hash = hash;
}

export function Layout({ children }: { children: React.ReactNode }) {
  const view = useCurrentView();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);

  useEffect(() => {
    api
      .get("/api/files/stats")
      .then((s) =>
        setUsage({ used: s.used_bytes ?? s.used ?? 0, quota: (s.quota_mb ?? 0) * 1024 * 1024 }),
      )
      .catch(() => {});
  }, [view]);

  return (
    <div className="flex h-full">
      {/* 侧栏 */}
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-line bg-sidebar">
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-[15px] font-bold text-white shadow-1">
            随
          </div>
          <div>
            <div className="text-[15px] font-semibold leading-tight">随行档</div>
            <div className="text-[11px] text-ink-muted">私人文件中枢</div>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 px-3">
          {NAV.map((item) => {
            const active = view === item.key;
            return (
              <button
                key={item.key}
                onClick={() => navigate(item.hash)}
                className={`group relative flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13.5px] transition-all duration-150 ${
                  active
                    ? "bg-primary-soft font-medium text-primary"
                    : "text-ink-secondary hover:bg-surface-hover hover:text-ink"
                }`}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r bg-primary" />
                )}
                <Icon
                  name={item.icon}
                  size={16}
                  className={active ? "text-primary" : "opacity-80 group-hover:opacity-100"}
                />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* 存储用量 */}
        <div className="mx-3 mb-3 rounded-md bg-sunken px-3 py-2.5">
          <div className="mb-1.5 flex items-center justify-between text-[11.5px] text-ink-muted">
            <span>存储空间</span>
            {usage && usage.quota > 0 && (
              <span>
                {formatSize(usage.used)} / {formatSize(usage.quota)}
              </span>
            )}
            {usage && usage.quota <= 0 && <span>{formatSize(usage.used)} · 不限</span>}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{
                width: usage && usage.quota > 0 ? `${Math.min(100, (usage.used / usage.quota) * 100)}%` : "4%",
              }}
            />
          </div>
        </div>
      </aside>

      {/* 主区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-line bg-surface px-6">
          <div className="text-[15px] font-medium">
            {NAV.find((n) => n.key === view)?.label || "随行档"}
          </div>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-md px-2.5 py-1.5 transition-colors hover:bg-surface-hover"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-soft text-[12px] font-semibold text-primary">
                {(user?.username || "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="text-[13px] text-ink-secondary">{user?.username}</span>
              <Icon name="chevron-down" size={12} className="text-ink-muted" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full z-40 mt-1 w-44 rounded-md border border-line bg-surface py-1 shadow-2 animate-[popIn_.12s_ease-out]">
                  <button
                    className="w-full px-3.5 py-2 text-left text-[13px] text-ink-secondary transition-colors hover:bg-surface-hover"
                    onClick={() => {
                      setMenuOpen(false);
                      navigate("#/settings");
                    }}
                  >
                    账户设置
                  </button>
                  <button
                    className="w-full px-3.5 py-2 text-left text-[13px] text-danger transition-colors hover:bg-danger-soft"
                    onClick={async () => {
                      setMenuOpen(false);
                      await logout();
                      navigate("#/login");
                    }}
                  >
                    退出登录
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
