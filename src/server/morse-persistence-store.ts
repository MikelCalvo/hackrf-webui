import "server-only";

import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";

import { eq } from "drizzle-orm";

import { appDb, sqliteDb } from "@/server/db/client";
import { analysisFindings, analysisJobs, captureFiles, captureTags, captureTranscripts } from "@/server/db/schema";
import type { MorseAnalysisResult, MorseEvidenceFile, MorsePersistenceRecords } from "@/server/morse-persistence";
import { captureAbsolutePath } from "@/server/storage";

async function sha256File(absolutePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(absolutePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function resolveEvidenceFile(file: typeof captureFiles.$inferSelect): Promise<MorseEvidenceFile> {
  const absolutePath = captureAbsolutePath(file.relativePath);
  if (!absolutePath) throw new Error(`Capture evidence path is invalid: ${file.relativePath}`);
  const stats = statSync(absolutePath);
  const sha256 = file.sha256 || await sha256File(absolutePath);
  const byteSize = file.byteSize ?? stats.size;
  if (file.sha256 !== sha256 || file.byteSize !== byteSize) {
    appDb
      .update(captureFiles)
      .set({ sha256, byteSize })
      .where(eq(captureFiles.id, file.id))
      .run();
  }
  return { path: file.relativePath, sha256, byteSize };
}

/** Resolves the immutable primary files recorded for this exact capture session. */
export async function bindMorseResultToCaptureEvidence(
  captureSessionId: string,
  result: MorseAnalysisResult,
): Promise<MorseAnalysisResult> {
  const files = appDb
    .select()
    .from(captureFiles)
    .where(eq(captureFiles.captureSessionId, captureSessionId))
    .all();
  const wav = files.find((file) => file.kind === "audio" && file.format === "wav") ?? null;
  const iq = files.find((file) => file.kind === "raw_iq") ?? null;
  if (!wav && !iq) throw new Error(`MORSE capture ${captureSessionId} has no primary WAV/IQ evidence.`);
  return {
    ...result,
    evidence: {
      wav: wav ? await resolveEvidenceFile(wav) : null,
      iq: iq ? await resolveEvidenceFile(iq) : null,
    },
  };
}

/** Atomically persists a completed MORSE contract after its capture session exists. */
export function persistMorsePersistenceRecords(records: MorsePersistenceRecords): void {
  const transaction = sqliteDb.transaction(() => {
    appDb.insert(analysisJobs).values(records.analysisJob).run();
    appDb.insert(analysisFindings).values(records.finding).run();
    appDb.insert(captureTranscripts).values(records.transcript).run();
    if (records.tags.length > 0) appDb.insert(captureTags).values(records.tags).run();
  });
  transaction();
}