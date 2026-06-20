/*
 * MemoLink Public Portfolio Agent — embeddable chat widget.
 *
 * Usage (drop this single script tag into any external site):
 *
 *   <script
 *     src="https://<memolink-web-host>/widget.js"
 *     data-agent-token="YOUR_PUBLIC_AGENT_TOKEN"
 *     data-api-base="https://<memolink-api-host>/api"
 *     data-title="Portfolio Assistant"
 *     async
 *   ></script>
 *
 * Security notes:
 * - This widget only ever calls the single unauthenticated endpoint
 *   POST {api-base}/public/agents/{token}/chat. It cannot read or write
 *   anything else in MemoLink.
 * - Chat history lives only in this page's memory (a plain JS array) for as
 *   long as the tab is open. It is never written to localStorage,
 *   sessionStorage, or cookies, and is lost on refresh/navigation — matching
 *   the "visitor widget history is never persisted server-side" requirement.
 * - All rendered text (visitor messages, agent answers, source titles) is
 *   inserted via textContent, never innerHTML, so nothing in a message or a
 *   note can inject markup/scripts into the host page.
 * - Rendered inside a Shadow DOM so host-page CSS cannot bleed in/out.
 */
(function () {
  "use strict";

  var scriptEl = document.currentScript;
  if (!scriptEl) return;

  var AGENT_TOKEN = scriptEl.getAttribute("data-agent-token");
  var API_BASE = (scriptEl.getAttribute("data-api-base") || "").replace(/\/$/, "");
  var TITLE = scriptEl.getAttribute("data-title") || "Portfolio Assistant";
  var AVATAR_URL = scriptEl.getAttribute("data-avatar-url") || "";
  // Whether the agent owner configured a custom persona (the raw text itself is never sent
  // to this public, unauthenticated widget — only this boolean flag). Drives whether opening
  // the chat asks the model for a personalized introduction or just shows a generic greeting.
  var HAS_PERSONA = scriptEl.getAttribute("data-has-persona") === "true";
  var DEFAULT_GREETING = "Hi! How can I help you today?";
  var GREETING_TRIGGER_MESSAGE = "Greet me and briefly introduce yourself.";
  var MAX_MESSAGE_LENGTH = 2000;

  if (!AGENT_TOKEN || !API_BASE) {
    console.error("[MemoLink widget] data-agent-token and data-api-base are required on the <script> tag.");
    return;
  }

  var CHAT_URL = API_BASE + "/public/agents/" + encodeURIComponent(AGENT_TOKEN) + "/chat";

  // In-memory-only history — never persisted anywhere.
  var history = [];
  var sending = false;
  var greeted = false;

  var host = document.createElement("div");
  host.style.position = "fixed";
  host.style.zIndex = "2147483000";
  host.style.bottom = "0";
  host.style.right = "0";
  document.body.appendChild(host);

  var shadow = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

  var style = document.createElement("style");
  style.textContent = [
    ":host { all: initial; }",
    "* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }",
    ".ml-launcher { position: fixed; bottom: 20px; right: 20px; width: 56px; height: 56px; border-radius: 50%;",
    "  background: #4f46e5; color: #fff; border: none; cursor: pointer; display: flex; align-items: center;",
    "  justify-content: center; box-shadow: 0 6px 20px rgba(0,0,0,0.25); padding: 0; overflow: hidden; }",
    ".ml-launcher:hover { background: #4338ca; }",
    ".ml-launcher:focus-visible { outline: 2px solid #c7d2fe; outline-offset: 2px; }",
    ".ml-panel { position: fixed; bottom: 88px; right: 20px; width: min(360px, calc(100vw - 32px));",
    "  height: min(520px, calc(100vh - 120px)); background: #15151f; color: #e5e7eb; border-radius: 16px;",
    "  box-shadow: 0 12px 40px rgba(0,0,0,0.4); display: none; flex-direction: column; overflow: hidden;",
    "  border: 1px solid #2a2a3a; }",
    ".ml-panel.ml-open { display: flex; }",
    ".ml-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px;",
    "  background: #1a1a24; border-bottom: 1px solid #2a2a3a; flex-shrink: 0; }",
    ".ml-header-left { display: flex; align-items: center; gap: 8px; min-width: 0; }",
    ".ml-header-avatar { width: 26px; height: 26px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }",
    ".ml-header-titles { display: flex; flex-direction: column; gap: 1px; min-width: 0; }",
    ".ml-header-title { font-size: 13px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".ml-header-sub { font-size: 10px; font-weight: 400; color: #9ca3af; }",
    ".ml-close { background: transparent; border: none; color: #9ca3af; cursor: pointer; font-size: 16px;",
    "  line-height: 1; padding: 4px; border-radius: 6px; flex-shrink: 0; }",
    ".ml-close:hover { color: #fff; background: #252533; }",
    ".ml-messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }",
    ".ml-msg { max-width: 85%; padding: 8px 11px; border-radius: 12px; font-size: 13px; line-height: 1.4;",
    "  white-space: pre-wrap; word-break: break-word; }",
    ".ml-msg-user { align-self: flex-end; background: #4f46e5; color: #fff; }",
    ".ml-msg-agent { align-self: flex-start; background: #252533; color: #e5e7eb; }",
    ".ml-msg-error { align-self: flex-start; background: rgba(239,68,68,0.12); color: #fca5a5;",
    "  border: 1px solid rgba(239,68,68,0.3); }",
    ".ml-sources { margin-top: 4px; font-size: 10px; color: #9ca3af; }",
    ".ml-typing { align-self: flex-start; display: flex; gap: 3px; padding: 8px 11px; }",
    ".ml-typing span { width: 5px; height: 5px; border-radius: 50%; background: #6b7280; display: inline-block;",
    "  animation: ml-bounce 1.2s infinite ease-in-out; }",
    ".ml-typing span:nth-child(2) { animation-delay: .15s; }",
    ".ml-typing span:nth-child(3) { animation-delay: .3s; }",
    "@keyframes ml-bounce { 0%, 80%, 100% { transform: translateY(0); opacity: .5; } 40% { transform: translateY(-3px); opacity: 1; } }",
    ".ml-inputrow { display: flex; gap: 6px; padding: 10px; border-top: 1px solid #2a2a3a; flex-shrink: 0; }",
    ".ml-input { flex: 1; resize: none; background: #1a1a24; border: 1px solid #2a2a3a; border-radius: 10px;",
    "  color: #e5e7eb; font-size: 13px; padding: 8px 10px; max-height: 80px; }",
    ".ml-input:focus { outline: none; border-color: #4f46e5; }",
    ".ml-send { background: #4f46e5; color: #fff; border: none; border-radius: 10px; padding: 0 14px;",
    "  font-size: 12px; font-weight: 600; cursor: pointer; }",
    ".ml-send:disabled { opacity: .4; cursor: not-allowed; }",
    ".ml-empty { color: #6b7280; font-size: 12px; text-align: center; margin-top: 24px; padding: 0 16px; }",
    "@media (max-width: 420px) { .ml-panel { right: 16px; bottom: 84px; } .ml-launcher { right: 16px; bottom: 16px; } }",
  ].join("\n");
  shadow.appendChild(style);

  var launcher = document.createElement("button");
  launcher.className = "ml-launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Open chat with " + TITLE);
  launcher.setAttribute("aria-expanded", "false");
  if (AVATAR_URL) {
    var launcherImg = document.createElement("img");
    launcherImg.src = AVATAR_URL;
    launcherImg.alt = "";
    launcherImg.style.width = "100%";
    launcherImg.style.height = "100%";
    launcherImg.style.borderRadius = "50%";
    launcherImg.style.objectFit = "cover";
    launcher.appendChild(launcherImg);
  } else {
    launcher.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
      '<path stroke-linecap="round" stroke-linejoin="round" d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>' +
      "</svg>";
  }

  var panel = document.createElement("div");
  panel.className = "ml-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", TITLE);

  var header = document.createElement("div");
  header.className = "ml-header";
  var headerLeft = document.createElement("div");
  headerLeft.className = "ml-header-left";
  if (AVATAR_URL) {
    var headerAvatar = document.createElement("img");
    headerAvatar.className = "ml-header-avatar";
    headerAvatar.src = AVATAR_URL;
    headerAvatar.alt = "";
    headerLeft.appendChild(headerAvatar);
  }
  var headerTitles = document.createElement("div");
  headerTitles.className = "ml-header-titles";
  var headerTitle = document.createElement("span");
  headerTitle.className = "ml-header-title";
  headerTitle.textContent = TITLE;
  var headerSub = document.createElement("span");
  headerSub.className = "ml-header-sub";
  headerSub.textContent = "Powered by MemoLink";
  headerTitles.appendChild(headerTitle);
  headerTitles.appendChild(headerSub);
  headerLeft.appendChild(headerTitles);
  var closeBtn = document.createElement("button");
  closeBtn.className = "ml-close";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close chat");
  closeBtn.textContent = "✕";
  header.appendChild(headerLeft);
  header.appendChild(closeBtn);

  var messagesEl = document.createElement("div");
  messagesEl.className = "ml-messages";
  messagesEl.setAttribute("role", "log");
  messagesEl.setAttribute("aria-live", "polite");

  var emptyState = document.createElement("div");
  emptyState.className = "ml-empty";
  emptyState.textContent = "Ask a question to get started.";
  messagesEl.appendChild(emptyState);

  var inputRow = document.createElement("div");
  inputRow.className = "ml-inputrow";
  var input = document.createElement("textarea");
  input.className = "ml-input";
  input.rows = 1;
  input.maxLength = MAX_MESSAGE_LENGTH;
  input.placeholder = "Type a message…";
  input.setAttribute("aria-label", "Message");
  var sendBtn = document.createElement("button");
  sendBtn.className = "ml-send";
  sendBtn.type = "button";
  sendBtn.textContent = "Send";
  inputRow.appendChild(input);
  inputRow.appendChild(sendBtn);

  panel.appendChild(header);
  panel.appendChild(messagesEl);
  panel.appendChild(inputRow);

  shadow.appendChild(launcher);
  shadow.appendChild(panel);

  function showGreeting() {
    if (greeted) return;
    greeted = true;
    if (!HAS_PERSONA) {
      addBubble("agent", DEFAULT_GREETING);
      return;
    }
    var typing = showTyping();
    fetch(CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: GREETING_TRIGGER_MESSAGE }),
    })
      .then(function (res) {
        typing.remove();
        if (!res.ok) throw new Error("greeting failed");
        return res.json();
      })
      .then(function (data) {
        if (!data.sources || !data.sources.length) {
          addBubble("agent", DEFAULT_GREETING);
          return;
        }
        var bubble = addBubble("agent", data.answer);
        addSources(bubble, data.sources);
      })
      .catch(function () {
        if (typing.parentNode) typing.remove();
        addBubble("agent", DEFAULT_GREETING);
      });
  }

  var isOpen = false;
  function setOpen(open) {
    isOpen = open;
    panel.classList.toggle("ml-open", open);
    launcher.setAttribute("aria-expanded", String(open));
    if (open) {
      input.focus();
      showGreeting();
    }
  }

  launcher.addEventListener("click", function () { setOpen(!isOpen); });
  closeBtn.addEventListener("click", function () { setOpen(false); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen) setOpen(false);
  });

  function addBubble(role, text) {
    if (emptyState.parentNode) emptyState.remove();
    var bubble = document.createElement("div");
    bubble.className = "ml-msg " + (role === "user" ? "ml-msg-user" : role === "error" ? "ml-msg-error" : "ml-msg-agent");
    bubble.textContent = text;
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return bubble;
  }

  function addSources(bubble, sources) {
    if (!sources || !sources.length) return;
    var titles = sources.map(function (s) { return s.title || "Untitled note"; });
    var note = document.createElement("div");
    note.className = "ml-sources";
    note.textContent = "Source: " + titles.join(", ");
    bubble.appendChild(note);
  }

  function showTyping() {
    var typing = document.createElement("div");
    typing.className = "ml-typing";
    typing.setAttribute("aria-label", "Assistant is typing");
    typing.innerHTML = "<span></span><span></span><span></span>";
    messagesEl.appendChild(typing);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return typing;
  }

  function friendlyError(status) {
    if (status === 404) return "This assistant isn't available right now.";
    if (status === 403) return "This assistant isn't available on this site, or is currently disabled.";
    if (status === 429) return "Too many messages — please wait a moment and try again.";
    if (status === 422) return "Your message is too long or empty. Please shorten it and try again.";
    return "Something went wrong reaching the assistant. Please try again.";
  }

  function sendMessage() {
    var text = input.value.trim();
    if (!text || sending) return;
    if (text.length > MAX_MESSAGE_LENGTH) {
      addBubble("error", "Message must be " + MAX_MESSAGE_LENGTH + " characters or fewer.");
      return;
    }

    sending = true;
    sendBtn.disabled = true;
    input.value = "";
    input.style.height = "auto";

    addBubble("user", text);
    history.push({ role: "user", text: text });
    var typing = showTyping();

    fetch(CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    })
      .then(function (res) {
        typing.remove();
        if (!res.ok) {
          var err = new Error("request failed");
          err.status = res.status;
          throw err;
        }
        return res.json();
      })
      .then(function (data) {
        var bubble = addBubble("agent", data.answer);
        addSources(bubble, data.sources);
        history.push({ role: "agent", text: data.answer });
      })
      .catch(function (err) {
        if (typing.parentNode) typing.remove();
        addBubble("error", friendlyError(err && err.status));
      })
      .finally(function () {
        sending = false;
        sendBtn.disabled = false;
      });
  }

  sendBtn.addEventListener("click", sendMessage);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  input.addEventListener("input", function () {
    input.style.height = "auto";
    input.style.height = Math.min(80, input.scrollHeight) + "px";
  });
})();
