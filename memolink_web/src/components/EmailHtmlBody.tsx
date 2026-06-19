import React, { useRef, useState } from "react";
import type { EmailAttachmentMeta } from "../api/emailApi";
import { buildEmailIframeDocument } from "../utils/emailHtml";

interface EmailHtmlBodyProps {
  bodyHtml: string;
  attachments: EmailAttachmentMeta[];
  gmailMessageId: string;
  emailAccountId?: number | null;
}

export function EmailHtmlBody({ bodyHtml, attachments, gmailMessageId, emailAccountId }: EmailHtmlBodyProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  const doc = buildEmailIframeDocument(bodyHtml, attachments, { gmailMessageId, emailAccountId });

  function handleLoad() {
    const body = iframeRef.current?.contentWindow?.document?.body;
    if (body) setHeight(Math.min(Math.max(body.scrollHeight + 12, 80), 2400));
  }

  return (
    <iframe
      ref={iframeRef}
      srcDoc={doc}
      onLoad={handleLoad}
      // No allow-scripts: even though the body is sanitized server-side, the
      // sandbox blocks any script execution outright as a second layer of defense.
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      title="Email body"
      className="w-full border-0 rounded-xl bg-[var(--ml-bg-surface)]"
      style={{ height }}
    />
  );
}
