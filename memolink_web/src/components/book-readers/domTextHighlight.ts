import type { HighlightAnchor } from "./format";
import { highlightColorMark } from "./highlightColors";

export interface CapturedSelection {
  x: number;
  y: number;
  start: number;
  end: number;
}

export interface PersistedHighlight {
  id: number;
  start: number;
  end: number;
  color: string;
}

const PERSIST_CLASS = "ml-persist-hl";
const PULSE_CLASS = "ml-hl-pulse";
const SPEECH_HIGHLIGHT_NAME = "ml-current-speech";
// Walks all text nodes inside container to convert a (node, offsetInNode) selection
// boundary into an absolute char offset into container.textContent — used by readers
// (slides/text/mobi chapters) that have no existing text-mapping infra (unlike PDF/EPUB)
// since their content is static extracted/rendered HTML.
export function offsetOfNodeInContainer(container: HTMLElement, node: Node, offsetInNode: number): number | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let total = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n === node) return total + offsetInNode;
    total += (n.nodeValue || "").length;
  }
  return null;
}

// Reads the current window selection (if any, and if it's inside container) and converts
// it into an absolute char-offset range plus a screen position for the highlight button.
export function captureSelectionInContainer(container: HTMLElement): CapturedSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !container.contains(sel.anchorNode)) {
    return null;
  }
  const range = sel.getRangeAt(0);
  const start = offsetOfNodeInContainer(container, range.startContainer, range.startOffset);
  const end = offsetOfNodeInContainer(container, range.endContainer, range.endOffset);
  if (start == null || end == null || end <= start) return null;
  const rect = range.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top, start, end };
}

// Finds the text-node segments inside container that fall within [start, end) of
// container's full concatenated text — a match can cross multiple block elements, so this
// returns one segment per text node touched rather than a single Range.
function findSegments(container: HTMLElement, start: number, end: number): { node: Text; start: number; end: number }[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let total = 0;
  const segments: { node: Text; start: number; end: number }[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const tn = n as Text;
    const len = (tn.nodeValue || "").length;
    const segStart = total;
    const segEnd = total + len;
    total += len;
    if (segEnd <= start || segStart >= end) continue;
    segments.push({ node: tn, start: Math.max(0, start - segStart), end: Math.min(len, end - segStart) });
  }
  return segments;
}

function wrapSegments(
  segments: { node: Text; start: number; end: number }[],
  decorate: (mark: HTMLElement) => void,
): HTMLElement[] {
  const marks: HTMLElement[] = [];
  segments.forEach(({ node, start, end }) => {
    if (end <= start) return;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const mark = document.createElement("mark");
    decorate(mark);
    try {
      range.surroundContents(mark);
      marks.push(mark);
    } catch {
      // DOM structure prevented wrapping this segment; skip it
    }
  });
  return marks;
}

function unwrapMarks(marks: HTMLElement[]): void {
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

// Temporarily wraps the matching text-node segments in <mark> elements, then unwraps them.
// Used only as a fallback when no persistent mark exists yet for the jumped-to highlight
// (e.g. it hasn't been applied to the page/chapter currently rendered).
export function flashTextRange(container: HTMLElement, anchor: Pick<HighlightAnchor, "start" | "end">, durationMs = 2500): void {
  const marks = wrapSegments(findSegments(container, anchor.start, anchor.end), (mark) => {
    mark.style.backgroundColor = "rgba(250,204,21,0.6)";
    mark.style.color = "inherit";
  });
  marks[0]?.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => unwrapMarks(marks), durationMs);
}

// Removes every persistent highlight mark previously applied to container (called before
// re-applying, since offsets are only valid against the unwrapped text).
export function clearPersistentMarks(container: HTMLElement): void {
  unwrapMarks(Array.from(container.querySelectorAll<HTMLElement>(`mark.${PERSIST_CLASS}`)));
}

// Renders every saved highlight for the currently displayed page/chapter as a permanent,
// colored <mark> — this is what makes highlights visible again on revisit, not just at the
// moment they're created. Safe to call repeatedly (clears old marks first); wrapping never
// changes container.textContent length, so re-deriving offsets from the same source text is
// stable across repeated calls.
export function applyPersistentMarks(container: HTMLElement, highlights: PersistedHighlight[]): void {
  clearPersistentMarks(container);
  const sorted = [...highlights].sort((a, b) => a.start - b.start);
  for (const h of sorted) {
    wrapSegments(findSegments(container, h.start, h.end), (mark) => {
      mark.className = PERSIST_CLASS;
      mark.dataset.hlId = String(h.id);
      mark.dataset.hlStart = String(h.start);
      mark.dataset.hlEnd = String(h.end);
      mark.style.backgroundColor = highlightColorMark(h.color);
      mark.style.color = "inherit";
      mark.style.borderRadius = "2px";
    });
  }
}

// Jump-arrival from a Note double-click: if the target range is already shown as a
// persistent mark (the normal case once applyPersistentMarks has run for this page), pulse
// it in place rather than wrapping a second, temporary <mark> over it. Returns true if a
// persistent mark was found and pulsed.
export function pulsePersistentMark(container: HTMLElement, start: number, end: number): boolean {
  const marks = Array.from(
    container.querySelectorAll<HTMLElement>(`mark.${PERSIST_CLASS}[data-hl-start="${start}"][data-hl-end="${end}"]`),
  );
  if (marks.length === 0) return false;
  marks.forEach((m) => m.classList.add(PULSE_CLASS));
  marks[0].scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => marks.forEach((m) => m.classList.remove(PULSE_CLASS)), 1600);
  return true;
}

// Convenience wrapper for jump-arrival call sites: pulses the existing persistent mark if
// present, otherwise falls back to a temporary flash (e.g. highlight list hasn't loaded yet).
export function flashOrPulseRange(container: HTMLElement, anchor: Pick<HighlightAnchor, "start" | "end">): void {
  if (pulsePersistentMark(container, anchor.start, anchor.end)) return;
  flashTextRange(container, anchor);
}

export function applySpeechHighlight(
  container: HTMLElement,
  range: { start: number; end: number } | null,
): void {
  const doc = container.ownerDocument;
  const ownerWindow = doc.defaultView;
  const css = (ownerWindow?.CSS as any)?.highlights;
  if (!css) return;
  css.delete(SPEECH_HIGHLIGHT_NAME);
  if (!range || range.end <= range.start) return;
  const ranges = findSegments(container, range.start, range.end).map((segment) => {
    const domRange = doc.createRange();
    domRange.setStart(segment.node, segment.start);
    domRange.setEnd(segment.node, segment.end);
    return domRange;
  });
  const HighlightCtor = (ownerWindow as any)?.Highlight;
  if (!HighlightCtor || ranges.length === 0) return;
  css.set(SPEECH_HIGHLIGHT_NAME, new HighlightCtor(...ranges));
  let style = doc.getElementById("ml-current-speech-style") as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = "ml-current-speech-style";
    style.textContent = `::highlight(${SPEECH_HIGHLIGHT_NAME}) { background-color: rgba(99,102,241,0.45); }`;
    doc.head?.appendChild(style);
  }
}
