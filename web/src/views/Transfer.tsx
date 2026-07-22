import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { ConfirmDialog, EmptyState, FileIcon, Spinner, formatSize } from "../components/ui";
import { Icon } from "../components/Icon";
// toast 实际导出在 stores/toast（ui.tsx 未再导出，与 Files.tsx 的既有写法不同）
import { toast } from "../stores/toast";
import { formatDateTime, relativeTime } from "../lib/format";

interface TransferFile {
  name: string;
  path: string;
  size: number;
  mime_type?: string;
  guard_status?: string;
  [k: string]: any;
}

interface TransferMsg {
  id: string;
  type: "text" | "file";
  content: string;
  file_id?: string;
  file?: TransferFile | null;
  created_at: string;
  [k: string]: any;
}

const MAX_LEN = 5000;

/** 分组标签：今天 / 昨天 / 7月20日 / 2025年12月1日 */
function dayLabel(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T"));
  if (isNaN(d.getTime())) return iso;
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`;
}

export function TransferView() {
  const [messages, setMessages] = useState<TransferMsg[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [del, setDel] = useState<TransferMsg | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/transfer/messages", { query: { limit: 100 } });
      setMessages(r.messages || []);
    } catch (e: any) {
      toast(e.message || "加载消息失败", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* ---- 发送文字 ---- */
  const sendText = async () => {
    const content = input.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      await api.post("/api/transfer/text", { content });
      setInput("");
      toast("已发送", "success");
      load();
    } catch (e: any) {
      toast(e.message || "发送失败", "error");
    } finally {
      setSending(false);
    }
  };

  /* ---- 发送文件 ---- */
  const sendFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      setUploading(f.name);
      const form = new FormData();
      form.append("file", f);
      try {
        const r = await api.postForm("/api/transfer/file", form);
        toast(r?.guard_warning ? `已传输 ${f.name}（安全扫描有提示，请留意）` : `已传输 ${f.name}`, "success");
      } catch (e: any) {
        toast(`${f.name}：${e.message || "传输失败"}`, "error");
      } finally {
        setUploading(null);
      }
    }
    if (fileInput.current) fileInput.current.value = "";
    load();
  };

  /* ---- 删除消息 ---- */
  const submitDelete = async () => {
    if (!del) return;
    setBusyAction(true);
    try {
      await api.del(`/api/transfer/${encodeURIComponent(del.id)}`);
      toast("已删除", "success");
      setDel(null);
      load();
    } catch (e: any) {
      toast(e.message || "删除失败", "error");
    } finally {
      setBusyAction(false);
    }
  };

  /* ---- 按天分组（组倒序、组内倒序，最新贴着发送区） ---- */
  const groups: { label: string; items: TransferMsg[] }[] = [];
  {
    const map = new Map<string, TransferMsg[]>();
    for (const m of messages) {
      const k = dayLabel(m.created_at);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(m);
    }
    const ts = (m?: TransferMsg) => (m ? new Date(m.created_at.replace(" ", "T")).getTime() || 0 : 0);
    for (const [label, items] of map) {
      groups.push({ label, items: [...items].sort((a, b) => ts(b) - ts(a)) });
    }
    groups.sort((a, b) => ts(b.items[0]) - ts(a.items[0]));
  }

  return (
    <div className="flex h-full flex-col">
      {/* 发送区 */}
      <div className="shrink-0 border-b border-line bg-surface px-6 py-4">
        <div className="mx-auto max-w-[760px]">
          <div className="flex items-end gap-2.5">
            <textarea
              className="input max-h-32 min-h-[44px] flex-1 resize-none !py-2.5"
              placeholder="发一条文字给自己：Enter 发送，Shift+Enter 换行"
              rows={1}
              maxLength={MAX_LEN}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendText();
                }
              }}
            />
            <button
              className="btn-ghost !px-3.5 !py-2.5"
              title="发送文件"
              disabled={!!uploading}
              onClick={() => fileInput.current?.click()}
            >
              {uploading ? <Spinner className="h-4 w-4" /> : <Icon name="paperclip" size={16} />}
            </button>
            <button className="btn-primary !px-4 !py-2.5" onClick={sendText} disabled={!input.trim() || sending}>
              {sending && <Spinner className="mr-1.5 border-white border-t-transparent" />}
              发送
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => sendFiles(e.target.files)}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-ink-muted">
            <span>{uploading ? `正在传输 ${uploading}…` : "文字和文件都会进入统一时间线，文件自动归档到文件库"}</span>
            <span className={`tabular-nums ${input.length >= MAX_LEN ? "text-danger" : ""}`}>
              {input.length}/{MAX_LEN}
            </span>
          </div>
        </div>
      </div>

      {/* 时间线 */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-[760px]">
          {loading ? (
            <div className="space-y-3 pt-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-md bg-sunken" />
              ))}
            </div>
          ) : messages.length === 0 ? (
            <EmptyState
              icon="package"
              title="传输助手还是空的"
              hint="在上方发一条文字，或点附件按钮传一个文件——随手存，随时取，跨设备同步。"
            />
          ) : (
            <div className="space-y-6">
              {groups.map((g) => (
                <div key={g.label}>
                  <div className="mb-3 flex items-center gap-3">
                    <span className="h-px flex-1 bg-line" />
                    <span className="rounded-full bg-sunken px-2.5 py-0.5 text-[11.5px] font-medium text-ink-muted">
                      {g.label}
                    </span>
                    <span className="h-px flex-1 bg-line" />
                  </div>
                  <div className="space-y-2.5">
                    {g.items.map((m) => (
                      <div
                        key={m.id}
                        className="group flex items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-1 transition-all hover:border-line-strong hover:shadow-2"
                      >
                        {m.type === "text" ? (
                          <>
                            <Icon name="message" size={16} className="mt-0.5 text-ink-muted" />
                            <div className="min-w-0 flex-1">
                              <div className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed">
                                {m.content}
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="mt-0.5"><FileIcon name={m.file?.name || ""} size={16} /></span>
                            <div className="min-w-0 flex-1">
                              {m.file ? (
                                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                                  <span className="max-w-[380px] truncate text-[13.5px] font-medium">{m.file.name}</span>
                                  <span className="text-[12px] text-ink-muted">{formatSize(m.file.size)}</span>
                                  {m.file.guard_status === "warning" && (
                                    <span className="inline-flex items-center gap-1 rounded bg-warning/[0.1] px-1.5 py-0.5 text-[11px] text-warning"><Icon name="triangle-alert" size={11} />安全提示</span>
                                  )}
                                  <a
                                    className="text-[12.5px] font-medium text-primary transition-colors hover:text-primary-hover hover:underline"
                                    href={`/api/files/download?path=${encodeURIComponent(m.file.path)}`}
                                    download={m.file.name}
                                  >
                                    <Icon name="download" size={12} className="mr-1" />下载
                                  </a>
                                </div>
                              ) : (
                                <span className="text-[13px] text-ink-muted">文件已删除，仅剩时间线记录</span>
                              )}
                            </div>
                          </>
                        )}
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-[11.5px] text-ink-muted" title={formatDateTime(m.created_at)}>
                            {relativeTime(m.created_at)}
                          </span>
                          <button
                            className="row-btn inline-flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 hover:!text-danger"
                            title="删除"
                            aria-label="删除"
                            onClick={() => setDel(m)}
                          >
                            <Icon name="trash" size={15} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        onConfirm={submitDelete}
        title="删除这条消息"
        danger
        busy={busyAction}
        confirmText="删除"
        body={
          del?.type === "file"
            ? <>删除后，对应文件「{del?.file?.name || "该文件"}」会一并移入回收站，保留期内可恢复。</>
            : <>确定删除这条文字消息吗？删除后不可恢复。</>
        }
      />
    </div>
  );
}
