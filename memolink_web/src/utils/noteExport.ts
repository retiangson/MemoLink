import TurndownService from "turndown";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import * as XLSX from "xlsx";

export type ExportFormat = "md" | "txt" | "html" | "docx" | "xlsx" | "pdf";

export const EXPORT_FORMATS: { value: ExportFormat; label: string; ext: string }[] = [
  { value: "md",   label: "Markdown",    ext: ".md"   },
  { value: "txt",  label: "Plain Text",  ext: ".txt"  },
  { value: "html", label: "HTML",        ext: ".html" },
  { value: "docx", label: "Word (.docx)", ext: ".docx" },
  { value: "xlsx", label: "Excel (.xlsx)", ext: ".xlsx" },
  { value: "pdf",  label: "PDF (print)", ext: ".pdf"  },
];

function download(blob: Blob, filename: string) {
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

function htmlToMarkdown(html: string): string {
  const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });
  return td.turndown(html);
}

const HTML_TEMPLATE = (title: string, body: string) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body{font-family:Georgia,serif;max-width:800px;margin:40px auto;padding:0 24px;line-height:1.7;color:#1a1a1a}
    h1,h2,h3{font-family:system-ui,sans-serif;margin-top:1.5em}
    code{background:#f4f4f4;padding:2px 5px;border-radius:3px;font-size:.9em}
    pre{background:#f4f4f4;padding:16px;border-radius:6px;overflow:auto}
    blockquote{border-left:4px solid #ccc;padding-left:16px;margin-left:0;color:#555}
    table{border-collapse:collapse;width:100%}
    td,th{border:1px solid #ddd;padding:8px 12px;text-align:left}
    th{background:#f0f0f0}
    @media print{body{margin:0}}
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${body}
</body>
</html>`;

function buildDocxParagraphs(markdown: string): Paragraph[] {
  return markdown.split("\n").map((line) => {
    const h1 = line.match(/^# (.+)/);
    const h2 = line.match(/^## (.+)/);
    const h3 = line.match(/^### (.+)/);
    const h4 = line.match(/^#### (.+)/);
    const bullet = line.match(/^[-*+] (.+)/);
    const bold = line.match(/^\*\*(.+)\*\*$/);

    if (h1) return new Paragraph({ text: h1[1], heading: HeadingLevel.HEADING_1 });
    if (h2) return new Paragraph({ text: h2[1], heading: HeadingLevel.HEADING_2 });
    if (h3) return new Paragraph({ text: h3[1], heading: HeadingLevel.HEADING_3 });
    if (h4) return new Paragraph({ text: h4[1], heading: HeadingLevel.HEADING_4 });
    if (bullet) return new Paragraph({ text: bullet[1], bullet: { level: 0 } });
    if (bold) return new Paragraph({ children: [new TextRun({ text: bold[1], bold: true })] });
    if (!line.trim()) return new Paragraph({ text: "" });

    const plain = line.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/`(.+?)`/g, "$1");
    return new Paragraph({ children: [new TextRun(plain)] });
  });
}

export async function exportNote(title: string, content: string, format: ExportFormat) {
  const name = safeFilename(title);

  switch (format) {
    case "md": {
      const markdown = htmlToMarkdown(content);
      download(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), `${name}.md`);
      break;
    }

    case "txt": {
      const plain = htmlToPlainText(content);
      download(new Blob([plain], { type: "text/plain;charset=utf-8" }), `${name}.txt`);
      break;
    }

    case "html": {
      download(
        new Blob([HTML_TEMPLATE(title, content)], { type: "text/html;charset=utf-8" }),
        `${name}.html`,
      );
      break;
    }

    case "docx": {
      const markdown = htmlToMarkdown(content);
      const doc = new Document({
        sections: [{ properties: {}, children: buildDocxParagraphs(markdown) }],
      });
      download(await Packer.toBlob(doc), `${name}.docx`);
      break;
    }

    case "xlsx": {
      const plain = htmlToPlainText(content);
      const rows = plain.split("\n").filter(Boolean).map((line) => [line]);
      const ws = XLSX.utils.aoa_to_sheet([[title, ""], ["", ""], ...rows]);
      ws["!cols"] = [{ wch: 100 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Note");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      download(
        new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `${name}.xlsx`,
      );
      break;
    }

    case "pdf": {
      const win = window.open("", "_blank");
      if (win) {
        win.document.write(HTML_TEMPLATE(title, content));
        win.document.close();
        win.focus();
        setTimeout(() => win.print(), 400);
      }
      break;
    }
  }
}
