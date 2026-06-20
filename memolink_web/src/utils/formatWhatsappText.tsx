import React from "react";

const TOKEN_RE = /(\*[^*\n]+\*)|(_[^_\n]+_)|(~[^~\n]+~)|(https?:\/\/[^\s]+)/g;

// Renders WhatsApp-style bold, italic, and strikethrough markup and linkifies bare URLs.
// Returns React nodes (never raw HTML) since message bodies are untrusted contact-supplied content.
export function formatWhatsappText(body: string): React.ReactNode {
  if (!body) return body;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(body)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(body.slice(lastIndex, match.index));
    }
    const [whole, bold, italic, strike, url] = match;
    if (bold) {
      nodes.push(<strong key={key++}>{bold.slice(1, -1)}</strong>);
    } else if (italic) {
      nodes.push(<em key={key++}>{italic.slice(1, -1)}</em>);
    } else if (strike) {
      nodes.push(<s key={key++}>{strike.slice(1, -1)}</s>);
    } else if (url) {
      nodes.push(
        <a key={key++} href={url} target="_blank" rel="noopener noreferrer" className="underline hover:text-green-300">
          {url}
        </a>
      );
    } else {
      nodes.push(whole);
    }
    lastIndex = match.index + whole.length;
  }
  if (lastIndex < body.length) {
    nodes.push(body.slice(lastIndex));
  }
  return nodes;
}
