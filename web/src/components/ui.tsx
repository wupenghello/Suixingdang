import React, { useEffect, useRef } from "react";
import { useToast } from "../stores/toast";
import { Icon } from "./Icon";

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
  icon = "folder",
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
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <Icon name={icon} size={36} className="text-ink-muted opacity-70" />
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
            <Icon name="x" size={16} />
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
  const kindIcon: Record<string, React.ReactNode> = {
    success: <Icon name="circle-check" size={15} className="text-success" />,
    error: <Icon name="circle-x" size={15} className="text-danger" />,
    info: <Icon name="info" size={15} className="text-primary" />,
  };
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto cursor-pointer rounded-md bg-surface px-4 py-3 shadow-2 animate-[slideIn_.2s_ease-out] ${kindStyle[t.kind]}`}
        >
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0">{kindIcon[t.kind]}</span>
            <span className="flex-1 text-[13px] leading-relaxed text-ink">{t.text}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- 按钮样式（全局 class，见 styles.css 追加） ---------- */

/* ---------- 文件图标（线性 file-* + --type-* 语义色着色） ---------- */

type FileKind = { icon: string; color: string };

const EXT_KIND: Record<string, FileKind> = {
  pdf: { icon: "file-text", color: "var(--color-type-pdf)" },
  doc: { icon: "file-text", color: "var(--color-type-doc)" },
  docx: { icon: "file-text", color: "var(--color-type-doc)" },
  xls: { icon: "file-spreadsheet", color: "var(--color-type-xls)" },
  xlsx: { icon: "file-spreadsheet", color: "var(--color-type-xls)" },
  csv: { icon: "file-spreadsheet", color: "var(--color-type-xls)" },
  ppt: { icon: "file-presentation", color: "var(--color-type-ppt)" },
  pptx: { icon: "file-presentation", color: "var(--color-type-ppt)" },
  md: { icon: "file-text", color: "var(--color-type-md)" },
  txt: { icon: "file-text", color: "var(--color-type-md)" },
  rst: { icon: "file-text", color: "var(--color-type-md)" },
  png: { icon: "file-image", color: "var(--color-type-img)" },
  jpg: { icon: "file-image", color: "var(--color-type-img)" },
  jpeg: { icon: "file-image", color: "var(--color-type-img)" },
  gif: { icon: "file-image", color: "var(--color-type-img)" },
  webp: { icon: "file-image", color: "var(--color-type-img)" },
  svg: { icon: "file-image", color: "var(--color-type-img)" },
  mp3: { icon: "file-audio", color: "var(--color-type-audio)" },
  wav: { icon: "file-audio", color: "var(--color-type-audio)" },
  mp4: { icon: "file-video", color: "var(--color-type-video)" },
  mov: { icon: "file-video", color: "var(--color-type-video)" },
  zip: { icon: "file-archive", color: "var(--color-type-archive)" },
  rar: { icon: "file-archive", color: "var(--color-type-archive)" },
  "7z": { icon: "file-archive", color: "var(--color-type-archive)" },
  py: { icon: "file-code", color: "var(--color-type-code)" },
  js: { icon: "file-code", color: "var(--color-type-code)" },
  ts: { icon: "file-code", color: "var(--color-type-code)" },
  html: { icon: "file-code", color: "var(--color-type-code)" },
  sql: { icon: "file-code", color: "var(--color-type-code)" },
  json: { icon: "file-code", color: "var(--color-type-text)" },
  yaml: { icon: "file-code", color: "var(--color-type-text)" },
  yml: { icon: "file-code", color: "var(--color-type-text)" },
};
const DEFAULT_KIND: FileKind = { icon: "file", color: "var(--color-type-other)" };

export function FileIcon({
  name,
  size = 17,
  className = "",
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const kind = EXT_KIND[ext] || DEFAULT_KIND;
  return (
    <Icon
      name={kind.icon}
      size={size}
      className={className}
      style={{ color: kind.color }}
    />
  );
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
