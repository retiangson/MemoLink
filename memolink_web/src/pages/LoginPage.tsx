import React, { useState } from "react";
import { login, register } from "../api/authApi";
import { saveUser } from "../utils/auth";

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError("");
    if (mode === "register" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "register") await register(email, password);
      const user = await login(email, password);
      saveUser(user);
      onLogin();
    } catch {
      setError(mode === "login" ? "Invalid email or password." : "Registration failed. Email may already exist.");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSubmit();
  }

  return (
    <div className="h-screen w-screen flex bg-[#0f0f13] text-white">

      {/* LEFT — Form */}
      <div className="flex flex-col justify-center items-center w-full md:w-1/2 p-8">
        <div className="w-full max-w-sm">

          {/* Logo mark */}
          <div className="mb-8">
            <img
              src="/memolink-logo.png"
              alt="MemoLink"
              className="h-14 w-auto rounded-xl bg-white/95 p-2 shadow-lg shadow-black/20"
            />
          </div>

          <h2 className="text-2xl font-semibold mb-1">
            {mode === "login" ? "Welcome back" : "Create an account"}
          </h2>
          <p className="text-gray-400 text-sm mb-7">
            {mode === "login" ? "Sign in to your knowledge base." : "Start linking your knowledge with AI."}
          </p>

          <div className="flex flex-col gap-3">
            <input
              className="w-full p-3 rounded-xl bg-[#1e1e2a] border border-[#2a2a38] text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
              placeholder="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <input
              className="w-full p-3 rounded-xl bg-[#1e1e2a] border border-[#2a2a38] text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
              placeholder="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            {mode === "register" && (
              <input
                className="w-full p-3 rounded-xl bg-[#1e1e2a] border border-[#2a2a38] text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
                placeholder="Confirm Password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            )}

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white py-3 rounded-xl font-medium transition"
            >
              {loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
            </button>

            <button
              onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
              className="w-full text-sm text-gray-400 hover:text-white transition"
            >
              {mode === "login" ? "Don't have an account? Register" : "Already have an account? Sign in"}
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT — Brand panel */}
      <div className="hidden md:flex flex-col justify-center items-center w-1/2 relative overflow-hidden bg-gradient-to-br from-[#0f0f1a] to-[#1a1a40]">
        <div className="absolute inset-0 opacity-20"
          style={{ backgroundImage: "radial-gradient(circle at 30% 50%, #6366f1 0%, transparent 60%), radial-gradient(circle at 70% 30%, #818cf8 0%, transparent 50%)" }}
        />
        <div className="relative z-10 text-center px-12">
          <img
            src="/memolink-logo.png"
            alt="MemoLink"
            className="mx-auto mb-6 h-24 w-auto rounded-2xl bg-white/95 p-3 shadow-2xl shadow-indigo-900/40"
          />
          <p className="text-gray-300 max-w-sm mx-auto leading-relaxed text-lg">
            Your context-aware AI companion for knowledge capture, retrieval, and task support.
          </p>
          <div className="mt-8 flex flex-col gap-3 text-left max-w-xs mx-auto">
            {["Upload notes & documents", "Ask AI questions grounded in your notes", "Persistent conversation history", "Save AI answers back as notes"].map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm text-gray-300">
                <span className="text-indigo-400">✓</span> {f}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
