import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { Dialog, ConfirmDialog, EmptyState, FileIcon, Spinner, formatSize, toast } from "../components/ui";
import { formatDateTime } from "../lib/format";

interface FileItem {
  path: string;
  name: string;
  size: number;
  is_dir?: boolean;
  modified_at?: string;
  mime_type?: string;
  [k: string]: any;
}

const TEXT_PREVIEW_EXTS = new Set([
  "txt", "md", "rst", "csv", "json", "yaml", "yml", "xml", "js", "ts", "py",
  "java", "go", "rs", "c", "cpp", "h", "sh", "sql", "ini", "toml", "log",
]);
const IMG_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

export function FilesView() {
  const [dir, setDir] = useState("");
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [rename, setRename] = useState<FileItem | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [del, setDel] = useState<FileItem | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const [preview, setPreview] = useState<{ file: FileItem; kind: "text" | "image" | "other"; body?: string } | null>(null);
  const [stepUp, setStepUp] = useState<{ after: () => void; password: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const r = await api.get("/api/files/list", { query: { directory: d } });
      setItems(r.items || []);
      setDir(d);
    } catch (e: any) {
      toast(e.message || "加载失败", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load("");
  }, [load]);

  /* ---- 上传 ---- */
  const doUpload = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    for (const f of list) {
      setUploading((u) => [...u, f.name]);
      const form = new FormData();
      form.append("file", f);
      try {
        await api.postForm(`/api/files/upload?directory=${encodeURIComponent(dir)}`, form);
        toast(`已上传 ${f.name}`, "success");
      } catch (e: any) {
        toast(`${f.name}：${e.message || "上传失败"}`, "error");
      } finally {
        setUploading((u) => u.filter((n) => n !== f.name));
      }
    }
    load(dir);
  };

  /* ---- step-up 下载授权（403 时触发） ---- */
  const withGrant = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e: any) {
      if (e.status === 403) {
        setStepUp({ password: "", after: fn });
      } else {
        toast(e.message || "操作失败", "error");
      }
    }
  };

  const submitGrant = async () => {
    if (!stepUp) return;
    setBusyAction(true);
    try {
      await api.post("/api/files/download-grant", { password: stepUp.password, minutes: 15 });
      const after = stepUp.after;
      setStepUp(null);
      await after();
    } catch (e: any) {
      toast(e.message || "验证失败", "error");
    } finally {
      setBusyAction(false);
    }
  };

  /* ---- 预览 ---- */
  const openPreview = (f: FileItem) =>
    withGrant(async () => {
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      if (TEXT_PREVIEW_EXTS.has(ext)) {
        const r = await api.get("/api/files/preview-text", { query: { path: f.path } });
        setPreview({ file: f, kind: "text", body: r.content ?? r.text ?? "" });
      } else if (IMG_EXTS.has(ext)) {
        setPreview({ file: f, kind: "image" });
      } else {
        setPreview({ file: f, kind: "other" });
      }
    });

  const download = (f: FileItem) =>
    withGrant(async () => {
      const a = document.createElement("a");
      a.href = `/api/files/download?path=${encodeURIComponent(f.path)}`;
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });

  /* ---- 重命名 / 删除 ---- */
  const submitRename = async () => {
    if (!rename || !renameTo.trim()) return;
    setBusyAction(true);
    try {
      await api.put("/api/files/rename", { path: rename.path, new_name: renameTo.trim() });
      toast("已重命名", "success");
      setRename(null);
      load(dir);
    } catch (e: any) {
      toast(e.message || "重命名失败", "error");
    } finally {
      setBusyAction(false);
    }
  };

  const submitDelete = async () => {
    if (!del) return;
    setBusyAction(true);
    try {
      await api.del("/api/files", { query: { path: del.path } });
      toast(`已移入回收站：${del.name}`, "success");
      setDel(null);
      load(dir);
    } catch (e: any) {
      toast(e.message || "删除失败", "error");
    } finally {
      setBusyAction(false);
    }
  };

  const crumbs = dir ? dir.split("/") : [];

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) doUpload(e.dataTransfer.files);
      }}
    >
      {/* 工具条 */}
      <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-6 py-3">
        <div className="flex min-w-0 items-center gap-1 text-[13.5px]">
          <button className="rounded px-1.5 py-0.5 text-ink-secondary transition-colors hover:bg-surface-hover hover:text-primary" onClick={() => load("")}>
            全部文件
          </button>
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-line-strong">/</span>
              <button
                className="rounded px-1.5 py-0.5 text-ink-secondary transition-colors hover:bg-surface-hover hover:text-primary"
                onClick={() => load(crumbs.slice(0, i + 1).join("/"))}
              >
                {c}
              </button>
            </span>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {uploading.length > 0 && (
            <span className="flex items-center gap-1.5 text-[12.5px] text-ink-muted">
              <Spinner className="h-3.5 w-3.5" /> 上传中 {uploading.length} 个…
            </span>
          )}
          <button className="btn-primary" onClick={() => fileInput.current?.click()}>
            ⬆ 上传文件
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && doUpload(e.target.files)}
          />
        </div>
      </div>

      {/* 列表 */}
      <div className="relative flex-1 overflow-auto px-6 py-4">
        {dragOver && (
          <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary-soft/80 text-[15px] font-medium text-primary">
            松手上传到{dir ? ` ${dir}` : "根目录"}
          </div>
        )}
        {loading ? (
          <div className="space-y-2 pt-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-11 animate-pulse rounded-md bg-sunken" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="这个目录还是空的"
            hint="拖拽文件到此处，或点击右上角上传。也可以让 AI 助手帮你整理。"
            action={
              <button className="btn-primary" onClick={() => fileInput.current?.click()}>
                ⬆ 上传第一个文件
              </button>
            }
          />
        ) : (
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr className="text-left text-[12px] text-ink-muted">
                <th className="border-b border-line pb-2 font-medium">名称</th>
                <th className="w-24 border-b border-line pb-2 font-medium">大小</th>
                <th className="w-40 border-b border-line pb-2 font-medium">修改时间</th>
                <th className="w-36 border-b border-line pb-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((f) => (
                <tr key={f.path} className="group transition-colors hover:bg-surface-hover/60">
                  <td className="border-b border-line-light py-2.5">
                    <button
                      className="flex items-center gap-2.5 text-left"
                      onClick={() => (f.is_dir ? load(f.path) : openPreview(f))}
                    >
                      <span className="text-[17px]">{f.is_dir ? "📁" : <FileIcon name={f.name} />}</span>
                      <span className="max-w-[380px] truncate text-[13.5px] hover:text-primary">{f.name}</span>
                      {f.pinned && <span className="text-[11px]">⭐</span>}
                    </button>
                  </td>
                  <td className="border-b border-line-light py-2.5 text-[12.5px] text-ink-muted">
                    {f.is_dir ? "—" : formatSize(f.size)}
                  </td>
                  <td className="border-b border-line-light py-2.5 text-[12.5px] text-ink-muted">
                    {f.modified_at ? formatDateTime(f.modified_at) : "—"}
                  </td>
                  <td className="border-b border-line-light py-2.5">
                    {!f.is_dir && (
                      <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button className="row-btn" onClick={() => openPreview(f)} title="预览">👁</button>
                        <button className="row-btn" onClick={() => download(f)} title="下载">⬇</button>
                        <button
                          className="row-btn"
                          title="重命名"
                          onClick={() => {
                            setRename(f);
                            setRenameTo(f.name);
                          }}
                        >
                          ✏️
                        </button>
                        <button className="row-btn hover:!text-danger" title="删除" onClick={() => setDel(f)}>🗑</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 重命名 */}
      <Dialog open={!!rename} onClose={() => setRename(null)} title="重命名">
        <input
          className="input w-full"
          value={renameTo}
          onChange={(e) => setRenameTo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitRename()}
          autoFocus
        />
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setRename(null)}>取消</button>
          <button className="btn-primary" onClick={submitRename} disabled={busyAction}>保存</button>
        </div>
      </Dialog>

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        onConfirm={submitDelete}
        title="移入回收站"
        danger
        busy={busyAction}
        confirmText="移入回收站"
        body={<>确定删除「{del?.name}」吗？文件会移入回收站，保留期内可恢复。</>}
      />

      {/* 预览 */}
      <Dialog open={!!preview} onClose={() => setPreview(null)} title={preview?.file.name || ""} width={680}>
        {preview?.kind === "text" && (
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-sunken p-3.5 text-[12.5px] leading-relaxed">
            {preview.body}
          </pre>
        )}
        {preview?.kind === "image" && (
          <img
            src={`/api/files/preview?path=${encodeURIComponent(preview.file.path)}`}
            alt={preview.file.name}
            className="mx-auto max-h-[60vh] rounded-md"
          />
        )}
        {preview?.kind === "other" && (
          <div className="py-6 text-center text-[13px] text-ink-muted">
            该类型不支持在线预览
            <div className="mt-3">
              <button className="btn-primary" onClick={() => download(preview.file)}>⬇ 下载文件</button>
            </div>
          </div>
        )}
      </Dialog>

      {/* step-up 密码验证 */}
      <Dialog open={!!stepUp} onClose={() => setStepUp(null)} title="安全验证">
        <p className="mb-3 text-[13px] leading-relaxed text-ink-secondary">
          预览/下载文件需要先验证密码（开启 15 分钟临时授权窗口）。
        </p>
        <input
          className="input w-full"
          type="password"
          placeholder="账户密码"
          value={stepUp?.password || ""}
          onChange={(e) => setStepUp((s) => (s ? { ...s, password: e.target.value } : s))}
          onKeyDown={(e) => e.key === "Enter" && submitGrant()}
          autoFocus
        />
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setStepUp(null)}>取消</button>
          <button className="btn-primary" onClick={submitGrant} disabled={busyAction}>
            {busyAction && <Spinner className="mr-1.5 border-white border-t-transparent" />}
            验证并继续
          </button>
        </div>
      </Dialog>
    </div>
  );
}
