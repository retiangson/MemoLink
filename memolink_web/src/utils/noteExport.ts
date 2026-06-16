import TurndownService from "turndown";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import * as XLSX from "xlsx";
import { marked } from "marked";

export type ExportFormat = "md" | "txt" | "html" | "doc" | "docx" | "xlsx" | "pdf";

export const EXPORT_FORMATS: { value: ExportFormat; label: string; ext: string }[] = [
  { value: "md",   label: "Markdown",    ext: ".md"   },
  { value: "txt",  label: "Plain Text",  ext: ".txt"  },
  { value: "html", label: "HTML",        ext: ".html" },
  { value: "doc",  label: "Word (.doc)", ext: ".doc" },
  { value: "docx", label: "Word (.docx)", ext: ".docx" },
  { value: "xlsx", label: "Excel (.xlsx)", ext: ".xlsx" },
  { value: "pdf",  label: "PDF", ext: ".pdf"  },
];

async function download(blob: Blob, filename: string) {
  if (window.electronAPI) {
    const buffer = await blob.arrayBuffer();
    const binary = Array.from(new Uint8Array(buffer));
    const result = await window.electronAPI.saveFile({ filename, binary });
    if (result.success && result.filePath) {
      await window.electronAPI.openPath(result.filePath);
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function safeFilename(title: string) {
  return (title || "note").replace(/[^\w\-. ]/g, "_").trim().slice(0, 80) || "note";
}

function htmlToPlainText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent ?? div.innerText ?? "";
}

function unwrapMarkdownFence(s: string) {
  const match = s.trim().match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return match ? match[1].trim() : s;
}

function looksLikeMarkdown(s: string) {
  return /(^|\n)\s{0,3}#{1,6}\s+\S/.test(s) ||
    /(^|\n)\s{0,3}[-*]\s+\S/.test(s) ||
    /(^|\n)\s{0,3}\d+\.\s+\S/.test(s) ||
    /(\*\*|__)[^*_]+(\*\*|__)/.test(s) ||
    /(^|\n)\s{0,3}>\s+\S/.test(s);
}

function hasRichHtmlStructure(s: string) {
  return /<(h[1-6]|ul|ol|li|strong|b|em|i|blockquote|table|thead|tbody|tr|th|td)\b/i.test(s);
}

async function normalizeToHtml(content: string): Promise<string> {
  if (!content.trim()) return "";

  const unwrapped = unwrapMarkdownFence(content);
  if (unwrapped !== content) return (await marked(unwrapped)) as string;

  // Markdown takes priority - convert via marked even if content contains some HTML
  if (looksLikeMarkdown(content)) return (await marked(content)) as string;

  // Rich HTML from TipTap - use as-is
  if (/^\s*</.test(content) && hasRichHtmlStructure(content)) return content;

  return (await marked(content)) as string;
}

function htmlToMarkdown(html: string): string {
  const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });
  return td.turndown(html);
}

const EXPORT_STYLES = `
  body{font-family:Georgia,'Times New Roman',serif;max-width:800px;margin:40px auto;padding:0 24px;line-height:1.75;color:#1f2933;background:#fff}
  .document-title{font-family:'Segoe UI',Arial,sans-serif;font-size:28px;font-weight:700;margin:0 0 24px;color:#111827;border-bottom:2px solid #4f46e5;padding-bottom:10px}
  h1,h2,h3,h4{font-family:'Segoe UI',Arial,sans-serif;color:#111827;line-height:1.25}
  h1{font-size:26px;border-bottom:1px solid #d9ddf8;padding-bottom:8px;margin-top:1.4em}
  h2{font-size:21px;margin-top:1.25em}
  h3{font-size:17px;margin-top:1em}
  h4{font-size:14px;text-transform:uppercase;letter-spacing:.04em;margin-top:.9em}
  p{margin:0 0 .75em}
  strong,b{font-weight:700;color:#111827}
  em,i{font-style:italic}
  code{font-family:Consolas,'Courier New',monospace;background:#f3f4f6;padding:2px 5px;border-radius:3px;font-size:.9em}
  pre{font-family:Consolas,'Courier New',monospace;background:#f3f4f6;border:1px solid #e5e7eb;padding:14px;border-radius:6px;white-space:pre-wrap}
  blockquote{border-left:4px solid #4f46e5;padding:8px 16px;margin:1em 0;background:#f5f7ff;color:#374151;font-style:italic}
  ul,ol{padding-left:1.5rem;margin:.75em 0}
  li{margin:.25em 0}
  table{border-collapse:collapse;width:100%;margin:1em 0;font-family:'Segoe UI',Arial,sans-serif;font-size:.95em}
  td,th{border:1px solid #d1d5db;padding:8px 12px;text-align:left;vertical-align:top}
  th{background:#eef2ff;font-weight:700}
  tr:nth-child(even) td{background:#f9fafb}
  hr{border:0;border-top:1px solid #d1d5db;margin:2em 0}
  mark{background:#fff3a3;padding:1px 3px;border-radius:2px}
  a{color:#4f46e5;text-decoration:underline}
  @media print{body{margin:0 auto}}
`;

const HTML_TEMPLATE = (title: string, body: string) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>${EXPORT_STYLES}</style>
</head>
<body>
  <h1 class="document-title">${title}</h1>
  ${body}
</body>
</html>`;

function createExportElement(title: string, body: string) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `<style>${EXPORT_STYLES}</style><h1 class="document-title">${title}</h1>${body}`;
  wrapper.style.background = "#fff";
  wrapper.style.color = "#1f2933";
  wrapper.style.padding = "24px";
  wrapper.style.maxWidth = "800px";
  return wrapper;
}

function runsFromNode(node: Node, marks: { bold?: boolean; italics?: boolean; code?: boolean } = {}): TextRun[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    return text ? [new TextRun({ text, bold: marks.bold, italics: marks.italics, font: marks.code ? "Consolas" : undefined })] : [];
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return [];

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const nextMarks = {
    bold: marks.bold || tag === "strong" || tag === "b" || tag === "th",
    italics: marks.italics || tag === "em" || tag === "i",
    code: marks.code || tag === "code",
  };

  const runs: TextRun[] = [];
  el.childNodes.forEach((child) => runs.push(...runsFromNode(child, nextMarks)));
  return runs;
}

function paragraphFromElement(el: Element, options: { bullet?: boolean; numbered?: boolean; level?: number } = {}) {
  const tag = el.tagName.toLowerCase();
  const children = runsFromNode(el);
  const text = children.length ? undefined : (el.textContent ?? "");

  if (tag === "h1") return new Paragraph({ children, text, heading: HeadingLevel.HEADING_1 });
  if (tag === "h2") return new Paragraph({ children, text, heading: HeadingLevel.HEADING_2 });
  if (tag === "h3") return new Paragraph({ children, text, heading: HeadingLevel.HEADING_3 });
  if (tag === "h4") return new Paragraph({ children, text, heading: HeadingLevel.HEADING_4 });
  if (tag === "blockquote") return new Paragraph({ children, text, indent: { left: 360 } });
  if (options.bullet) return new Paragraph({ children, text, bullet: { level: options.level ?? 0 } });
  if (options.numbered) return new Paragraph({ children, text, numbering: { reference: "default-numbering", level: options.level ?? 0 } });
  return new Paragraph({ children, text });
}

function buildDocxParagraphs(html: string): Paragraph[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const paragraphs: Paragraph[] = [];

  function walk(parent: ParentNode, listType?: "ul" | "ol", level = 0) {
    parent.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim();
        if (text) paragraphs.push(new Paragraph({ text }));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();

      if (tag === "ul" || tag === "ol") {
        walk(el, tag, level);
      } else if (tag === "li") {
        paragraphs.push(paragraphFromElement(el, { bullet: listType === "ul", numbered: listType === "ol", level }));
        Array.from(el.children)
          .filter((child) => ["ul", "ol"].includes(child.tagName.toLowerCase()))
          .forEach((child) => walk(child, child.tagName.toLowerCase() as "ul" | "ol", level + 1));
      } else if (tag === "table") {
        Array.from(el.querySelectorAll("tr")).forEach((row) => {
          const cells = Array.from(row.querySelectorAll("th,td")).map((cell) => cell.textContent?.trim()).filter(Boolean);
          if (cells.length) paragraphs.push(new Paragraph({ text: cells.join(" | ") }));
        });
      } else if (["h1", "h2", "h3", "h4", "p", "blockquote", "pre"].includes(tag)) {
        paragraphs.push(paragraphFromElement(el));
      } else {
        walk(el, listType, level);
      }
    });
  }

  walk(doc.body);
  return paragraphs.length ? paragraphs : [new Paragraph({ text: "" })];
}

export async function exportNote(title: string, content: string, format: ExportFormat) {
  const name = safeFilename(title);
  const html = await normalizeToHtml(content);

  switch (format) {
    case "md": {
      const markdown = htmlToMarkdown(html);
      await download(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), `${name}.md`);
      break;
    }

    case "txt": {
      const plain = htmlToPlainText(html);
      await download(new Blob([plain], { type: "text/plain;charset=utf-8" }), `${name}.txt`);
      break;
    }

    case "html": {
      await download(
        new Blob([HTML_TEMPLATE(title, html)], { type: "text/html;charset=utf-8" }),
        `${name}.html`,
      );
      break;
    }

    case "doc": {
      await download(
        new Blob(["\ufeff", HTML_TEMPLATE(title, html)], { type: "application/msword;charset=utf-8" }),
        `${name}.doc`,
      );
      break;
    }

    case "docx": {
      const doc = new Document({
        numbering: {
          config: [{ reference: "default-numbering", levels: [{ level: 0, format: "decimal", text: "%1.", alignment: "left" }] }],
        },
        sections: [{ properties: {}, children: buildDocxParagraphs(html) }],
      });
      await download(await Packer.toBlob(doc), `${name}.docx`);
      break;
    }

    case "xlsx": {
      const plain = htmlToPlainText(html);
      const rows = plain.split("\n").filter(Boolean).map((line) => [line]);
      const ws = XLSX.utils.aoa_to_sheet([[title, ""], ["", ""], ...rows]);
      ws["!cols"] = [{ wch: 100 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Note");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      await download(
        new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `${name}.xlsx`,
      );
      break;
    }

    case "pdf": {
      const html2pdf = (await import("html2pdf.js")).default as any;
      const element = createExportElement(title, html);
      await html2pdf()
        .set({
          margin: 0.45,
          filename: `${name}.pdf`,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, backgroundColor: "#ffffff" },
          jsPDF: { unit: "in", format: "a4", orientation: "portrait" },
        })
        .from(element)
        .save();
      break;
    }
  }
}
