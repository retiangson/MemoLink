import { getAttachmentDownloadUrl, type EmailAttachmentMeta } from "../api/emailApi";
import { readerThemeColors, type ReaderColorMode } from "../components/book-readers/format";

function rewriteCidImages(
  bodyHtml: string,
  attachments: EmailAttachmentMeta[],
  opts: { gmailMessageId: string; emailAccountId?: number | null }
): string {
  return bodyHtml.replace(/(src=["'])cid:([^"']+)(["'])/gi, (match, prefix, cid, suffix) => {
    const attachment = attachments.find((a) => a.content_id === cid);
    if (!attachment) return match;
    const url = getAttachmentDownloadUrl({
      gmailMessageId: opts.gmailMessageId,
      attachmentId: attachment.attachment_id,
      filename: attachment.filename,
      emailAccountId: opts.emailAccountId,
      inline: true,
    });
    return `${prefix}${url}${suffix}`;
  });
}

// Wraps a sanitized email body into a standalone HTML document for rendering inside
// a sandboxed iframe - keeps the email's own styles/markup isolated from the app's CSS.
export function buildEmailIframeDocument(
  bodyHtml: string,
  attachments: EmailAttachmentMeta[],
  opts: { gmailMessageId: string; emailAccountId?: number | null; colorMode?: ReaderColorMode }
): string {
  const rewritten = attachments.length ? rewriteCidImages(bodyHtml, attachments, opts) : bodyHtml;
  const colors = readerThemeColors(opts.colorMode ?? "dark");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>
    html, body { margin: 0; padding: 0; background: ${colors.background}; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 13px; line-height: 1.5; color: ${colors.foreground}; padding: 2px 4px; word-wrap: break-word; overflow-wrap: anywhere; }
    img { max-width: 100%; height: auto; }
    a { color: ${colors.link}; }
    table { max-width: 100%; }
  </style></head><body>${rewritten}</body></html>`;
}
