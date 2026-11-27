import "server-only";
import { createHash } from "node:crypto";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { createCanvas } from "@napi-rs/canvas";

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

async function openMaterial(data: Uint8Array) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return { task: getDocument({ data, useWasm: false, enableXfa: false, useSystemFonts: false, maxImageSize: 24_000_000, verbosity: 0 }) };
}

async function extractPages(data: Uint8Array) {
  const { task } = await openMaterial(data);
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
    const page = await destinationPage(document, item.dest);
    if (page && !titles.has(page)) titles.set(page, item.title);
  }
  return titles;
}

async function destinationPage(document: PDFDocumentProxy, dest: string | unknown[] | null | undefined) {
  const target = typeof dest === "string" ? await document.getDestination(dest).catch(() => null) : dest;
  if (!target?.length) return null;
  const ref = target[0];
  if (typeof ref !== "number" && (!ref || typeof ref !== "object" || !("num" in ref) || !("gen" in ref))) return null;
  const index = typeof ref === "number" ? ref : await document.getPageIndex(ref as { num: number; gen: number }).catch(() => -1);
  return index >= 0 && index < document.numPages ? index + 1 : null;
}

type PreviewLink = {
  left: number; top: number; width: number; height: number; page?: number; url?: string;
};

let visualCache: { revision: string; pages: Map<number, ReturnType<typeof renderMaterialPage>> } | undefined;

export function consultantPreviewPage(bytes: Uint8Array, page: number) {
  const revision = createHash("sha256").update(bytes).digest("hex");
  if (visualCache?.revision !== revision) visualCache = { revision, pages: new Map() };
  const pages = visualCache.pages;
  const previous = pages.get(page);
  if (previous) return previous;
  if (pages.size >= 8) {
    const oldest = pages.keys().next().value;
    if (oldest !== undefined) pages.delete(oldest);
  }
  const pending = renderMaterialPage(bytes, page, revision).catch(error => {
    if (pages.get(page) === pending) pages.delete(page);
    throw error;
  });
  pages.set(page, pending);
  return pending;
}

async function renderMaterialPage(data: Uint8Array, number: number, revision: string) {
  const { task } = await openMaterial(data);
  try {
    const document = await task.promise;
    if (number > document.numPages) return null;
    const page = await document.getPage(number);
    const unit = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(1560 / unit.width, 2200 / unit.height) });
    const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height);
    const canvas = createCanvas(width, height);

    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport, background: "#fff" }).promise;
    const [image, outline, annotations, content] = await Promise.all([
      canvas.encode("webp", 92),
      number === 1 ? pageTitles(document) : Promise.resolve(new Map<number, string>()),
      page.getAnnotations({ intent: "display" }),
      page.getTextContent(),
    ]);
    const links = await Promise.all(annotations.map(async (annotation): Promise<PreviewLink | null> => {
      if (annotation.subtype !== "Link" || !Array.isArray(annotation.rect)) return null;
      const [left, bottom, right, top] = annotation.rect as number[];
      const [a, b, c, d, e, f] = viewport.transform;
      const x1 = a * left + c * bottom + e, y1 = b * left + d * bottom + f;
      const x2 = a * right + c * top + e, y2 = b * right + d * top + f;
      const box = {
        left: Math.min(x1, x2) / width,
        top: Math.min(y1, y2) / height,
        width: Math.abs(x2 - x1) / width,
        height: Math.abs(y2 - y1) / height,
      };
      const page = await destinationPage(document, annotation.dest);
      if (page) return { ...box, page };
      if (typeof annotation.url === "string" && /^(https:\/\/|mailto:|tel:)/i.test(annotation.url)) {
        return { ...box, url: annotation.url };
      }
      return null;
    }));
    const text = content.items.flatMap(item => "str" in item ? [item.str] : []).join(" ");
    return {
      revision, total: document.numPages,
      chapters: Array.from(outline, ([number, title]) => ({ number, title })),
      page: { number, width, height, image: "data:image/webp;base64," + image.toString("base64"),
        links: links.filter(link => link !== null), text },
    };
  } finally {
    await task.destroy();
  }
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
