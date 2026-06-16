import { useState, useEffect } from "react";
import { getUser, type User } from "./utils/auth";
import { ChatPage } from "./pages/ChatPage";
import { LoginPage } from "./pages/LoginPage";
import { WorkspaceSetupPage } from "./pages/WorkspaceSetupPage";
import { useWorkspace } from "./hooks/useWorkspace";
import { useTheme } from "./hooks/useTheme";
import { API_BASE } from "./api/client";
import type { Workspace } from "./types";

export default function App() {
  useTheme();
  const [user, setUser] = useState<User | null>(getUser());
  const workspace = useWorkspace();

  const resetToken = new URLSearchParams(window.location.search).get("reset_token") ?? undefined;

  function refreshUser() {
    setUser(getUser());
  }

  useEffect(() => {
    if (user) {
      workspace.initWorkspace();
      // Start the remote desktop bridge when running inside Electron
      if (window.electronAPI?.bridgeConnect) {
        window.electronAPI.bridgeConnect(API_BASE, user.access_token).catch((err) => {
          console.error("Failed to start MemoLink desktop bridge", err);
        });
      }
    }
    return () => {
      if (window.electronAPI?.bridgeDisconnect) {
        window.electronAPI.bridgeDisconnect();
      }
    };
  }, [user]);

  if (!user || resetToken) {
    return (
      <div className="app-shell">
        <LoginPage onLogin={refreshUser} initialResetToken={resetToken} />
      </div>
    );
  }

  if (workspace.loading) {
    return (
      <div className="app-shell flex items-center justify-center bg-[var(--ml-bg-base)] text-gray-500 text-sm">
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
