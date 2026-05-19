import { useState } from "react";
import { getUser, type User } from "./utils/auth";
import { ChatPage } from "./pages/ChatPage";
import { LoginPage } from "./pages/LoginPage";

export default function App() {
  const [user, setUser] = useState<User | null>(getUser());

  function refreshUser() {
    setUser(getUser());
  }

  if (!user) {
    return (
      <div className="app-shell">
        <LoginPage onLogin={refreshUser} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <ChatPage user={user} />
    </div>
  );
}
