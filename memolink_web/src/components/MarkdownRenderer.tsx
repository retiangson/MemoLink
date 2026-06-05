import React, { useEffect } from "react";
import { marked } from "marked";
import hljs from "highlight.js";
import "highlight.js/styles/github-dark.css";
import katex from "katex";
import "katex/dist/katex.min.css";
import { API_BASE } from "../api/client";
import { getToken } from "../utils/auth";

interface Props {
  children: string;
  className?: string;
}

function renderMath(source: string): string {
  let text = source;
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) =>
    `<div class="math-block">${katex.renderToString(expr, { displayMode: true, throwOnError: false })}</div>`
  );
  text = text.replace(/(?<!\$)\$([^\$]+?)\$(?!\$)/g, (_, expr) =>
    `<span class="math-inline">${katex.renderToString(expr, { displayMode: false, throwOnError: false })}</span>`
  );
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_, expr) =>
    `<span class="math-inline">${katex.renderToString(expr, { displayMode: false, throwOnError: false })}</span>`
  );
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, expr) =>
    `<div class="math-block">${katex.renderToString(expr, { displayMode: true, throwOnError: false })}</div>`
  );
  return text;
}

export default function MarkdownRenderer({ children, className }: Props) {
  const safeText = typeof children === "string" ? children : String(children || "");
  const withMath = renderMath(safeText);

  const renderer: any = new marked.Renderer();
  renderer.code = function (...args: any[]) {
    let code = "", lang = "";
    if (typeof args[0] === "string") { code = args[0]; lang = args[1] || ""; }
    else if (typeof args[0] === "object" && args[0]) { code = args[0].text || ""; lang = args[0].lang || ""; }
    else { code = String(args[0] ?? ""); }
    const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
    const highlighted = hljs.highlight(code, { language }).value;
    return `<div class="code-block-wrapper"><button class="code-copy-btn" data-code="${encodeURIComponent(code)}">Copy</button><pre><code class="hljs ${language}">${highlighted}</code></pre></div>`;
  };

  // Rewrite /api/email/attachment/... links — render as a styled download chip with icon
  renderer.link = function (this: any, ...args: any[]) {
    let href = "", title = "", text = "";
    if (typeof args[0] === "object" && args[0] !== null && "href" in args[0]) {
      href = args[0].href || ""; title = args[0].title || ""; text = args[0].text || "";
    } else {
      href = args[0] || ""; title = args[1] || ""; text = args[2] || "";
    }
    // Build absolute URL: API_BASE already ends with /api, so strip /api from the path prefix
    const fullHref = href.startsWith("/api/")
      ? `${API_BASE}${href.slice("/api".length)}`
      : href;
    const isDownload = href.includes("/api/email/attachment/");
    const titleAttr = title ? ` title="${title}"` : "";

    if (isDownload) {
      const token = getToken() ?? "";
      const sep = fullHref.includes("?") ? "&" : "?";
      const authHref = token ? `${fullHref}${sep}token=${encodeURIComponent(token)}` : fullHref;
      const clipIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16"><path d="M4.5 3a2.5 2.5 0 0 1 5 0v9a1.5 1.5 0 0 1-3 0V5a.5.5 0 0 1 1 0v7a.5.5 0 0 0 1 0V3a1.5 1.5 0 1 0-3 0v9a2.5 2.5 0 0 0 5 0V5a.5.5 0 0 1 1 0v7a3.5 3.5 0 1 1-7 0z"/></svg>`;
      const dlIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" fill="currentColor" viewBox="0 0 16 16"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5"/><path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708z"/></svg>`;
      return `<a href="${authHref}"${titleAttr} download style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;margin:2px 0;background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.35);border-radius:8px;color:#a5b4fc;text-decoration:none;font-size:0.8rem;cursor:pointer;white-space:nowrap;">${clipIcon}${text}${dlIcon}</a>`;
    }

    return `<a href="${fullHref}"${titleAttr} target="_blank" rel="noopener">${text}</a>`;
  };

  marked.setOptions({ renderer, gfm: true, breaks: true });
  const html = marked.parse(withMath) as string;

  useEffect(() => {
    const buttons = document.querySelectorAll(".code-copy-btn");
    const handler = (e: any) => {
      const encoded = e.target.getAttribute("data-code");
      if (!encoded) return;
      navigator.clipboard.writeText(decodeURIComponent(encoded));
      const orig = e.target.innerText;
      e.target.innerText = "Copied!";
      setTimeout(() => (e.target.innerText = orig), 1200);
    };
    buttons.forEach((btn) => btn.addEventListener("click", handler));
    return () => buttons.forEach((btn) => btn.removeEventListener("click", handler));
  }, [html]);


  return <div className={`markdown-body ${className || ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
