import "server-only";

import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { and, eq, inArray } from "drizzle-orm";

import { appDb, sqliteDb } from "@/server/db/client";
import { analysisFindings, analysisJobs, captureSessions, captureTags, captureTranscripts } from "@/server/db/schema";
import { normalizeSigintAudioPayload, type SigintAudioPayload } from "@/server/sigint-audio-payload";
import { projectAssetPath, projectRuntimePath, projectScriptPath } from "@/server/project-paths";
import { captureAbsolutePath } from "@/server/storage";

const execFileAsync = promisify(execFile);

export const AUDIO_ANALYSIS_ENGINE = "sigint-audio-v2";
const AUDIO_ANALYSIS_ENGINE_FAMILY = ["yamnet-litert", "yamnet-vad", AUDIO_ANALYSIS_ENGINE] as const;
const DEFAULT_ASR_MODEL = "Systran/faster-whisper-base";
const DEFAULT_ASR_REVISION = "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66";

const AI_PYTHON_PATH = projectRuntimePath("ai-venv", "bin", "python");
const AI_SCRIPT_PATH = projectScriptPath("ai", "audio_analyzer.py");
const AI_VAD_MODEL_PATH = projectAssetPath("ai", "silero_vad_v6.onnx");
const AI_MODEL_CACHE_PATH = projectRuntimePath("ai-models");

const WORKER_IDLE_MS = 2_500;
const BACKFILL_INTERVAL_MS = 30_000;
const RUNTIME_CHECK_INTERVAL_MS = 30_000;

function configuredAsrModel(): string {
  return process.env.HACKRF_WEBUI_AI_ASR_MODEL?.trim() || DEFAULT_ASR_MODEL;
}

function configuredAsrRevision(): string {
  return process.env.HACKRF_WEBUI_AI_ASR_REVISION?.trim() || DEFAULT_ASR_REVISION;
}

function configuredCpuThreads(): string {
  const parsed = Number.parseInt(process.env.HACKRF_WEBUI_AI_CPU_THREADS ?? "4", 10);
  return String(Number.isFinite(parsed) ? Math.max(1, Math.min(8, parsed)) : 4);
}

function configuredHotwords(): string {
  return process.env.HACKRF_WEBUI_AI_HOTWORDS?.trim() || "";
}

type RuntimeCheckState = {
  ok: boolean;
  checkedAtMs: number;
  errorText: string;
};

type PendingJobRow = {
  id: string;
  captureSessionId: string;
  audioRelativePath: string;
};

type AnalysisWorkerState = {
  running: boolean;
  timer: NodeJS.Timeout | null;
  processing: boolean;
  lastBackfillAtMs: number;
  runtimeCheck: RuntimeCheckState | null;
};

declare global {
  var __hackrfWebUiAnalysisWorker: AnalysisWorkerState | undefined;
}

const workerState: AnalysisWorkerState = global.__hackrfWebUiAnalysisWorker ?? {
  running: false,
  timer: null,
  processing: false,
  lastBackfillAtMs: 0,
  runtimeCheck: null,
};

if (process.env.NODE_ENV !== "production") {
  global.__hackrfWebUiAnalysisWorker = workerState;
}

function parseAnalyzerPayloadText(raw: string): SigintAudioPayload | null {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lastLine = lines.at(-1);
  if (!lastLine) {
    return null;
  }
  try {
    return normalizeSigintAudioPayload(JSON.parse(lastLine));
  } catch {
    return null;
  }
}

function parseGenericPayloadText(raw: string): Record<string, unknown> | null {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lastLine = lines.at(-1);
  if (!lastLine) {
    return null;
  }
  try {
    const value = JSON.parse(lastLine) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function analyzerArguments(): string[] {
  return [
    "--vad-model",
    AI_VAD_MODEL_PATH,
    "--model-cache",
    AI_MODEL_CACHE_PATH,
    "--asr-model",
    configuredAsrModel(),
    "--asr-revision",
    configuredAsrRevision(),
    "--cpu-threads",
    configuredCpuThreads(),
  ];
}

function analysisRuntimePathsReady(): boolean {
  return existsSync(AI_PYTHON_PATH) && existsSync(AI_SCRIPT_PATH) && existsSync(AI_VAD_MODEL_PATH);
}

async function checkAnalysisRuntime(force = false): Promise<RuntimeCheckState> {
  if (!analysisRuntimePathsReady()) {
    return {
      ok: false,
      checkedAtMs: Date.now(),
      errorText: "Local SIGINT Audio v2 runtime is not installed yet.",
    };
  }
  if (!force && workerState.runtimeCheck && Date.now() - workerState.runtimeCheck.checkedAtMs < RUNTIME_CHECK_INTERVAL_MS) {
    return workerState.runtimeCheck;
  }

  try {
    const result = await execFileAsync(
      AI_PYTHON_PATH,
      [AI_SCRIPT_PATH, "--check", ...analyzerArguments()],
      {
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, PYTHONNOUSERSITE: "1" },
      },
    );
    const payload = parseGenericPayloadText(String(result.stdout || ""));
    const nextState = {
      ok: payload?.status === "ok",
      checkedAtMs: Date.now(),
      errorText: payload?.status === "ok" ? "" : String(payload?.error || "AI runtime check failed."),
    };
    workerState.runtimeCheck = nextState;
    return nextState;
  } catch (error) {
    const stdout = typeof error === "object" && error && "stdout" in error ? String(error.stdout ?? "") : "";
    const payload = parseGenericPayloadText(stdout);
    const nextState = {
      ok: false,
      checkedAtMs: Date.now(),
      errorText: String(payload?.error || (error instanceof Error ? error.message : "AI runtime check failed.")),
    };
    workerState.runtimeCheck = nextState;
    return nextState;
  }
}

function scheduleWorker(delayMs = WORKER_IDLE_MS): void {
  if (!workerState.running || workerState.timer) {
    return;
  }
  workerState.timer = setTimeout(() => {
    workerState.timer = null;
    void processWorkerTick();
  }, Math.max(250, delayMs));
}

function lookupBurstEventId(captureSessionId: string): string | null {
  const row = appDb
    .select({ burstEventId: captureSessions.burstEventId })
    .from(captureSessions)
    .where(eq(captureSessions.id, captureSessionId))
    .limit(1)
    .get();
  return row?.burstEventId ?? null;
}

function queueQueuedJob(captureSessionId: string, burstEventIdHint: string | null = null): void {
  const nowMs = Date.now();
  const burstEventId = burstEventIdHint ?? lookupBurstEventId(captureSessionId);
  const existing = appDb
    .select({ id: analysisJobs.id, status: analysisJobs.status, burstEventId: analysisJobs.burstEventId })
    .from(analysisJobs)
    .where(and(eq(analysisJobs.captureSessionId, captureSessionId), eq(analysisJobs.engine, AUDIO_ANALYSIS_ENGINE)))
    .limit(1)
    .get();

  if (existing) {
    if (existing.status === "failed") {
      appDb.update(analysisJobs).set({
        status: "queued",
        burstEventId,
        errorText: null,
        startedAtMs: null,
        endedAtMs: null,
      }).where(eq(analysisJobs.id, existing.id)).run();
    } else if (existing.burstEventId !== burstEventId) {
      appDb.update(analysisJobs).set({ burstEventId }).where(eq(analysisJobs.id, existing.id)).run();
    }
    return;
  }

  appDb.insert(analysisJobs).values({
    id: randomUUID(),
    captureSessionId,
    burstEventId,
    engine: AUDIO_ANALYSIS_ENGINE,
    status: "queued",
    paramsJson: JSON.stringify({
      vadModel: path.basename(AI_VAD_MODEL_PATH),
      asrModel: configuredAsrModel(),
      asrRevision: configuredAsrRevision(),
      cpuThreads: Number(configuredCpuThreads()),
    }),
    errorText: null,
    startedAtMs: null,
    endedAtMs: null,
    createdAtMs: nowMs,
  }).run();
}

function captureHasPreferredAnalysisJob(captureSessionId: string): boolean {
  const row = appDb
    .select({ id: analysisJobs.id, status: analysisJobs.status })
    .from(analysisJobs)
    .where(and(eq(analysisJobs.captureSessionId, captureSessionId), eq(analysisJobs.engine, AUDIO_ANALYSIS_ENGINE)))
    .limit(1)
    .get();
  return Boolean(row && row.status !== "failed");
}

function backfillQueuedJobs(limit = 48): number {
  const rows = sqliteDb.prepare(`
    SELECT cs.id AS captureSessionId
    FROM capture_sessions cs
    INNER JOIN capture_files cf ON cf.capture_session_id = cs.id AND cf.kind = 'audio'
    LEFT JOIN analysis_jobs aj ON aj.capture_session_id = cs.id AND aj.engine = ?
    WHERE cs.module IN ('pmr', 'airband', 'maritime')
      AND (aj.id IS NULL OR aj.status = 'failed')
    ORDER BY cs.started_at_ms DESC
    LIMIT ?
  `).all(AUDIO_ANALYSIS_ENGINE, limit) as Array<{ captureSessionId: string }>;
  for (const row of rows) {
    queueQueuedJob(row.captureSessionId);
  }
  return rows.length;
}

function claimNextJob(): PendingJobRow | null {
  const claim = sqliteDb.transaction(() => {
    const row = sqliteDb.prepare(`
      SELECT aj.id AS id, aj.capture_session_id AS captureSessionId, cf.relative_path AS audioRelativePath
      FROM analysis_jobs aj
      INNER JOIN capture_files cf ON cf.capture_session_id = aj.capture_session_id AND cf.kind = 'audio'
      WHERE aj.engine = ? AND aj.status = 'queued'
      ORDER BY aj.created_at_ms ASC
      LIMIT 1
    `).get(AUDIO_ANALYSIS_ENGINE) as PendingJobRow | undefined;
    if (!row) {
      return null;
    }
    const update = sqliteDb.prepare(`
      UPDATE analysis_jobs
      SET status = 'running', started_at_ms = ?, ended_at_ms = NULL, error_text = NULL
      WHERE id = ? AND status = 'queued'
    `).run(Date.now(), row.id);
    return update.changes === 1 ? row : null;
  }).immediate;
  return claim();
}

async function runAudioAnalyzer(audioPath: string): Promise<SigintAudioPayload> {
  const args = [AI_SCRIPT_PATH, "--wav", audioPath, ...analyzerArguments()];
  const hotwords = configuredHotwords();
  if (hotwords) {
    args.push("--hotwords", hotwords);
  }
  try {
    const result = await execFileAsync(AI_PYTHON_PATH, args, {
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, PYTHONNOUSERSITE: "1" },
    });
    const payload = parseAnalyzerPayloadText(String(result.stdout || ""));
    if (!payload) {
      throw new Error("SIGINT Audio v2 analyzer returned invalid JSON.");
    }
    return payload;
  } catch (error) {
    const stdout = typeof error === "object" && error && "stdout" in error ? String(error.stdout ?? "") : "";
    const payload = parseAnalyzerPayloadText(stdout);
    if (payload) {
      return payload;
    }
    throw error;
  }
}

function writeSuccessfulJob(job: PendingJobRow, payload: SigintAudioPayload): void {
  const nowMs = Date.now();
  const legacyJobs = appDb
    .select({ id: analysisJobs.id })
    .from(analysisJobs)
    .where(and(
      eq(analysisJobs.captureSessionId, job.captureSessionId),
      inArray(analysisJobs.engine, ["yamnet-litert", "yamnet-vad"]),
    ))
    .all()
    .map((row) => row.id);
  const commit = sqliteDb.transaction(() => {
    appDb.update(analysisJobs).set({
      status: payload.status,
      errorText: payload.error || null,
      endedAtMs: nowMs,
    }).where(eq(analysisJobs.id, job.id)).run();
    appDb.delete(analysisFindings).where(eq(analysisFindings.analysisJobId, job.id)).run();
    appDb.delete(captureTags).where(and(
      eq(captureTags.captureSessionId, job.captureSessionId),
      inArray(captureTags.source, [...AUDIO_ANALYSIS_ENGINE_FAMILY]),
    )).run();
    appDb.delete(captureTranscripts).where(and(
      eq(captureTranscripts.captureSessionId, job.captureSessionId),
      inArray(captureTranscripts.engine, [...AUDIO_ANALYSIS_ENGINE_FAMILY, "faster-whisper"]),
    )).run();
    if (legacyJobs.length > 0) {
      appDb.delete(analysisFindings).where(inArray(analysisFindings.analysisJobId, legacyJobs)).run();
      appDb.delete(analysisJobs).where(inArray(analysisJobs.id, legacyJobs)).run();
    }
    const findings: Array<typeof analysisFindings.$inferInsert> = [{
      id: randomUUID(),
      analysisJobId: job.id,
      kind: "classification",
      score: payload.confidence,
      startMs: 0,
      endMs: Math.round(payload.audio_seconds * 1000),
      dataJson: JSON.stringify({
        class: payload.classification,
        subclass: payload.transcript.accepted ? "Transcribed speech" : payload.voice_activity.detected ? "Voice activity" : "No voice",
        confidence: payload.confidence,
        model: `${payload.components.vad.model} + ${payload.components.asr.model}`,
        audioSeconds: payload.audio_seconds,
        rms: payload.rms,
        voiceDetected: payload.voice_activity.detected,
        voiceConfidence: payload.voice_activity.confidence,
        voiceRatio: payload.voice_activity.ratio,
        voiceSeconds: payload.voice_activity.seconds,
        voiceDetector: payload.voice_activity.detector,
        transcriptAccepted: payload.transcript.accepted,
        transcriptConfidence: payload.transcript.confidence,
        transcriptLanguage: payload.transcript.language,
        transcriptLanguageConfidence: payload.transcript.language_probability,
        elapsedMs: payload.elapsed_ms,
        explanation: payload.explanation,
      }),
      createdAtMs: nowMs,
    }];

    for (const region of payload.voice_activity.speech_regions) {
      findings.push({
        id: randomUUID(),
        analysisJobId: job.id,
        kind: "voice_region",
        score: region.mean_probability,
        startMs: region.start_ms,
        endMs: region.end_ms,
        dataJson: JSON.stringify({ detector: payload.voice_activity.detector }),
        createdAtMs: nowMs,
      });
    }
    appDb.insert(analysisFindings).values(findings).run();

    appDb.insert(captureTags).values({
      id: randomUUID(),
      captureSessionId: job.captureSessionId,
      tag: payload.classification,
      source: AUDIO_ANALYSIS_ENGINE,
      score: payload.confidence,
      createdAtMs: nowMs,
    }).run();
    if (payload.voice_activity.detected) {
      appDb.insert(captureTags).values({
        id: randomUUID(),
        captureSessionId: job.captureSessionId,
        tag: "voice",
        source: AUDIO_ANALYSIS_ENGINE,
        score: payload.voice_activity.confidence,
        createdAtMs: nowMs,
      }).run();
    }
    if (payload.transcript.accepted && payload.transcript.text) {
      appDb.insert(captureTranscripts).values({
        id: randomUUID(),
        captureSessionId: job.captureSessionId,
        engine: "faster-whisper",
        language: payload.transcript.language || null,
        text: payload.transcript.text,
        segmentsJson: JSON.stringify({
          model: payload.components.asr.model,
          confidence: payload.transcript.confidence,
          languageProbability: payload.transcript.language_probability,
          meanAvgLogprob: payload.transcript.mean_avg_logprob,
          maxNoSpeechProb: payload.transcript.max_no_speech_prob,
          segments: payload.transcript.segments,
        }),
        createdAtMs: nowMs,
      }).run();
      appDb.insert(captureTags).values({
        id: randomUUID(),
        captureSessionId: job.captureSessionId,
        tag: "transcribed",
        source: AUDIO_ANALYSIS_ENGINE,
        score: payload.transcript.confidence,
        createdAtMs: nowMs,
      }).run();
    }
  }).immediate;
  commit();
}

function writeFailedJob(jobId: string, message: string): void {
  appDb.update(analysisJobs).set({
    status: "failed",
    errorText: message.slice(0, 500),
    endedAtMs: Date.now(),
  }).where(eq(analysisJobs.id, jobId)).run();
}

async function processWorkerTick(): Promise<void> {
  if (!workerState.running || workerState.processing) {
    return;
  }
  workerState.processing = true;
  try {
    if (Date.now() - workerState.lastBackfillAtMs >= BACKFILL_INTERVAL_MS) {
      backfillQueuedJobs();
      workerState.lastBackfillAtMs = Date.now();
    }
    const runtime = await checkAnalysisRuntime();
    if (!runtime.ok) {
      return;
    }
    const job = claimNextJob();
    if (!job) {
      return;
    }
    const audioAbsolutePath = captureAbsolutePath(job.audioRelativePath);
    if (!audioAbsolutePath || !existsSync(audioAbsolutePath)) {
      writeFailedJob(job.id, "audio capture missing");
      return;
    }
    try {
      const payload = await runAudioAnalyzer(audioAbsolutePath);
      if (payload.status === "completed") {
        writeSuccessfulJob(job, payload);
      } else {
        writeFailedJob(job.id, payload.error || "analysis failed");
      }
    } catch (error) {
      writeFailedJob(job.id, error instanceof Error ? error.message : "analysis failed");
    }
  } catch (error) {
    console.error("[analysis-worker] Worker tick error:", error);
  } finally {
    workerState.processing = false;
    scheduleWorker();
  }
}

export function ensureAnalysisWorkerStarted(): void {
  if (workerState.running) {
    scheduleWorker(150);
    return;
  }
  workerState.running = true;
  scheduleWorker(500);
}

export function queueCaptureAnalysisJob(captureSessionId: string, burstEventId: string | null = null): void {
  queueQueuedJob(captureSessionId, burstEventId);
  ensureAnalysisWorkerStarted();
}

export function ensureCaptureAnalysisUpToDate(captureSessionId: string): void {
  if (captureHasPreferredAnalysisJob(captureSessionId)) {
    ensureAnalysisWorkerStarted();
    return;
  }
  queueQueuedJob(captureSessionId);
  ensureAnalysisWorkerStarted();
}

export function warmAnalysisBackfill(): void {
  backfillQueuedJobs();
  ensureAnalysisWorkerStarted();
}
