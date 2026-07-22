import { useState } from "react";
import { useAuth } from "../stores/auth";
import { api } from "../api/client";
import { Spinner, toast } from "../components/ui";
import { Icon } from "../components/Icon";

type Mode = "login" | "register" | "forgot1" | "forgot2";

export function LoginView() {
  const { login, register, loading, error, clearError } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [showQuestion, setShowQuestion] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const switchMode = (m: Mode) => {
    setMode(m);
    clearError();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "login") {
      await login(username, password);
    } else if (mode === "register") {
      const ok = await register({ username, password, security_question: question, security_answer: answer });
      if (ok) toast("注册成功，欢迎使用随行档", "success");
    } else if (mode === "forgot1") {
      try {
        const r = await api.post("/api/auth/forgot-password/question", { username });
        setShowQuestion(r.question || r.security_question || "");
        setMode("forgot2");
      } catch (e2: any) {
        toast(e2.message || "查询失败", "error");
      }
    } else if (mode === "forgot2") {
      try {
        await api.post("/api/auth/forgot-password/reset", {
          username,
          answer,
          new_password: newPassword,
        });
        toast("密码已重置，请用新密码登录", "success");
        setPassword("");
        switchMode("login");
      } catch (e2: any) {
        toast(e2.message || "重置失败", "error");
      }
    }
  };

  const titles: Record<Mode, string> = {
    login: "欢迎回来",
    register: "创建账户",
    forgot1: "找回密码",
    forgot2: "重置密码",
  };

  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden bg-bg">
      {/* 活性背景：品牌色光斑（纯 CSS，不喧宾夺主） */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary/[0.07] blur-3xl" />
        <div className="absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-primary/[0.05] blur-3xl" />
        <div className="absolute left-1/2 top-1/3 h-64 w-64 -translate-x-1/2 rounded-full bg-primary/[0.04] blur-3xl" />
      </div>

      <div className="relative w-[380px] rounded-lg border border-line bg-surface p-8 shadow-3 animate-[popIn_.25s_ease-out]">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-lg font-bold text-white shadow-2">
            随
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{titles[mode]}</h1>
          <p className="text-[12.5px] text-ink-muted">自托管 · 加密归档 · 零痕迹</p>
        </div>

        <form onSubmit={submit} className="space-y-3.5">
          <input
            className="input"
            placeholder="用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
          />
          {(mode === "login" || mode === "register") && (
            <input
              className="input"
              type="password"
              placeholder="密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          )}
          {mode === "register" && (
            <>
              <input
                className="input"
                placeholder="密保问题（如：我的小学名称？）"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <input
                className="input"
                placeholder="密保答案"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
              />
            </>
          )}
          {mode === "forgot1" && (
            <p className="text-[12.5px] leading-relaxed text-ink-muted">
              输入用户名，下一步回答注册时设置的密保问题以重置密码。
            </p>
          )}
          {mode === "forgot2" && (
            <>
              <div className="rounded-md bg-sunken px-3 py-2 text-[12.5px] text-ink-secondary">
                密保问题：{showQuestion}
              </div>
              <input
                className="input"
                placeholder="密保答案"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
              />
              <input
                className="input"
                type="password"
                placeholder="新密码（至少 8 位，含字母和数字）"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </>
          )}

          {error && <div className="text-[12.5px] text-danger">{error}</div>}

          <button className="btn-primary w-full !py-2.5" disabled={loading}>
            {loading && <Spinner className="mr-1.5 border-white border-t-transparent" />}
            {mode === "login" && "登 录"}
            {mode === "register" && "注 册"}
            {mode === "forgot1" && "下一步"}
            {mode === "forgot2" && "重置密码"}
          </button>
        </form>

        <div className="mt-5 flex items-center justify-between text-[12.5px]">
          {mode === "login" ? (
            <>
              <button className="text-ink-muted transition-colors hover:text-primary" onClick={() => switchMode("forgot1")}>
                忘记密码？
              </button>
              <button className="text-primary transition-colors hover:text-primary-hover" onClick={() => switchMode("register")}>
                创建新账户
              </button>
            </>
          ) : (
            <button className="inline-flex items-center text-ink-muted transition-colors hover:text-primary" onClick={() => switchMode("login")}>
              <Icon name="arrow-left" size={13} className="mr-1" />返回登录
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
