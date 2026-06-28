import { readFile, writeFile } from "node:fs/promises";
import { initMobiFile } from "@lingo-reader/mobi-parser";

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  throw new Error("Usage: node extract_mobi.mjs <input.mobi> <output.html>");
}

const bytes = new Uint8Array(await readFile(inputPath));
const mobi = await initMobiFile(bytes);
try {
  const chapters = mobi.getSpine().map((chapter) => mobi.loadChapter(chapter.id)?.html ?? "");
  await writeFile(outputPath, chapters.join("\n"), "utf8");
} finally {
  mobi.destroy();
}
