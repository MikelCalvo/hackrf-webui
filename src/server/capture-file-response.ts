import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";

type CaptureFileResponseOptions = {
  contentType: string;
  disposition: string;
};

type ParsedRange = { start: number; end: number } | "invalid" | null;

function parseRangeHeader(value: string | null, size: number): ParsedRange {
  if (!value) return null;
  if (!value.startsWith("bytes=") || value.includes(",")) return "invalid";

  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || size <= 0) return "invalid";
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return "invalid";

  if (!rawStart) {
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return "invalid";
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number.parseInt(rawStart, 10);
  const requestedEnd = rawEnd ? Number.parseInt(rawEnd, 10) : size - 1;
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || requestedEnd < start
    || start >= size
  ) {
    return "invalid";
  }

  return { start, end: Math.min(requestedEnd, size - 1) };
}

export function buildCaptureFileResponse(
  request: Request,
  payload: Uint8Array,
  options: CaptureFileResponseOptions,
): Response {
  const bytes = new Uint8Array(payload);
  const size = bytes.byteLength;
  const range = parseRangeHeader(request.headers.get("range"), size);
  const baseHeaders = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Disposition": options.disposition,
    "Content-Type": options.contentType,
  };

  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, "Content-Range": `bytes */${size}` },
    });
  }

  if (range) {
    const body = bytes.slice(range.start, range.end + 1);
    return new Response(new Blob([body]), {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Length": String(body.byteLength),
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
      },
    });
  }

  return new Response(new Blob([bytes]), {
    headers: { ...baseHeaders, "Content-Length": String(size) },
  });
}

export function buildCaptureFileStreamResponse(
  request: Request,
  absolutePath: string,
  options: CaptureFileResponseOptions,
): Response {
  const size = statSync(absolutePath).size;
  const range = parseRangeHeader(request.headers.get("range"), size);
  const baseHeaders = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Disposition": options.disposition,
    "Content-Type": options.contentType,
  };

  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, "Content-Range": `bytes */${size}` },
    });
  }

  const stream = range
    ? createReadStream(absolutePath, { start: range.start, end: range.end })
    : createReadStream(absolutePath);
  const contentLength = range ? range.end - range.start + 1 : size;

  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status: range ? 206 : 200,
    headers: {
      ...baseHeaders,
      "Content-Length": String(contentLength),
      ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${size}` } : {}),
    },
  });
}
