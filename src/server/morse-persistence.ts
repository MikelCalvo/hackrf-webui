import type {
  analysisFindings,
  analysisJobs,
  captureTags,
  captureTranscripts,
} from "@/server/db/schema";

/** Version of the stable JSON evidence contract stored in findings/transcript segments. */
export const MORSE_PERSISTENCE_CONTRACT_VERSION = 1;

export type MorseFrontEnd = "cw_carrier" | "am_tone" | "audio_tone";

export interface MorseCharacterEvidence {
  text: string;
  raw: string;
  confidence: number;
  startMs: number;
  endMs: number;
}

export interface MorseCatalogProvenance {
  source: string;
  recordId: string | null;
  version: string | null;
}

export interface MorseEvidenceFile {
  path: string;
  sha256: string;
  byteSize: number | null;
}

export interface MorseAnalysisResult {
  engine: string;
  engineVersion: string;
  frontEnd: MorseFrontEnd;
  tunedFrequencyHz: number | null;
  detectedFrequencyHz: number | null;
  frequencyOffsetHz: number | null;
  toneHz: number | null;
  startedAtMs: number;
  endedAtMs: number;
  dotMs: number | null;
  wordsPerMinute: number | null;
  snrDb: number | null;
  noiseFloorDb: number | null;
  rawMorse: string;
  decodedText: string;
  characters: MorseCharacterEvidence[];
  confidence: number;
  unresolvedCount: number;
  expectedIdentifier: string | null;
  identifierMatch: boolean | null;
  catalog: MorseCatalogProvenance | null;
  evidence: {
    wav: MorseEvidenceFile | null;
    iq: MorseEvidenceFile | null;
  };
}

export interface BuildMorsePersistenceRecordsInput {
  captureSessionId: string;
  analysisJobId: string;
  findingId: string;
  transcriptId: string;
  tagId: (tag: string) => string;
  createdAtMs: number;
  result: MorseAnalysisResult;
}

export interface MorsePersistenceRecords {
  analysisJob: typeof analysisJobs.$inferInsert;
  finding: typeof analysisFindings.$inferInsert;
  transcript: typeof captureTranscripts.$inferInsert;
  tags: Array<typeof captureTags.$inferInsert>;
}

const engineKey = (result: MorseAnalysisResult) => `${result.engine}@${result.engineVersion}`;
const frontEndTag = (frontEnd: MorseFrontEnd) => `morse:front-end:${frontEnd}`;

/**
 * Builds immutable, insert-ready rows only. The caller owns transaction and write policy.
 * `rawMorse` is copied verbatim into both durable evidence locations; no decoder output can replace it.
 */
export function buildMorsePersistenceRecords(input: BuildMorsePersistenceRecordsInput): MorsePersistenceRecords {
  const { result } = input;
  const persistedConfidence = Math.max(0, Math.min(1, Number.isFinite(result.confidence) ? result.confidence : 0));
  const engine = engineKey(result);
  const status = result.decodedText.length === 0
    ? "completed_no_text"
    : result.unresolvedCount > 0 ? "completed_partial" : "completed";
  const findingEvidence = {
    contractVersion: MORSE_PERSISTENCE_CONTRACT_VERSION,
    engine: { name: result.engine, version: result.engineVersion },
    frontEnd: result.frontEnd,
    frequency: {
      tunedHz: result.tunedFrequencyHz,
      detectedHz: result.detectedFrequencyHz,
      offsetHz: result.frequencyOffsetHz,
    },
    toneHz: result.toneHz,
    timing: {
      startMs: result.startedAtMs,
      endMs: result.endedAtMs,
      dotMs: result.dotMs,
      wordsPerMinute: result.wordsPerMinute,
      elements: result.characters,
    },
    signal: { snrDb: result.snrDb, noiseFloorDb: result.noiseFloorDb },
    rawMorse: result.rawMorse,
    decodedText: result.decodedText,
    confidence: {
      overall: persistedConfidence,
      characters: result.characters,
      unresolvedCount: result.unresolvedCount,
    },
    identifier: { expected: result.expectedIdentifier, match: result.identifierMatch },
    catalog: result.catalog,
    evidence: result.evidence,
  };
  const transcriptEvidence = {
    contractVersion: MORSE_PERSISTENCE_CONTRACT_VERSION,
    rawMorse: result.rawMorse,
    confidence: result.confidence,
    unresolvedCount: result.unresolvedCount,
    characters: result.characters,
  };
  const tagNames = ["morse", frontEndTag(result.frontEnd)];
  if (result.decodedText.length === 0) tagNames.push("morse:no-text");
  else if (result.unresolvedCount > 0) tagNames.push("morse:partial");
  if (result.identifierMatch === true) tagNames.push("morse:identifier-match");
  if (result.identifierMatch === false) tagNames.push("morse:identifier-mismatch");
  if (result.catalog) tagNames.push(`morse:catalog:${result.catalog.source}`);

  return {
    analysisJob: {
      id: input.analysisJobId,
      captureSessionId: input.captureSessionId,
      engine,
      status,
      paramsJson: JSON.stringify({
        contractVersion: MORSE_PERSISTENCE_CONTRACT_VERSION,
        frontEnd: result.frontEnd,
        toneHz: result.toneHz,
      }),
      startedAtMs: result.startedAtMs,
      endedAtMs: result.endedAtMs,
      createdAtMs: input.createdAtMs,
    },
    finding: {
      id: input.findingId,
      analysisJobId: input.analysisJobId,
      kind: "morse_decode",
      score: persistedConfidence,
      startMs: result.startedAtMs,
      endMs: result.endedAtMs,
      dataJson: JSON.stringify(findingEvidence),
      createdAtMs: input.createdAtMs,
    },
    transcript: {
      id: input.transcriptId,
      captureSessionId: input.captureSessionId,
      engine,
      language: "morse",
      text: result.decodedText || "?",
      segmentsJson: JSON.stringify(transcriptEvidence),
      createdAtMs: input.createdAtMs,
    },
    tags: tagNames.map((tag) => ({
      id: input.tagId(tag),
      captureSessionId: input.captureSessionId,
      tag,
      source: engine,
      score: persistedConfidence,
      createdAtMs: input.createdAtMs,
    })),
  };
}
