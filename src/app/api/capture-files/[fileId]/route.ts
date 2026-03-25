import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { eq } from "drizzle-orm";

import { appDb } from "@/server/db/client";
import { captureFiles } from "@/server/db/schema";
import { captureAbsolutePath } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function contentTypeForFile(format: string): string {
  switch (format.toLowerCase()) {
    case "wav":
      return "audio/wav";
    case "cs8":
      return "application/octet-stream";
    default:
      return "application/octet-stream";
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  const { fileId } = await context.params;
  const trimmedId = fileId.trim();
  if (!trimmedId) {
    return Response.json({ message: "Missing file id." }, { status: 400 });
  }

  const file = appDb
    .select()
    .from(captureFiles)
    .where(eq(captureFiles.id, trimmedId))
    .limit(1)
    .get();

  if (!file) {
    return Response.json({ message: "Capture file not found." }, { status: 404 });
  }

  const absolutePath = captureAbsolutePath(file.relativePath);
  if (!absolutePath || !existsSync(absolutePath)) {
    return Response.json({ message: "Capture file is missing on disk." }, { status: 404 });
  }

  const fileName = path.basename(absolutePath);
  return new Response(Readable.toWeb(createReadStream(absolutePath)) as ReadableStream<Uint8Array>, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": contentTypeForFile(file.format),
      "Content-Disposition": file.kind === "audio"
        ? `inline; filename="${fileName}"`
        : `attachment; filename="${fileName}"`,
    },
  });
}
