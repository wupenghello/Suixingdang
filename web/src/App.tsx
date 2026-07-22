import { useEffect, useState } from "react";
import { Layout, useCurrentView, navigate } from "./components/Layout";
import { ToastViewport, Spinner } from "./components/ui";
import { useAuth } from "./stores/auth";
import { LoginView } from "./views/Login";
import { ChatView } from "./views/Chat";
import { FilesView } from "./views/Files";
import { NotesView } from "./views/Notes";
import { TrashView } from "./views/Trash";
import { TransferView } from "./views/Transfer";
import { SettingsView } from "./views/Settings";

function ViewSwitch() {
  const view = useCurrentView();
  switch (view) {
    case "chat":
      return <ChatView />;
    case "notes":
      return <NotesView />;
    case "transfer":
      return <TransferView />;
    case "trash":
      return <TrashView />;
    case "settings":
      return <SettingsView />;
    case "files":
    default:
      return <FilesView />;
  }
}

export default function App() {
  const { user, loading, fetchMe } = useAuth();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetchMe().finally(() => setReady(true));
  }, [fetchMe]);

  if (!ready || loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-xl font-bold text-white shadow-2">
          随
        </div>
        <Spinner className="h-5 w-5" />
        <div className="text-[13px] text-ink-muted">正在打开你的档案室…</div>
      </div>
    );
  }

  if (!user) return <LoginView />;

  const hash = window.location.hash;
  if (!hash || hash === "#/" || hash === "#/login") navigate("#/files");

  return (
    <>
      <Layout>
        <ViewSwitch />
      </Layout>
      <ToastViewport />
    </>
  );
}
