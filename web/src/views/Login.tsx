import { useState, useEffect } from "react";
import { useAuth } from "../stores/auth";
import { api } from "../api/client";
import { Spinner } from "../components/ui";
import { toast, notify } from "../components/feedback";
import "./login.css";

type Mode = "login" | "register" | "forgot1" | "forgot2";

export function LoginView() {
  const { login, loginWithSms, register, loading, error, clearError } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [showQuestion, setShowQuestion] = useState("");
  const [newPassword, setNewPassword] = useState("");
  // 短信
  const [phone, setPhone] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [smsRequiredLogin, setSmsRequiredLogin] = useState(false);
  const [smsRequiredRegister, setSmsRequiredRegister] = useState(false);
  const [smsPhoneMasked, setSmsPhoneMasked] = useState("");
  const [smsCooldown, setSmsCooldown] = useState(0);
  const [smsSending, setSmsSending] = useState(false);

  // 加载短信配置
  useEffect(() => {
    api.get("/api/auth/sms/status").then((r) => {
      setSmsEnabled(r.sms_enabled);
      setSmsRequiredLogin(r.sms_required_for_login);
      setSmsRequiredRegister(r.sms_required_for_register);
    }).catch(() => { /* 降级：不展示短信 */ });
  }, []);

  // 发送验证码倒计时
  useEffect(() => {
    if (smsCooldown <= 0) return;
    const t = setTimeout(() => setSmsCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [smsCooldown]);

  const switchMode = (m: Mode) => {
    setMode(m);
    clearError();
    setSmsCode("");
    setSmsCooldown(0);
  };

  const requestSms = async (purpose: "login" | "register" | "reset", phoneOverride?: string) => {
    if (smsSending || smsCooldown > 0) return;
    setSmsSending(true);
    const body: any = { purpose };
    if (purpose === "login" || purpose === "reset") {
      body.username = username;
    } else {
      body.phone = phoneOverride || phone;
    }
    try {
      const r: any = await api.post("/api/auth/sms/send", body);
      setSmsCooldown(r.cooldown_seconds || 60);
      if (r.masked_phone) setSmsPhoneMasked(r.masked_phone);
      toast.success(`验证码已发送至 ${r.masked_phone || "手机"}`);
    } catch (e: any) {
      notify.error(e, { fallback: "发送失败" });
    } finally {
      setSmsSending(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "login") {
      // 二阶段：已展示短信输入框后，提交短信验证码
      if (smsRequiredLogin && smsPhoneMasked) {
        const ok = await loginWithSms(username, smsCode);
        if (ok) toast.success("登录成功");
        return;
      }
      // 第一阶段：密码登录；若后端要求短信二阶段，展示短信输入框
      const res: any = await login(username, password);
      if (res?.sms_required) {
        setSmsRequiredLogin(true);
        setSmsPhoneMasked(res.phone_masked || "");
        toast.success("请输入短信验证码");
        return;
      }
    } else if (mode === "register") {
      const ok = await register({
        username,
        password,
        security_question: question,
        security_answer: answer,
        phone,
        sms_code: smsCode,
      });
      if (ok) toast.success("注册成功，欢迎使用随行档");
    } else if (mode === "forgot1") {
      try {
        const r = await api.post("/api/auth/forgot-password/question", { username });
        setShowQuestion(r.question || r.security_question || "");
        setMode("forgot2");
      } catch (e2: any) {
        notify.error(e2, { fallback: "查询失败" });
      }
    } else if (mode === "forgot2") {
      try {
        await api.post("/api/auth/forgot-password/reset", {
          username,
          answer,
          new_password: newPassword,
          sms_code: smsCode,
        });
        toast.success("密码已重置，请用新密码登录");
        setPassword("");
        switchMode("login");
      } catch (e2: any) {
        notify.error(e2, { fallback: "重置失败" });
      }
    }
  };

  const titles: Record<Mode, string> = {
    login: "欢迎回来",
    register: "创建账号",
    forgot1: "找回密码",
    forgot2: "重置密码",
  };

  const subtitles: Record<Mode, string> = {
    login: "登录你的私人档案室",
    register: "建立你的私人档案室",
    forgot1: "通过密保问题或手机验证码重置密码",
    forgot2: "通过密保问题或手机验证码重置密码",
  };

  return (
    <div className="login-container">
      {/* 左：品牌面板 */}
      <aside className="login-brand">
        <div className="login-brand-top">
          <span className="login-brand-mark">档</span>
          <span className="login-brand-name">随行档</span>
        </div>
        <div className="login-brand-body">
          <h2>
            只对你显影的
            <br />
            私人档案室。
          </h2>
          <p>文件加密归档、一句话语义检索、由 AI 作答。公司电脑上只看不留，离开一键吊销。</p>
          <ul className="login-brand-points">
            <li>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5z"/><path d="M9 12l2 2 4-4"/></svg>
              AES-256 落盘加密
            </li>
            <li>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
              一句话语义检索
            </li>
            <li>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
              默认零落盘，一键吊销
            </li>
          </ul>
        </div>
        <div className="login-brand-foot">© 2026 随行档 · 自托管</div>
      </aside>

      {/* 右：表单面板 */}
      <main className="login-main">
        <div className="login-card">
          <div className="login-logo" title="返回官网">档</div>
          <h1>{titles[mode]}</h1>
          <p className="subtitle">{subtitles[mode]}</p>
          <form onSubmit={submit}>
            <div className="form-group">
              <label>用户名</label>
              <input
                className="form-input"
                placeholder="用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
              />
            </div>
            {(mode === "login" || mode === "register") && (
              <div className="form-group">
                <label>密码</label>
                <input
                  className="form-input"
                  type="password"
                  placeholder="输入密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
              </div>
            )}
            {mode === "register" && (
              <>
                <div className="form-group">
                  <label>密保问题 <span style={{ opacity: 0.5, fontSize: 12 }}>（可选，用于找回密码）</span></label>
                  <input
                    className="form-input"
                    placeholder="如：你最喜爱的运动是什么？"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>密保答案 <span style={{ opacity: 0.5, fontSize: 12 }}>（可选）</span></label>
                  <input
                    className="form-input"
                    placeholder="用于找回密码"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                  />
                </div>
                {(smsEnabled || smsRequiredRegister) && (
                  <div className="form-group">
                    <label>手机号 {smsRequiredRegister && <span style={{ color: "var(--danger)" }}>*</span>}</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        className="form-input"
                        placeholder="11 位手机号"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={smsSending || smsCooldown > 0 || !phone}
                        onClick={() => requestSms("register", phone)}
                        style={{ whiteSpace: "nowrap" }}
                      >
                        {smsCooldown > 0 ? `${smsCooldown}s` : "获取验证码"}
                      </button>
                    </div>
                  </div>
                )}
                {smsRequiredRegister && (
                  <div className="form-group">
                    <label>短信验证码 <span style={{ color: "var(--danger)" }}>*</span></label>
                    <input
                      className="form-input"
                      placeholder="6 位数字"
                      value={smsCode}
                      onChange={(e) => setSmsCode(e.target.value)}
                      maxLength={6}
                    />
                  </div>
                )}
              </>
            )}
            {mode === "forgot1" && (
              <div className="form-group">
                <label>用户名</label>
                <input
                  className="form-input"
                  placeholder="输入你的用户名"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                />
              </div>
            )}
            {mode === "forgot2" && (
              <>
                <div className="form-group">
                  <label>密保答案 <span style={{ opacity: 0.5, fontSize: 12 }}>（如已设置）</span></label>
                  <input
                    className="form-input"
                    placeholder="输入密保答案"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                  />
                </div>
                {smsEnabled && (
                  <div className="form-group">
                    <label>或 短信验证码</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        className="form-input"
                        placeholder="6 位数字"
                        value={smsCode}
                        onChange={(e) => setSmsCode(e.target.value)}
                        maxLength={6}
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={smsSending || smsCooldown > 0}
                        onClick={() => requestSms("reset")}
                        style={{ whiteSpace: "nowrap" }}
                      >
                        {smsCooldown > 0 ? `${smsCooldown}s` : "获取验证码"}
                      </button>
                    </div>
                  </div>
                )}
                <div className="form-group">
                  <label>新密码</label>
                  <input
                    className="form-input"
                    type="password"
                    placeholder="8个字符以上"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              </>
            )}

            {/* 登录二阶段：密码正确后要求短信 */}
            {mode === "login" && smsRequiredLogin && smsPhoneMasked && (
              <div className="form-group">
                <label>短信验证码 <span style={{ color: "var(--danger)" }}>*</span></label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="form-input"
                    placeholder={`发送至 ${smsPhoneMasked}`}
                    value={smsCode}
                    onChange={(e) => setSmsCode(e.target.value)}
                    maxLength={6}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={smsSending || smsCooldown > 0}
                    onClick={() => requestSms("login")}
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {smsCooldown > 0 ? `${smsCooldown}s` : "获取验证码"}
                  </button>
                </div>
              </div>
            )}

            {error && <div className="text-[12.5px] text-danger" style={{ marginBottom: 8 }}>{error}</div>}

            <button className="btn-primary" disabled={loading}>
              {loading && <Spinner className="mr-1.5 border-white border-t-transparent" />}
              {mode === "login" && "登录"}
              {mode === "register" && "注册"}
              {mode === "forgot1" && "下一步"}
              {mode === "forgot2" && "重置密码"}
            </button>
          </form>
          <div className="login-links">
            {mode === "login" ? (
              <>
                <button className="link-like" onClick={() => switchMode("forgot1")}>忘记密码？</button>
                <button className="link-like" onClick={() => switchMode("register")}>注册新账号</button>
              </>
            ) : (
              <button className="link-like" onClick={() => switchMode("login")} style={{ margin: "0 auto" }}>
                返回登录
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
