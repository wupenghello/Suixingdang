import { describe, it, expect } from "vitest";
import { sseStream } from "./sse";

function sseResponse(payload: string, status = 200) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // 分片投递，模拟真实网络边界切分
      const chunks = [payload.slice(0, 12), payload.slice(12)];
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return { ok: status < 400, status, body: stream, json: async () => ({ detail: "err" }) } as unknown as Response;
}

describe("sseStream", () => {
  it("解析多行 data 事件（跨 chunk 边界）", async () => {
    const payload =
      'data: {"type":"delta","data":{"text":"你好"}}\n\n' +
      'data: {"type":"tool_start","data":{"tool":"search_files","args":{}}}\n\n' +
      'data: {"type":"done","data":{"reply":"你好","tool_calls":[]}}\n\n';

    const fetchMock = async () => sseResponse(payload);
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as any;

    const events: any[] = [];
    for await (const ev of sseStream("/api/v1/chat/messages", { message: "hi" })) {
      events.push(ev);
    }
    globalThis.fetch = origFetch;

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: "delta", data: { text: "你好" } });
    expect(events[1].type).toBe("tool_start");
    expect(events[2].data.reply).toBe("你好");
  });

  it("忽略非 data 行与空行", async () => {
    const payload = 'event: message\n\ndata: {"type":"done","data":{}}\n\n: comment\n\n';
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => sseResponse(payload)) as any;
    const events: any[] = [];
    for await (const ev of sseStream("/x", {})) events.push(ev);
    globalThis.fetch = origFetch;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("done");
  });

  it("HTTP 错误抛出带 message 的异常", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => sseResponse("", 429)) as any;
    await expect(async () => {
      for await (const _ of sseStream("/x", {})) {
        /* noop */
      }
    }).rejects.toThrow();
    globalThis.fetch = origFetch;
  });
});
