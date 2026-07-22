import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { ConfirmDialog, EmptyState, Spinner } from "../components/ui";
import { Icon } from "../components/Icon";
// toast 实际导出在 stores/toast（ui.tsx 未再导出，与 Files.tsx 的既有写法不同）
import { toast } from "../stores/toast";
import { Markdown } from "../components/Markdown";
import { relativeTime } from "../lib/format";

/** 笔记条目（字段容错：file_id/id、modified(秒级时间戳)/modified_at） */
interface NoteItem {
  file_id?: string;
  id?: string;
  path: string;
  name: string;
  size?: number;
  modified?: number;
  modified_at?: string;
  tags?: string[];
  ai_tags?: string[];
  pinned?: boolean;
  summary?: string;
  snippet?: string;
  [k: string]: any;
}

interface TagAgg {
  name: string;
  count?: number;
}

const nid = (n: NoteItem) => n.file_id || n.id || "";

/** modified 秒级时间戳 / modified_at ISO → 统一 ISO 串 */
function noteIso(n: NoteItem): string {
  if (n.modified_at) return n.modified_at;
  if (n.modified) return new Date(n.modified * 1000).toISOString();
  return "";
}

export function NotesView() {
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [allTags, setAllTags] = useState<TagAgg[]>([]);
  const [filterTag, setFilterTag] = useState("");
  const [loading, setLoading] = useState(true);

  /* ---- 编辑器状态 ---- */
  const [selectedId, setSelectedId] = useState(""); // "" = 未选中任何笔记
  const [fileId, setFileId] = useState(""); // 当前草稿对应的文件 id（空 = 尚未保存过的新笔记）
  const [notePath, setNotePath] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [del, setDel] = useState(false);
  const [busyAction, setBusyAction] = useState(false);

  const saveRef = useRef<(silent?: boolean) => Promise<boolean>>(async () => false);
  const openNoteRef = useRef<(n: NoteItem) => Promise<void>>(async () => {});
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadNotes = useCallback(async () => {
    try {
      const r = await api.get("/api/files/notes");
      setNotes(r.notes || []);
    } catch (e: any) {
      toast(e.message || "加载笔记失败", "error");
    }
  }, []);

  const loadTags = useCallback(async () => {
    try {
      const r = await api.get("/api/files/all-tags");
      // tags 为 [{name, count}]；兼容纯字符串数组
      const raw: any[] = r.tags || [];
      setAllTags(raw.map((t) => (typeof t === "string" ? { name: t } : t)));
    } catch {
      /* 标签云加载失败不影响主流程 */
    }
  }, []);

  /* ---- 保存（新建 / 更新共用 POST /note，编辑传 file_id） ---- */
  const save = useCallback(
    async (silent = false): Promise<boolean> => {
      if (!content.trim()) {
        if (!silent) toast("内容不能为空，无法保存", "error");
        return false;
      }
      setSaving(true);
      try {
        const r = await api.post("/api/files/note", {
          name: title.trim() || "未命名笔记",
          content,
          file_id: fileId,
        });
        const newId = r.id || r.file_id || fileId;
        setFileId(newId);
        setSelectedId(newId);
        if (r.path) setNotePath(r.path);
        if (r.name) setTitle(r.name); // 后端可能规范化文件名（补 .md）
        setDirty(false);
        if (window.location.hash.split("/")[1] !== newId) {
          window.location.hash = `#/notes/${newId}`;
        }
        if (!silent) toast("已保存", "success");
        loadNotes(); // 后台刷新摘要/标签
        return true;
      } catch (e: any) {
        if (!silent) toast(e.message || "保存失败", "error");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [content, title, fileId, loadNotes],
  );
  saveRef.current = save;

  /* ---- 打开一篇笔记（先冲刷当前草稿，避免丢改动） ---- */
  const openNote = useCallback(
    async (n: NoteItem) => {
      const id = nid(n);
      if (id === selectedId && fileId) return;
      // 当前草稿有未保存改动：已保存过的走更新，新草稿有内容则先落盘
      if (dirty) {
        const ok = await saveRef.current(true);
        if (!ok) {
          toast("当前笔记有未保存改动且保存失败，请先处理", "error");
          return;
        }
      }
      setSelectedId(id);
      setPreview(false);
      setLoadingContent(true);
      try {
        const r = await api.get("/api/files/note-content", { query: { file_id: id } });
        setFileId(r.file_id || id);
        setNotePath(r.path || n.path);
        setTitle(r.name || n.name);
        setContent(r.content ?? "");
        setDirty(false);
        window.location.hash = `#/notes/${id}`;
      } catch (e: any) {
        toast(e.message || "打开笔记失败", "error");
        setSelectedId("");
      } finally {
        setLoadingContent(false);
      }
    },
    [dirty, fileId, selectedId],
  );
  openNoteRef.current = openNote;

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadNotes(), loadTags()]);
      setLoading(false);
      // hash 联动：#/notes/{file_id} 直达
      const m = window.location.hash.match(/^#\/notes\/(.+)$/);
      if (m) {
        const target = decodeURIComponent(m[1]);
        const r = await api.get("/api/files/notes").catch(() => null);
        const hit: NoteItem | undefined = (r?.notes || []).find((n: NoteItem) => nid(n) === target);
        if (hit) openNoteRef.current(hit);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- 新建笔记 ---- */
  const newNote = async () => {
    if (dirty && (fileId || content.trim())) {
      const ok = await saveRef.current(true);
      if (!ok) {
        toast("当前笔记有未保存改动且保存失败，请先处理", "error");
        return;
      }
    }
    setSelectedId("__new__");
    setFileId("");
    setNotePath("");
    setTitle("");
    setContent("");
    setDirty(false);
    setPreview(false);
  };

  /* ---- 自动保存：防抖 1.5s（仅限已保存过、有 file_id 的笔记） ---- */
  useEffect(() => {
    if (!dirty || !fileId || loadingContent) return;
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = setTimeout(() => {
      saveRef.current(true);
    }, 1500);
    return () => {
      if (autoTimer.current) clearTimeout(autoTimer.current);
    };
  }, [dirty, fileId, content, title, loadingContent]);

  /* ---- Ctrl/Cmd+S 快捷保存 ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---- AI 整理（后端按已落盘内容提取，故先确保已保存） ---- */
  const doEnhance = async () => {
    if (!fileId || !notePath) {
      toast("请先保存笔记，再使用 AI 整理", "error");
      return;
    }
    if (dirty) {
      const ok = await save(true);
      if (!ok) return;
    }
    setEnhancing(true);
    try {
      // 注意：后端 ai-enhance 以 path 作 Query 参数（非 JSON body）
      await api.post(`/api/files/ai-enhance?path=${encodeURIComponent(notePath)}`);
      toast("AI 整理完成：已更新摘要与建议标签", "success");
      loadNotes();
    } catch (e: any) {
      toast(e.message || "AI 整理失败", "error");
    } finally {
      setEnhancing(false);
    }
  };

  /* ---- 删除笔记（软删进回收站） ---- */
  const submitDelete = async () => {
    if (!notePath) return;
    setBusyAction(true);
    try {
      await api.del("/api/files", { query: { path: notePath } });
      toast("已移入回收站", "success");
      setDel(false);
      setSelectedId("");
      setFileId("");
      setNotePath("");
      setTitle("");
      setContent("");
      setDirty(false);
      loadNotes();
    } catch (e: any) {
      toast(e.message || "删除失败", "error");
    } finally {
      setBusyAction(false);
    }
  };

  /* ---- 标签筛选 ---- */
  const visible = filterTag
    ? notes.filter((n) => (n.tags || []).includes(filterTag) || (n.ai_tags || []).includes(filterTag))
    : notes;

  const editorOpen = selectedId !== "";

  return (
    <div className="flex h-full">
      {/* 左：笔记列表 */}
      <div className="flex w-[320px] shrink-0 flex-col border-r border-line bg-sidebar">
        <div className="flex items-center justify-between gap-2 px-4 pb-2.5 pt-4">
          <div className="text-[13.5px] font-medium text-ink-secondary">
            全部笔记 <span className="text-[12px] font-normal text-ink-muted">({visible.length})</span>
          </div>
          <button className="btn-primary !px-3 !py-1.5 !text-[12.5px]" onClick={newNote}>
            <Icon name="plus" size={14} className="mr-1" />新建笔记
          </button>
        </div>

        {/* 标签筛选 */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pb-3">
            {allTags.slice(0, 12).map((t) => {
              const active = filterTag === t.name;
              return (
                <button
                  key={t.name}
                  onClick={() => setFilterTag(active ? "" : t.name)}
                  className={`rounded-full px-2.5 py-0.5 text-[11.5px] transition-all ${
                    active
                      ? "bg-primary font-medium text-white shadow-1"
                      : "bg-sunken text-ink-secondary hover:bg-surface-active hover:text-ink"
                  }`}
                >
                  {t.name}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2.5 pb-3">
          {loading ? (
            <div className="space-y-2 pt-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-[76px] animate-pulse rounded-md bg-sunken" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              icon="note"
              title={filterTag ? `没有带「${filterTag}」标签的笔记` : "还没有笔记"}
              hint={filterTag ? "换个标签，或新建一篇笔记。" : "点右上角「新建笔记」，随手记录，自动归档。"}
              action={
                !filterTag ? (
                  <button className="btn-primary" onClick={newNote}><Icon name="plus" size={14} className="mr-1" />新建第一篇笔记</button>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-1">
              {visible.map((n) => {
                const id = nid(n);
                const active = id === selectedId;
                const iso = noteIso(n);
                return (
                  <button
                    key={id || n.path}
                    onClick={() => openNote(n)}
                    className={`group relative w-full rounded-md px-3 py-2.5 text-left transition-all duration-150 ${
                      active ? "bg-primary-soft" : "hover:bg-surface-hover"
                    }`}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r bg-primary" />
                    )}
                    <div className="flex items-center gap-1.5">
                      <span className={`truncate text-[13.5px] font-medium ${active ? "text-primary" : ""}`}>
                        {n.name}
                      </span>
                      {n.pinned && <Icon name="star" size={12} className="shrink-0 text-warning" />}
                    </div>
                    {(n.summary || n.snippet) && (
                      <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-ink-muted">
                        {n.summary || n.snippet}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {(n.tags || []).map((t) => (
                        <span key={`t-${t}`} className="rounded bg-sunken px-1.5 py-px text-[10.5px] text-ink-secondary">
                          {t}
                        </span>
                      ))}
                      {(n.ai_tags || []).map((t) => (
                        <span key={`a-${t}`} className="inline-flex items-center rounded bg-primary-soft px-1.5 py-px text-[10.5px] text-primary">
                          <Icon name="sparkles" size={10} className="mr-0.5" />{t}
                        </span>
                      ))}
                      {iso && (
                        <span className="ml-auto shrink-0 text-[10.5px] text-ink-muted">{relativeTime(iso)}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 右：编辑器 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!editorOpen ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon="note"
              title="选择一篇笔记开始编辑"
              hint="从左侧列表打开，或新建一篇。支持 Markdown 语法与预览。"
              action={<button className="btn-primary" onClick={newNote}><Icon name="plus" size={14} className="mr-1" />新建笔记</button>}
            />
          </div>
        ) : (
          <>
            {/* 工具条 */}
            <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-5 py-2.5">
              <button
                className="btn-primary !px-3.5 !py-1.5 !text-[12.5px]"
                onClick={() => save()}
                disabled={saving || !content.trim()}
                title="保存（Ctrl/Cmd+S）"
              >
                {saving && <Spinner className="mr-1.5 h-3.5 w-3.5 border-white border-t-transparent" />}
                <Icon name="save" size={14} className="mr-1.5" />保存
              </button>
              <button
                className={`btn-ghost !px-3.5 !py-1.5 !text-[12.5px] ${preview ? "!border-primary !bg-primary-soft !text-primary" : ""}`}
                onClick={() => setPreview((v) => !v)}
                disabled={loadingContent}
              >
                <Icon name={preview ? "pencil" : "eye"} size={14} className="mr-1.5" />{preview ? "编辑" : "预览"}
              </button>
              <button
                className="btn-ghost !px-3.5 !py-1.5 !text-[12.5px]"
                onClick={doEnhance}
                disabled={enhancing || loadingContent}
                title="调用 AI 生成摘要与建议标签"
              >
                {enhancing ? <Spinner className="mr-1.5 h-3.5 w-3.5" /> : <Icon name="sparkles" size={14} className="mr-1.5" />}
                {enhancing ? "AI 整理中…" : "AI 整理"}
              </button>
              <div className="flex-1" />
              {dirty && (
                <span className="flex items-center gap-1.5 text-[12px] text-warning">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-warning" />
                  未保存
                </span>
              )}
              {fileId && (
                <button
                  className="row-btn inline-flex items-center justify-center hover:!text-danger"
                  title="删除笔记（移入回收站）"
                  aria-label="删除笔记"
                  onClick={() => setDel(true)}
                >
                  <Icon name="trash" size={16} />
                </button>
              )}
            </div>

            {/* 标题 + 正文 / 预览 */}
            {loadingContent ? (
              <div className="space-y-3 px-6 pt-5">
                <div className="h-9 w-1/2 animate-pulse rounded-md bg-sunken" />
                <div className="h-40 animate-pulse rounded-md bg-sunken" />
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col px-6 py-4">
                <div className="flex items-center gap-2">
                  <input
                    className="input flex-1 !border-transparent !bg-transparent !px-1 !text-[17px] !font-semibold focus:!border-line"
                    value={title}
                    placeholder="笔记标题…"
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setDirty(true);
                    }}
                  />
                  {dirty && <span className="h-2 w-2 shrink-0 rounded-full bg-warning" title="有未保存的改动" />}
                </div>
                {preview ? (
                  <div className="mt-3 flex-1 overflow-y-auto rounded-md border border-line bg-surface px-5 py-4 shadow-1">
                    <Markdown text={content || "*（空白笔记）*"} />
                  </div>
                ) : (
                  <textarea
                    className="input mt-3 min-h-0 flex-1 resize-none !text-[13.5px] !leading-relaxed"
                    placeholder="开始记录…支持 Markdown 语法"
                    value={content}
                    onChange={(e) => {
                      setContent(e.target.value);
                      setDirty(true);
                    }}
                  />
                )}
                <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-ink-muted">
                  <span>{preview ? "预览模式：Markdown 渲染" : "编辑模式：Ctrl/Cmd+S 保存，已保存的笔记会自动保存"}</span>
                  <span className="tabular-nums">{content.length} 字</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 删除确认 */}
      <ConfirmDialog
        open={del}
        onClose={() => setDel(false)}
        onConfirm={submitDelete}
        title="删除笔记"
        danger
        busy={busyAction}
        confirmText="删除"
        body={<>确定删除「{title || "这篇笔记"}」吗？笔记会移入回收站，保留期内可恢复。</>}
      />
    </div>
  );
}
