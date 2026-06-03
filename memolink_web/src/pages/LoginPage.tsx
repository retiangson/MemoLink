import React, { useState } from "react";
import { login, register, forgotPassword, resetPassword } from "../api/authApi";
import { saveUser } from "../utils/auth";

type Mode = "login" | "register" | "forgot" | "reset";

export function LoginPage({ onLogin, initialResetToken }: { onLogin: () => void; initialResetToken?: string }) {
  const [mode, setMode] = useState<Mode>(initialResetToken ? "reset" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError("");
    setInfo("");

    if (mode === "register" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (mode === "reset" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      if (mode === "forgot") {
        await forgotPassword(email);
        setInfo("If that email is registered, a reset link has been sent. Check your inbox.");
        return;
      }

      if (mode === "reset") {
        if (!initialResetToken) { setError("Invalid reset link."); return; }
        await resetPassword(initialResetToken, password);
        // Strip the token from the URL, then switch to login
        window.history.replaceState({}, "", window.location.pathname);
        setInfo("Password updated! You can now sign in.");
        setMode("login");
        setPassword("");
        setConfirmPassword("");
        return;
      }

      if (mode === "register") await register(email, password);
      const user = await login(email, password);
      saveUser(user);
      onLogin();
    } catch {
      if (mode === "login") setError("Invalid email or password.");
      else if (mode === "register") setError("Registration failed. Email may already exist.");
      else if (mode === "reset") setError("Reset failed. The link may have expired - request a new one.");
      else setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSubmit();
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setInfo("");
  }

  const heading =
    mode === "login" ? "Welcome back"
    : mode === "register" ? "Create an account"
    : mode === "forgot" ? "Reset your password"
    : "Set new password";

  const subheading =
    mode === "login" ? "Sign in to your knowledge base."
    : mode === "register" ? "Start linking your knowledge with AI."
    : mode === "forgot" ? "Enter your email and we'll send a reset link."
    : "Enter and confirm your new password.";

  const buttonLabel = loading
    ? "Please wait…"
    : mode === "login" ? "Sign in"
    : mode === "register" ? "Create account"
    : mode === "forgot" ? "Send reset link"
    : "Set new password";

  return (
    <div className="h-screen w-screen flex bg-[#0f0f13] text-white">

      {/* LEFT - Form */}
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

          <h2 className="text-2xl font-semibold mb-1">{heading}</h2>
          <p className="text-gray-400 text-sm mb-7">{subheading}</p>

          <div className="flex flex-col gap-3">
            {/* Email field - shown for login, register, forgot */}
            {mode !== "reset" && (
              <input
                className="w-full p-3 rounded-xl bg-[#1e1e2a] border border-[#2a2a38] text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
                placeholder="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            )}

            {/* Password field - shown for login, register, reset */}
            {mode !== "forgot" && (
              <input
                className="w-full p-3 rounded-xl bg-[#1e1e2a] border border-[#2a2a38] text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
                placeholder={mode === "reset" ? "New password" : "Password"}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            )}

            {/* Confirm password - register + reset */}
            {(mode === "register" || mode === "reset") && (
              <input
                className="w-full p-3 rounded-xl bg-[#1e1e2a] border border-[#2a2a38] text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
                placeholder="Confirm password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            )}

            {/* Forgot password link - only on login */}
            {mode === "login" && (
              <div className="flex justify-end -mt-1">
                <button
                  type="button"
                  onClick={() => switchMode("forgot")}
                  className="text-xs text-gray-500 hover:text-indigo-400 transition"
                >
                  Forgot password?
                </button>
              </div>
            )}

            {error && <p className="text-red-400 text-sm">{error}</p>}
            {info && <p className="text-indigo-300 text-sm">{info}</p>}

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white py-3 rounded-xl font-medium transition"
            >
              {buttonLabel}
            </button>

            {/* Bottom navigation links */}
            {mode === "login" && (
              <button
                onClick={() => switchMode("register")}
                className="w-full text-sm text-gray-400 hover:text-white transition"
              >
                Don't have an account? Register
              </button>
            )}
            {mode === "register" && (
              <button
                onClick={() => switchMode("login")}
                className="w-full text-sm text-gray-400 hover:text-white transition"
              >
                Already have an account? Sign in
              </button>
            )}
            {mode === "forgot" && (
              <button
                onClick={() => switchMode("login")}
                className="w-full text-sm text-gray-400 hover:text-white transition"
              >
                Back to sign in
              </button>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT - Brand panel */}
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
