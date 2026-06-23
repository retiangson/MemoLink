export interface Cue {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

function parseTimestamp(raw: string): number {
  const cleaned = raw.replace(",", ".");
  const parts = cleaned.split(":");
  let h = 0;
  let m = 0;
  let s = 0;
  if (parts.length === 3) {
    h = parseInt(parts[0], 10) || 0;
    m = parseInt(parts[1], 10) || 0;
    s = parseFloat(parts[2]) || 0;
  } else if (parts.length === 2) {
    m = parseInt(parts[0], 10) || 0;
    s = parseFloat(parts[1]) || 0;
  } else {
    s = parseFloat(parts[0]) || 0;
  }
  return h * 3600 + m * 60 + s;
}

// Hand-rolled cue parser for .srt and .vtt — both formats are simple enough (blank-line
// separated blocks of an optional index, a "start --> end" timestamp line, then text) that
// a small regex/line-based parser is more reliable here than pulling in a library.
export function parseCaptions(text: string, format: "srt" | "vtt"): Cue[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.trim().split(/\n\n+/);
  const cues: Cue[] = [];
  let autoIndex = 1;

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    const firstUpper = lines[0].toUpperCase();
    if (
      format === "vtt" &&
      (firstUpper.startsWith("WEBVTT") ||
        firstUpper.startsWith("NOTE") ||
        firstUpper.startsWith("STYLE") ||
        firstUpper.startsWith("REGION"))
    ) {
      continue;
    }

    let i = 0;
    let cueIndex = autoIndex;
    if (/^\d+$/.test(lines[0])) {
      cueIndex = parseInt(lines[0], 10);
      i = 1;
    }

    const timeLine = lines[i];
    if (!timeLine || !timeLine.includes("-->")) continue;

    const [startRaw, endRawWithSettings] = timeLine.split("-->");
    const endRaw = (endRawWithSettings || "").trim().split(/\s+/)[0] || "";
    const startSeconds = parseTimestamp(startRaw.trim());
    const endSeconds = parseTimestamp(endRaw.trim());

    const textLines = lines.slice(i + 1);
    const cueText = textLines
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!cueText) continue;

    cues.push({ index: cueIndex, startSeconds, endSeconds, text: cueText });
    autoIndex = cueIndex + 1;
  }

  return cues;
}
