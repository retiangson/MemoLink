import React, { useEffect } from "react";
import { marked } from "marked";
import hljs from "highlight.js";
import "highlight.js/styles/github-dark.css";
import katex from "katex";
import "katex/dist/katex.min.css";
import { API_BASE } from "../api/client";

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

  // Rewrite /api/email/attachment/... links to include the full API base URL
  // so downloads work when the API is on a different origin than the frontend
  renderer.link = function (this: any, ...args: any[]) {
    let href = "", title = "", text = "";
    if (typeof args[0] === "object" && args[0] !== null && "href" in args[0]) {
      href = args[0].href || ""; title = args[0].title || ""; text = args[0].text || "";
    } else {
      href = args[0] || ""; title = args[1] || ""; text = args[2] || "";
    }
    const fullHref = href.startsWith("/api/") ? `${API_BASE.replace(/\/api$/, "")}${href}` : href;
    const isDownload = href.includes("/api/email/attachment/");
    const titleAttr = title ? ` title="${title}"` : "";
    const downloadAttr = isDownload ? ` download` : ` target="_blank" rel="noopener"`;
    return `<a href="${fullHref}"${titleAttr}${downloadAttr}>${text}</a>`;
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
