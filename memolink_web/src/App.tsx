import { useState, useEffect } from "react";
import { getUser, type User } from "./utils/auth";
import { ChatPage } from "./pages/ChatPage";
import { LoginPage } from "./pages/LoginPage";
import { WorkspaceSetupPage } from "./pages/WorkspaceSetupPage";
import { useWorkspace } from "./hooks/useWorkspace";
import type { Workspace } from "./types";

export default function App() {
  const [user, setUser] = useState<User | null>(getUser());
  const workspace = useWorkspace();

  function refreshUser() {
    setUser(getUser());
  }

  useEffect(() => {
    if (user) {
      workspace.initWorkspace();
    }
  }, [user]);

  if (!user) {
    return (
      <div className="app-shell">
        <LoginPage onLogin={refreshUser} />
      </div>
    );
  }

  if (workspace.loading) {
    return (
      <div className="app-shell flex items-center justify-center bg-[#0f0f13] text-gray-500 text-sm">
        Loading…
      </div>
    );
  }

  if (workspace.noWorkspaces) {
    return (
      <div className="app-shell">
        <WorkspaceSetupPage
          onAdd={workspace.addWorkspace}
          onCreated={(ws: Workspace) => {
            workspace.setActiveWorkspaceState(ws);
            workspace.setWorkspaces([ws]);
          }}
        />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <ChatPage
        user={user}
        workspaceHook={workspace}
      />
    </div>
  );
}
