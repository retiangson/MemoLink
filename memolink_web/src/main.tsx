import React from "react";
import ReactDOM from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { StatusBar } from "@capacitor/status-bar";
import App from "./App";
import "./index.css";

if (Capacitor.isNativePlatform()) {
  // Hide the OS status bar (time/signal/battery icons) so it doesn't overlap
  // MemoLink's own top menu and tabs inside the Android app shell.
  StatusBar.hide().catch(() => {});
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
