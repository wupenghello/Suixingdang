import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { ConfirmDialog, EmptyState, FileIcon, Spinner, formatSize } from "../components/ui";
import { Icon } from "../components/Icon";
// toast 实际导出在 stores/toast（ui.tsx 未再导出，与 Files.tsx 的既有写法不同）
import { toast } from "../stores/toast";
import { formatDateTime } from "../lib/format";

/** 回收站条目（字段对后端容错：file_id/id、locked/locked_at、remaining_days 可能缺省） */
interface TrashItem {
  file_id?: string;
  id?: string;
  name: string;
  path: string;
  size: number;
  deleted_at?: string;
  locked_at?: string | null;
  locked?: boolean;
  remaining_days?: number;
  mime_type?: string;
  group_name?: string;
  [k: string]: any;
}

interface TrashStats {
  total: number;
  total_size: number;
  retention_days: number;
  locked_count?: number;
  will_expire_24h?: number;
}

const fid = (it: TrashItem) => it.file_id || it.id || "";
const isLocked = (it: TrashItem) => it.locked ?? !!it.locked_at;

export function TrashView() {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [stats, setStats] = useState<TrashStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState(false);
  const [purging, setPurging] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [del, setDel] = useState<TrashItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 列表自带 retention_days；stats 字段名容错（total_count/total 等）
      const [list, st] = await Promise.all([
        api.get("/api/files/trash"),
        api.get("/api/files/trash/stats").catch(() => null),
      ]);
      const arr: TrashItem[] = list.items || (Array.isArray(list) ? list : []);
      setItems(arr);
      const retention =
        list.retention_days ?? st?.retention_days ?? st?.retention ?? 30;
      setStats({
        total: st?.total_count ?? st?.total ?? arr.length,
        total_size: st?.total_size ?? st?.size ?? arr.reduce((s, f) => s + (f.size || 0), 0),
        retention_days: retention,
        locked_count: st?.locked_count ?? arr.filter(isLocked).length,
        will_expire_24h: st?.will_expire_24h,
      });
    } catch (e: any) {
      toast(e.message || "加载回收站失败", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** 剩余天数：优先后端 remaining_days，否则用 deleted_at + retention_days 计算 */
  const remainingOf = (it: TrashItem): number => {
    if (typeof it.remaining_days === "number") return it.remaining_days;
    const days = stats?.retention_days ?? 30;
    if (!it.deleted_at) return days;
    const d = new Date(it.deleted_at.includes("T") ? it.deleted_at : it.deleted_at.replace(" ", "T"));
    if (isNaN(d.getTime())) return days;
    return Math.max(0, days - (Date.now() - d.getTime()) / 86400000);
  };

  /* ---- 恢复 ---- */
  const doRestore = async (it: TrashItem) => {
    setBusyId(fid(it));
    try {
      const r = await api.post(`/api/files/trash/restore?file_id=${encodeURIComponent(fid(it))}`);
      toast(r?.renamed ? `已恢复（原路径被占用，已自动重命名）：${r.path || it.name}` : `已恢复：${it.name}`, "success");
      load();
    } catch (e: any) {
      toast(e.message || "恢复失败", "error");
    } finally {
      setBusyId(null);
    }
  };

  /* ---- 锁定 / 解锁 ---- */
  const doToggleLock = async (it: TrashItem) => {
    setBusyId(fid(it));
    try {
      const to = !isLocked(it);
      await api.post("/api/files/trash/lock", { file_id: fid(it), locked: to });
      toast(to ? `已锁定：${it.name}（不再自动清理）` : `已解锁：${it.name}`, "success");
      load();
    } catch (e: any) {
      toast(e.message || "操作失败", "error");
    } finally {
      setBusyId(null);
    }
  };

  /* ---- 彻底删除单个 ---- */
  const submitDelete = async () => {
    if (!del) return;
    setBusyAction(true);
    try {
      await api.del("/api/files/trash", { query: { file_id: fid(del) } });
      toast(`已彻底删除：${del.name}`, "success");
      setDel(null);
      load();
    } catch (e: any) {
      toast(e.message || "删除失败", "error");
    } finally {
      setBusyAction(false);
    }
  };

  /* ---- 清理过期文件 ---- */
  const doPurge = async () => {
    setPurging(true);
    try {
      const r = await api.post("/api/files/trash/purge");
      const n = r?.purged ?? 0;
      toast(n > 0 ? `已清理 ${n} 个过期文件（保留 ${r.retention_days ?? stats?.retention_days ?? 30} 天）` : "没有需要清理的过期文件", n > 0 ? "success" : "info");
      if (n > 0) load();
    } catch (e: any) {
      toast(e.message || "清理失败", "error");
    } finally {
      setPurging(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* 统计条 */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-3.5">
        <div className="flex items-center gap-2 rounded-md bg-sunken px-3 py-1.5">
          <Icon name="folder" size={15} className="text-ink-muted" />
          <span className="text-[12.5px] text-ink-muted">总数</span>
          <span className="text-[14px] font-semibold tabular-nums">{stats?.total ?? "—"}</span>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-sunken px-3 py-1.5">
          <Icon name="hard-drive" size={15} className="text-ink-muted" />
          <span className="text-[12.5px] text-ink-muted">占用</span>
          <span className="text-[14px] font-semibold tabular-nums">{stats ? formatSize(stats.total_size) : "—"}</span>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-sunken px-3 py-1.5">
          <Icon name="clock" size={15} className="text-ink-muted" />
          <span className="text-[12.5px] text-ink-muted">保留期</span>
          <span className="text-[14px] font-semibold tabular-nums">{stats ? `${stats.retention_days} 天` : "—"}</span>
        </div>
        {(stats?.will_expire_24h ?? 0) > 0 && (
          <span className="inline-flex items-center rounded-full border border-warning/40 bg-warning/[0.08] px-2.5 py-1 text-[12px] font-medium text-warning">
            <Icon name="triangle-alert" size={12} className="mr-1" />{stats!.will_expire_24h} 个文件 24 小时内过期
          </span>
        )}
        <div className="ml-auto">
          <button className="btn-ghost" onClick={doPurge} disabled={purging || loading}>
            {purging && <Spinner className="mr-1.5 h-3.5 w-3.5" />}
            <Icon name="trash" size={14} className="mr-1.5" />清理过期文件
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {loading ? (
          <div className="space-y-2 pt-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-11 animate-pulse rounded-md bg-sunken" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="trash"
            title="回收站是空的"
            hint="删除的文件会在这里保留，保留期内可随时恢复；锁定的文件不受自动清理影响。"
          />
        ) : (
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr className="text-left text-[12px] text-ink-muted">
                <th className="border-b border-line pb-2 font-medium">名称</th>
                <th className="w-24 border-b border-line pb-2 font-medium">大小</th>
                <th className="w-40 border-b border-line pb-2 font-medium">删除时间</th>
                <th className="w-28 border-b border-line pb-2 font-medium">剩余</th>
                <th className="w-40 border-b border-line pb-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const id = fid(it);
                const locked = isLocked(it);
                const rem = remainingOf(it);
                const expiring = !locked && rem < 1;
                return (
                  <tr key={id || it.path} className="group transition-colors hover:bg-surface-hover/60">
                    <td className="border-b border-line-light py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="flex items-center"><FileIcon name={it.name} size={17} /></span>
                        <span className="max-w-[360px] truncate text-[13.5px]">{it.name}</span>
                        {locked && (
                          <span title="已锁定：不受自动清理影响" className="shrink-0 inline-flex text-ink-muted"><Icon name="lock" size={12} /></span>
                        )}
                        {it.group_name && (
                          <span className="shrink-0 rounded bg-sunken px-1.5 py-0.5 text-[11px] text-ink-muted">
                            {it.group_name}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="border-b border-line-light py-2.5 text-[12.5px] text-ink-muted">
                      {formatSize(it.size)}
                    </td>
                    <td className="border-b border-line-light py-2.5 text-[12.5px] text-ink-muted">
                      {it.deleted_at ? formatDateTime(it.deleted_at) : "—"}
                    </td>
                    <td className="border-b border-line-light py-2.5">
                      {locked ? (
                        <span className="text-[12.5px] text-ink-muted">已锁定</span>
                      ) : (
                        <span className={`text-[12.5px] font-medium tabular-nums ${expiring ? "text-danger" : rem < 3 ? "text-warning" : "text-ink-secondary"}`}>
                          {rem <= 0 ? "即将清理" : `${Math.floor(rem)} 天`}
                        </span>
                      )}
                    </td>
                    <td className="border-b border-line-light py-2.5">
                      <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        {busyId === id ? (
                          <Spinner className="ml-2 h-3.5 w-3.5" />
                        ) : (
                          <>
                            <button className="row-btn" title="恢复到原位置" aria-label="恢复到原位置" onClick={() => doRestore(it)}><Icon name="rotate-ccw" size={15} /></button>
                            <button
                              className="row-btn"
                              aria-label={locked ? "解锁" : "锁定"}
                              title={locked ? "解锁（恢复自动清理）" : "锁定（跳过自动清理）"}
                              onClick={() => doToggleLock(it)}
                            >
                              <Icon name={locked ? "unlock" : "lock"} size={15} />
                            </button>
                            <button className="row-btn hover:!text-danger" title="彻底删除（不可恢复）" aria-label="彻底删除" onClick={() => setDel(it)}>
                              <Icon name="circle-x" size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 彻底删除确认 */}
      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        onConfirm={submitDelete}
        title="彻底删除"
        danger
        busy={busyAction}
        confirmText="彻底删除"
        body={
          <>
            确定彻底删除「{del?.name}」吗？
            <div className="mt-2 flex items-center gap-1.5 rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
              <Icon name="triangle-alert" size={13} />文件将被物理清除，此操作不可恢复。只是想找回来请用「恢复」。
            </div>
          </>
        }
      />
    </div>
  );
}
