import React, { useEffect, useRef } from "react";
import { useToast } from "../stores/toast";

export { toast } from "../stores/toast";

/* ---------- 基础 UI 原语：Spinner / EmptyState / Dialog / Confirm ---------- */

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent align-middle ${className}`}
      aria-label="加载中"
    />
  );
}

export function EmptyState({
  icon = "🗂",
  title,
  hint,
  action,
}: {
  icon?: string;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <div className="text-4xl opacity-70">{icon}</div>
      <div className="text-[15px] font-medium text-ink-secondary">{title}</div>
      {hint && <div className="max-w-sm text-[13px] text-ink-muted">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  width = 420,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 backdrop-blur-[2px] animate-[fadeIn_.15s_ease-out]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={ref}
        style={{ width }}
        className="max-w-[92vw] rounded-lg bg-surface shadow-3 animate-[popIn_.18s_ease-out]"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h3 className="text-[15px] font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-sm p-1 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
            aria-label="关闭"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = "确认操作",
  body,
  confirmText = "确认",
  danger = false,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  body: React.ReactNode;
  confirmText?: string;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="text-[13.5px] leading-relaxed text-ink-secondary">{body}</div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose} disabled={busy}>
          取消
        </button>
        <button
          className={danger ? "btn-danger" : "btn-primary"}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy && <Spinner className="mr-1.5 border-white border-t-transparent" />}
          {confirmText}
        </button>
      </div>
    </Dialog>
  );
}

/* ---------- Toast 视口 ---------- */

export function ToastViewport() {
  const { toasts, dismiss } = useToast();
  const kindStyle: Record<string, string> = {
    success: "border-l-4 border-l-success",
    error: "border-l-4 border-l-danger",
    info: "border-l-4 border-l-primary",
  };
  const kindIcon: Record<string, string> = { success: "✓", error: "✕", info: "ℹ" };
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto cursor-pointer rounded-md bg-surface px-4 py-3 shadow-2 animate-[slideIn_.2s_ease-out] ${kindStyle[t.kind]}`}
        >
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 text-[13px] font-bold text-ink-muted">{kindIcon[t.kind]}</span>
            <span className="flex-1 text-[13px] leading-relaxed text-ink">{t.text}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- 按钮样式（全局 class，见 styles.css 追加） ---------- */

/* ---------- 文件图标 ---------- */

const EXT_ICON: Record<string, string> = {
  pdf: "📕", doc: "📘", docx: "📘", xls: "📗", xlsx: "📗", ppt: "📙", pptx: "📙",
  md: "📝", txt: "📝", rst: "📝", csv: "📊", json: "🧾", yaml: "🧾", yml: "🧾",
  png: "🖼", jpg: "🖼", jpeg: "🖼", gif: "🖼", webp: "🖼", svg: "🖼",
  mp3: "🎵", wav: "🎵", mp4: "🎬", mov: "🎬", zip: "🗜", rar: "🗜", "7z": "🗜",
  py: "🐍", js: "📜", ts: "📜", html: "🌐", sql: "🗄",
};

export function FileIcon({ name, className = "" }: { name: string; className?: string }) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return <span className={`select-none ${className}`}>{EXT_ICON[ext] || "📄"}</span>;
}

export function formatSize(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${i === 0 ? n : n.toFixed(n >= 100 ? 0 : 1)} ${units[i]}`;
}
