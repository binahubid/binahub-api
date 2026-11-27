import "server-only";
import { createHash } from "node:crypto";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

type Block = { kind: "heading" | "paragraph" | "bullet"; text: string };
type ReadingPage = { page: number; title: string; blocks: Block[] };

let cached: { hash: string; reading: Promise<ReadingPage[]> } | undefined;

export function consultantReadingPages(bytes: Uint8Array) {
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (cached?.hash === hash) return cached.reading;
  const reading = extractPages(bytes).catch(error => {
    if (cached?.hash === hash) cached = undefined;
    throw error;
  });
  cached = { hash, reading };
  return reading;
}

async function extractPages(data: Uint8Array) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data, useWasm: false, enableXfa: false, useSystemFonts: false, verbosity: 0 });
  try {
    const document = await task.promise;
    const titles = await pageTitles(document);
    const pages: ReadingPage[] = [];
    for (let page = 1; page <= document.numPages; page++) {
      const source = await document.getPage(page);
      const content = await source.getTextContent();
      const items = content.items.filter((item): item is TextItem => "str" in item && !!item.str.trim());
      const blocks = readingBlocks(items);
      const title = titles.get(page) || blocks.find(block => block.kind === "heading")?.text || "";
      pages.push({ page, title, blocks });
      source.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

async function pageTitles(document: PDFDocumentProxy) {
  const titles = new Map<number, string>();
  const outline = await document.getOutline().catch(() => null);
  const items = [...(outline ?? [])];
  for (const item of items) {
    items.push(...item.items);
    const destination = typeof item.dest === "string"
      ? await document.getDestination(item.dest).catch(() => null)
      : item.dest;
    if (!destination?.length) continue;
    const ref = destination[0];
    const index = typeof ref === "number" ? ref : await document.getPageIndex(ref).catch(() => -1);
    if (index >= 0 && index < document.numPages && !titles.has(index + 1)) titles.set(index + 1, item.title);
  }
  return titles;
}

function readingBlocks(items: TextItem[]): Block[] {
  const rows: { text: string; x: number; y: number; size: number; right: number }[] = [];
  for (const item of items) {
    const text = item.str.trim();
    const [, , , , x, y] = item.transform;
    if (y < 37 || text === "Panduan Product Knowledge BinaHub" || text === "Kembali ke indeks program") continue;
    const prev = rows.at(-1);
    if (prev && Math.abs(prev.y - y) < 1.2 && x >= prev.right - 1 && x - prev.right < 28) {
      prev.text += " " + text;
      prev.right = x + item.width;
    } else {
      rows.push({ text, x, y, size: item.height, right: x + item.width });
    }
  }

  const blocks: Block[] = [];
  let previous: (typeof rows)[number] | undefined;
  for (const row of rows) {
    const last = blocks.at(-1);
    const kind = row.text.startsWith("•") ? "bullet"
      : row.size >= 12 || /^Sasaran pembelajaran$|^Komponen pelaksanaan$|^Hasil yang dibawa peserta$|^Durasi$|^Kapasitas$/i.test(row.text) ? "heading"
      : "paragraph";
    const line = row.text.replace(/^•\s*/, "");
    const advance = previous ? previous.y - row.y : 0;
    if (kind === "paragraph" && last && previous && advance > 0 && advance <= row.size * 1.7
      && Math.abs(row.x - previous.x) <= (last.kind === "bullet" ? 20 : 3)
      && Math.abs(row.size - previous.size) < 1.3) {
      last.text += " " + line;
    } else {
      blocks.push({ kind, text: line });
    }
    previous = row;
  }
  return blocks;
}
