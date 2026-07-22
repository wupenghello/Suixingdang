import { create } from "zustand";
import { api, setAuthFailureHandler } from "../api/client";

export interface UserInfo {
  id: string;
  username: string;
  role?: string;
  quota_mb?: number;
  used_mb?: number;
  ai_enabled?: boolean;
  [k: string]: any;
}

interface AuthState {
  user: UserInfo | null;
  loading: boolean;
  error: string;
  fetchMe: () => Promise<boolean>;
  login: (username: string, password: string) => Promise<boolean>;
  register: (p: {
    username: string;
    password: string;
    security_question: string;
    security_answer: string;
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
      await api.post("/api/auth/login", { username, password });
      const ok = await get().fetchMe();
      if (!ok) throw new Error("登录态校验失败");
      return true;
    } catch (e: any) {
      set({ error: e.message || "登录失败", loading: false });
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
