import { create } from "zustand";
import { api, setAuthFailureHandler } from "../api/client";

export interface UserInfo {
  id: string;
  username: string;
  role?: string;
  quota_mb?: number;
  used_mb?: number;
  ai_enabled?: boolean;
  phone?: string;
  phone_verified?: boolean;
  [k: string]: any;
}

interface AuthState {
  user: UserInfo | null;
  loading: boolean;
  error: string;
  fetchMe: () => Promise<boolean>;
  login: (username: string, password: string) => Promise<{ sms_required?: boolean; phone_masked?: string }>;
  loginWithSms: (username: string, smsCode: string) => Promise<boolean>;
  register: (p: {
    username: string;
    password: string;
    security_question: string;
    security_answer: string;
    phone: string;
    sms_code: string;
  }) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  error: "",

  fetchMe: async () => {
    try {
      const me = await api.get<UserInfo>("/api/auth/me");
      set({ user: me, loading: false, error: "" });
      return true;
    } catch {
      set({ user: null, loading: false });
      return false;
    }
  },

  login: async (username, password) => {
    set({ error: "", loading: true });
    try {
      const res: any = await api.post("/api/auth/login", { username, password });
      // 二阶段：后端要求短信
      if (res?.sms_required) {
        set({ loading: false });
        return { sms_required: true, phone_masked: res.phone_masked };
      }
      const ok = await get().fetchMe();
      if (!ok) throw new Error("登录态校验失败");
      return { sms_required: false };
    } catch (e: any) {
      set({ error: e.message || "登录失败", loading: false });
      throw e;
    }
  },

  loginWithSms: async (username, smsCode) => {
    set({ error: "", loading: true });
    try {
      await api.post("/api/auth/login/verify", { username, sms_code: smsCode });
      const ok = await get().fetchMe();
      if (!ok) throw new Error("登录态校验失败");
      return true;
    } catch (e: any) {
      set({ error: e.message || "验证失败", loading: false });
      return false;
    }
  },

  register: async (p) => {
    set({ error: "", loading: true });
    try {
      await api.post("/api/auth/register", p);
      const ok = await get().fetchMe();
      return ok;
    } catch (e: any) {
      set({ error: e.message || "注册失败", loading: false });
      return false;
    }
  },

  logout: async () => {
    try {
      await api.post("/api/auth/logout");
    } catch {
      /* 登出尽力而为 */
    }
    set({ user: null });
  },

  clearError: () => set({ error: "" }),
}));

// cookie 会话失效（401 刷新仍失败）→ 回到登录页
setAuthFailureHandler(() => {
  useAuth.setState({ user: null });
  if (!window.location.pathname.endsWith("/login")) {
    window.location.hash = "";
    window.history.pushState(null, "", `${import.meta.env.BASE_URL}#/login`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
});
