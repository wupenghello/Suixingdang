/**
 * SSE 流消费：fetch + ReadableStream 解析 `data: {...}` 行。
 * 用于 /api/chat/stream（旧形态 {type,data}）与 /api/v1/chat/messages（事件协议）。
 */

export interface SseEvent {
  type: string;
  data: any;
}

export async function* sseStream(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let message = `HTTP ${res.status}`;
    try {
      const e = await res.json();
      message = e.detail || e.message || message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trimEnd();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        const obj = JSON.parse(payload);
        yield { type: obj.type ?? "message", data: obj.data ?? obj };
      } catch {
        /* 非 JSON 行忽略 */
      }
    }
  }
}
