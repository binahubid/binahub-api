import { NextRequest } from "next/server";
import { consultantFailure, consultantHeaders, ConsultantError, requireConsultant } from "@/lib/consultant/http";
import { consultantTutorials } from "@/lib/consultant/materials";

export const runtime = "nodejs";
const chunkSize = 2 * 1024 * 1024;
const maxFileSize = 50 * 1024 * 1024;

function boundedRange(value: string) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const length = Number(match[2]);
    return Number.isSafeInteger(length) && length > 0 ? `bytes=-${Math.min(length, chunkSize)}` : null;
  }
  const start = Number(match[1]), end = match[2] ? Number(match[2]) : start + chunkSize - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= maxFileSize || end < start) return null;
  return `bytes=${start}-${Math.min(end, start + chunkSize - 1)}`;
}

async function media(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireConsultant(request);
    const { id } = await context.params;
    const episode = consultantTutorials.find((row) => row.id === id);
    const version = new URL(request.url).searchParams.get("version") ?? "id";
    if (!episode) throw new ConsultantError("CONSULTANT_NOT_FOUND", 404);
    const video = version === "id" ? episode :
      version === "en" || version === "mobile" ? episode.versions[version] : undefined;
    if (!video) throw new ConsultantError("CONSULTANT_NOT_FOUND", 404);
    const requestedRange = request.headers.get("Range");
    const range = request.method === "HEAD" ? "bytes=0-0" : requestedRange ? boundedRange(requestedRange) : undefined;
    if (range === null) return new Response(null, { status: 416, headers: consultantHeaders });
    const url = new URL("https://drive.usercontent.google.com/download");
    url.searchParams.set("id", video.drive.fileId);
    url.searchParams.set("export", "download");
    url.searchParams.set("confirm", "t");
    const drive: { fileId: string; resourceKey?: string } = video.drive;
    if (drive.resourceKey) url.searchParams.set("resourcekey", drive.resourceKey);
    const upstream = await fetch(url, {
      headers: { Accept: "video/mp4", ...(range ? { Range: range } : {}) },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]),
      cache: "no-store",
      redirect: "error",
    });
    if (upstream.status === 416) {
      await upstream.body?.cancel();
      return new Response(null, { status: 416, headers: consultantHeaders });
    }
    const contentRange = upstream.headers.get("Content-Range");
    const rangeMatch = contentRange && /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
    const length = Number(upstream.headers.get("Content-Length"));
    const total = rangeMatch ? Number(rangeMatch[3]) : length;
    const validPartial = rangeMatch && Number(rangeMatch[2]) < total
      && Number(rangeMatch[2]) - Number(rangeMatch[1]) + 1 === length
      && length > 0 && length <= chunkSize;
    if (![200, 206].includes(upstream.status) || !upstream.headers.get("Content-Type")?.startsWith("video/mp4")
      || !Number.isSafeInteger(total) || total <= 0 || total > maxFileSize || !upstream.body
      || (range && upstream.status !== 206) || (upstream.status === 206 && !validPartial)) {
      await upstream.body?.cancel();
      throw new ConsultantError("CONSULTANT_UNAVAILABLE", 503);
    }
    const headers = new Headers({ ...consultantHeaders, "Content-Type": "video/mp4", "Accept-Ranges": "bytes",
      "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin", Vary: "Cookie, Authorization" });
    if (request.method === "HEAD") {
      headers.set("Content-Length", String(total));
      await upstream.body.cancel();
      return new Response(null, { headers });
    }
    if (contentRange && rangeMatch) headers.set("Content-Range", contentRange);
    if (Number.isSafeInteger(length) && length > 0) headers.set("Content-Length", String(length));
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) { return consultantFailure(error); }
}

export const GET = media;
export const HEAD = media;
