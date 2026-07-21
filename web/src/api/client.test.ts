import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, ApiError, setAuthFailureHandler } from "./client";

function mockRes(status: number, body: any, ok?: boolean) {
  return {
    ok: ok ?? status < 400,
    status,
    json: async () => body,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  } as Response;
}

describe("api client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GET 成功解析 JSON", async () => {
    fetchMock.mockResolvedValueOnce(mockRes(200, { ok: 1 }));
    const r = await api.get("/api/x");
    expect(r).toEqual({ ok: 1 });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/x");
  });

  it("query 参数拼接并跳过空值", async () => {
    fetchMock.mockResolvedValueOnce(mockRes(200, {}));
    await api.get("/api/x", { query: { a: "1", b: "", c: 2 } });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/x?a=1&c=2");
  });

  it("POST JSON 带 Content-Type", async () => {
    fetchMock.mockResolvedValueOnce(mockRes(200, {}));
    await api.post("/api/x", { k: "v" });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ k: "v" }));
  });

  it("400 抛出 ApiError（兼容 detail 与 message 两种错误体）", async () => {
    fetchMock.mockResolvedValueOnce(mockRes(400, { detail: "参数错误" }));
    await expect(api.get("/api/x")).rejects.toMatchObject({
      status: 400,
      message: "参数错误",
    });

    fetchMock.mockResolvedValueOnce(mockRes(404, { code: "NOT_FOUND", message: "不存在" }));
    await expect(api.get("/api/y")).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
      message: "不存在",
    });
  });

  it("401 → 刷新成功 → 自动重试一次", async () => {
    fetchMock
      .mockResolvedValueOnce(mockRes(401, { detail: "未登录" }))
      .mockResolvedValueOnce(mockRes(200, {}, true)) // refresh
      .mockResolvedValueOnce(mockRes(200, { retried: true })); // 重试
    const r = await api.get("/api/files/list");
    expect(r).toEqual({ retried: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/refresh");
  });

  it("401 → 刷新失败 → 触发登出回调且不重试", async () => {
    const onAuth = vi.fn();
    setAuthFailureHandler(onAuth);
    fetchMock
      .mockResolvedValueOnce(mockRes(401, { detail: "未登录" }))
      .mockResolvedValueOnce(mockRes(401, {}, false)); // refresh 失败
    await expect(api.get("/api/files/list")).rejects.toBeInstanceOf(ApiError);
    expect(onAuth).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    setAuthFailureHandler(null as any);
  });

  it("认证端点自身的 401 不触发刷新循环", async () => {
    fetchMock.mockResolvedValueOnce(mockRes(401, { detail: "密码错误" }));
    await expect(api.post("/api/auth/login", {})).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
