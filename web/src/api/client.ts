/**
 * API 客户端：fetch 封装 + 401 静默刷新重试（移植自旧 app.js API 层）。
 * 会话令牌在 HttpOnly cookie（同源自动携带），前端不触碰令牌明文。
 */

export class ApiError extends Error {
  status: number;
  code: string;
  detail: any;

  constructor(status: number, message: string, code = "", detail: any = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

let onAuthFailure: (() => void) | null = null;

/** 注册认证失败回调（登出并跳转登录页）。 */
export function setAuthFailureHandler(fn: () => void) {
  onAuthFailure = fn;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: any = {};
  try {
    body = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }
  const message =
    (typeof body.detail === "string" && body.detail) ||
    body.message ||
    `HTTP ${res.status}`;
  return new ApiError(res.status, message, body.code || "", body.detail);
}

interface ReqOptions {
  json?: unknown;
  form?: FormData;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  /** 内部用：刷新重试时置 true，避免无限循环 */
  _retried?: boolean;
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function request<T = any>(
  method: string,
  path: string,
  opts: ReqOptions = {},
): Promise<T> {
  let url = path;
  if (opts.query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }

  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form;
  }

  const res = await fetch(url, {
    method,
    headers,
    body,
    credentials: "same-origin",
    signal: opts.signal,
  });

  // 401：静默刷新一次后重试；仍失败则触发登出（认证端点自身不刷新）
  if (res.status === 401 && !opts._retried && !path.startsWith("/api/auth/")) {
    if (await tryRefresh()) {
      return request<T>(method, path, { ...opts, _retried: true });
    }
    onAuthFailure?.();
  }

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T = any>(path: string, opts?: Omit<ReqOptions, "json" | "form">) =>
    request<T>("GET", path, opts),
  post: <T = any>(path: string, json?: unknown, opts?: Omit<ReqOptions, "json">) =>
    request<T>("POST", path, { ...opts, json }),
  put: <T = any>(path: string, json?: unknown, opts?: Omit<ReqOptions, "json">) =>
    request<T>("PUT", path, { ...opts, json }),
  del: <T = any>(path: string, opts?: Omit<ReqOptions, "json" | "form">) =>
    request<T>("DELETE", path, opts),
  postForm: <T = any>(path: string, form: FormData, opts?: Omit<ReqOptions, "json" | "form">) =>
    request<T>("POST", path, { ...opts, form }),
};
