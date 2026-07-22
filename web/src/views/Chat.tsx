import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { sseStream } from "../lib/sse";
import { Markdown } from "../components/Markdown";
import { Spinner, toast } from "../components/ui";
import { Icon } from "../components/Icon";
import { useAuth } from "../stores/auth";

interface ToolChip {
  tool: string;
  args: Record<string, any>;
  status: "running" | "ok" | "fail";
  summary?: string;
}

interface ChatMsg {
  id: number;
  role: "user" | "assistant";
  content: string;
  tools?: ToolChip[];
  confirm?: {
    callId: string;
    tool: string;
    args: Record<string, any>;
    message: string;
    pendingState: any;
    resolved?: "approved" | "denied";
  };
}

let msgSeq = 1;

const SUGGESTIONS = [
  "传输助手里最近存了什么？",
  "帮我找一下那个合同",
  "我回收站里哪些该清理了？",
];

export function ChatView() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .get("/api/chat/history", { query: { limit: 30 } })
      .then((r) => {
        const hist: ChatMsg[] = (r.messages || []).map((m: any) => ({
          id: msgSeq++,
          role: m.role,
          content: m.content || "",
          tools: (m.tool_calls || []).map((tc: any) => ({
            tool: tc.tool,
            args: tc.args || {},
            status: "ok" as const,
            summary: String(tc.result || "").slice(0, 120),
          })),
        }));
        setMessages(hist);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const patchLast = (fn: (m: ChatMsg) => ChatMsg) =>
    setMessages((ms) => {
      const copy = [...ms];
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i].role === "assistant") {
          copy[i] = fn(copy[i]);
          break;
        }
      }
      return copy;
    });

  /** 消费 SSE 事件流，更新最后一条助手消息；返回 done 事件数据。 */
  async function consume(
    path: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<any> {
    let doneData: any = null;
    for await (const ev of sseStream(path, body, signal)) {
      if (ev.type === "delta") {
        const text = typeof ev.data === "string" ? ev.data : ev.data?.text || "";
        if (text) patchLast((m) => ({ ...m, content: m.content + text }));
      } else if (ev.type === "tool_start" || ev.type === "tool") {
        const chip: ToolChip = {
          tool: ev.data.tool,
          args: ev.data.args || {},
          status: "running",
        };
        patchLast((m) => ({ ...m, tools: [...(m.tools || []), chip] }));
      } else if (ev.type === "tool_end") {
        patchLast((m) => {
          const tools = [...(m.tools || [])];
          for (let i = tools.length - 1; i >= 0; i--) {
            if (tools[i].tool === ev.data.tool && tools[i].status === "running") {
              tools[i] = { ...tools[i], status: ev.data.ok ? "ok" : "fail", summary: ev.data.summary };
              break;
            }
          }
          return { ...m, tools };
        });
      } else if (ev.type === "confirm_request") {
        patchLast((m) => ({
          ...m,
          confirm: {
            callId: ev.data.call_id,
            tool: ev.data.tool,
            args: ev.data.args || {},
            message: ev.data.message || "需要确认后继续",
            pendingState: null,
          },
        }));
      } else if (ev.type === "done") {
        doneData = ev.data;
        // done.reply 是脱敏后的规范文本，覆盖流式拼接结果
        patchLast((m) => ({
          ...m,
          content: ev.data.reply || m.content,
          tools: (ev.data.tool_calls || []).length
            ? (ev.data.tool_calls || []).map((tc: any) => ({
                tool: tc.tool,
                args: tc.args || {},
                status: "ok" as const,
                summary: String(tc.result || "").slice(0, 120),
              }))
            : m.tools,
          confirm: m.confirm
            ? { ...m.confirm, pendingState: ev.data.pending_state || m.confirm.pendingState }
            : m.confirm,
        }));
      } else if (ev.type === "error") {
        toast(ev.data?.message || "处理失败", "error");
      }
    }
    return doneData;
  }

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setInput("");
    setMessages((ms) => [
      ...ms,
      { id: msgSeq++, role: "user", content },
      { id: msgSeq++, role: "assistant", content: "", tools: [] },
    ]);
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await consume("/api/v1/chat/messages", { message: content }, ctrl.signal);
    } catch (e: any) {
      if (e.name !== "AbortError") toast(e.message || "对话失败", "error");
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  async function resolveConfirm(approved: boolean) {
    const last = [...messages].reverse().find((m) => m.confirm && !m.confirm.resolved);
    if (!last?.confirm) return;
    const { callId, pendingState } = last.confirm;
    setMessages((ms) =>
      ms.map((m) =>
        m.id === last.id && m.confirm
          ? { ...m, confirm: { ...m.confirm, resolved: approved ? "approved" : "denied" } }
          : m,
      ),
    );
    if (!approved) {
      setMessages((ms) => [
        ...ms,
        { id: msgSeq++, role: "assistant", content: "好的，已取消这个操作。" },
      ]);
      return;
    }
    setMessages((ms) => [...ms, { id: msgSeq++, role: "assistant", content: "", tools: [] }]);
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await consume(
        "/api/v1/chat/confirm",
        { call_id: callId, pending_state: pendingState, approved: true },
        ctrl.signal,
      );
    } catch (e: any) {
      if (e.name !== "AbortError") toast(e.message || "确认执行失败", "error");
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  const stop = () => abortRef.current?.abort();

  return (
    <div className="flex h-full flex-col">
      {/* 消息流 */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-[760px] space-y-5">
          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-4 pt-20">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary-active text-white shadow-2">
                <Icon name="sparkles" size={28} />
              </div>
              <div className="text-center">
                <div className="text-[17px] font-semibold">
                  你好{user ? `，${user.username}` : ""}，我是你的文件助手
                </div>
                <div className="mt-1 text-[13px] text-ink-muted">
                  查找、问答、整理、同步——一句话搞定
                </div>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12.5px] text-ink-secondary shadow-1 transition-all hover:border-primary/40 hover:text-primary hover:shadow-2"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] space-y-2 ${m.role === "user" ? "items-end" : "items-start"}`}>
                {/* 工具调用 chips */}
                {m.role === "assistant" && (m.tools?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.tools!.map((t, i) => (
                      <span
                        key={i}
                        title={t.summary}
                        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-sunken px-2.5 py-1 text-[11.5px] text-ink-secondary"
                      >
                        {t.status === "running" ? (
                          <Spinner className="h-3 w-3" />
                        ) : (
                          <span className={t.status === "ok" ? "text-success" : "text-danger"}>
                            <Icon name={t.status === "ok" ? "check" : "x"} size={12} />
                          </span>
                        )}
                        {t.tool}
                      </span>
                    ))}
                  </div>
                )}

                <div
                  className={`rounded-lg px-4 py-2.5 text-[13.5px] leading-relaxed shadow-1 ${
                    m.role === "user"
                      ? "rounded-br-sm bg-user-bubble text-ink"
                      : "rounded-bl-sm bg-ai-bubble text-ink"
                  }`}
                >
                  {m.role === "user" ? (
                    <div className="whitespace-pre-wrap">{m.content}</div>
                  ) : m.content ? (
                    <Markdown text={m.content} />
                  ) : (
                    busy && <Spinner />
                  )}
                </div>

                {/* HITL 确认卡 */}
                {m.confirm && !m.confirm.resolved && (
                  <div className="w-full rounded-lg border border-warning/40 bg-warning/[0.06] p-3.5">
                    <div className="mb-1 flex items-center gap-2 text-[13px] font-medium text-warning">
                      <Icon name="triangle-alert" size={14} />需要确认
                    </div>
                    <div className="mb-3 text-[12.5px] leading-relaxed text-ink-secondary">
                      {m.confirm.message}
                      <div className="mt-1.5 rounded bg-surface/70 px-2 py-1.5 font-mono text-[11.5px] text-ink-muted">
                        {m.confirm.tool}({JSON.stringify(m.confirm.args)})
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button className="btn-danger !py-1.5 !text-[12.5px]" onClick={() => resolveConfirm(true)} disabled={busy}>
                        确认执行
                      </button>
                      <button className="btn-ghost !py-1.5 !text-[12.5px]" onClick={() => resolveConfirm(false)} disabled={busy}>
                        取消
                      </button>
                    </div>
                  </div>
                )}
                {m.confirm?.resolved === "denied" && (
                  <div className="text-[11.5px] text-ink-muted">已取消该操作</div>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* 输入区 */}
      <div className="shrink-0 border-t border-line bg-surface px-6 py-4">
        <div className="mx-auto flex max-w-[760px] items-end gap-2.5">
          <textarea
            className="input max-h-32 min-h-[44px] flex-1 resize-none !py-2.5"
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          {busy ? (
            <button className="btn-ghost !px-4 !py-2.5 inline-flex items-center justify-center" onClick={stop} title="停止生成" aria-label="停止生成">
              <Icon name="square" size={14} />
            </button>
          ) : (
            <button className="btn-primary !px-4 !py-2.5" onClick={() => send()} disabled={!input.trim()}>
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
