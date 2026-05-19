import React, { useEffect } from "react";
import { marked } from "marked";
import hljs from "highlight.js";
import "highlight.js/styles/github-dark.css";
import katex from "katex";
import "katex/dist/katex.min.css";

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

  marked.setOptions({ renderer, gfm: true, breaks: true });
  const html = marked.parse(withMath);

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
