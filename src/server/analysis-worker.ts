import "server-only";

import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { and, eq, inArray } from "drizzle-orm";

import type { AiSettings } from "@/lib/settings";
import { resolveEffectiveAiSettings, resolveSavedAiSettings, runtimeAiDisableReason, type AnalysisWorkerStatus } from "@/lib/settings-runtime";
import { appDb, sqliteDb } from "@/server/db/client";
import { analysisFindings, analysisJobs, captureSessions, captureTags, captureTranscripts } from "@/server/db/schema";
import { normalizeSigintAudioPayload, type SigintAudioPayload } from "@/server/sigint-audio-payload";
import { projectAssetPath, projectRuntimePath, projectScriptPath } from "@/server/project-paths";
import {
  claimNextEligibleAnalysisJob,
  countAnalysisJobs,
  queueAnalysisJobIfEnabled,
  queueHistoricalAnalysisJobs,
  writeAiQueuePolicy,
} from "@/server/settings-policy";
import { createSettingsStore } from "@/server/settings-store";
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
const RUNTIME_CHECK_INTERVAL_MS = 30_000;
const settingsStore = createSettingsStore(sqliteDb);

function configuredAsrModel(): string {
  return process.env.HACKRF_WEBUI_AI_ASR_MODEL?.trim() || DEFAULT_ASR_MODEL;
}

function configuredAsrRevision(): string {
  return process.env.HACKRF_WEBUI_AI_ASR_REVISION?.trim() || DEFAULT_ASR_REVISION;
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
  runtimeCheck: RuntimeCheckState | null;
  currentJob: { id: string; captureSessionId: string } | null;
  lastResult: { status: "completed" | "failed"; endedAtMs: number; errorText: string | null } | null;
};

declare global {
  var __hackrfWebUiAnalysisWorker: AnalysisWorkerState | undefined;
}

const workerState: AnalysisWorkerState = global.__hackrfWebUiAnalysisWorker ?? {
  running: false,
  timer: null,
  processing: false,
  runtimeCheck: null,
  currentJob: null,
  lastResult: null,
};

if (process.env.NODE_ENV !== "production") {
  global.__hackrfWebUiAnalysisWorker = workerState;
}

function readAiSettings(): AiSettings {
  const snapshot = settingsStore.getSnapshot();
  const saved = resolveSavedAiSettings(snapshot.values.ai, snapshot.sections.ai.source, process.env);
  return resolveEffectiveAiSettings(saved, process.env);
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

function analyzerArguments(aiSettings: AiSettings): string[] {
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
    String(aiSettings.cpuThreads),
  ];
}

function analysisRuntimePathsReady(): boolean {
  return existsSync(AI_PYTHON_PATH) && existsSync(AI_SCRIPT_PATH) && existsSync(AI_VAD_MODEL_PATH);
}

async function checkAnalysisRuntime(aiSettings: AiSettings, force = false): Promise<RuntimeCheckState> {
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
      [AI_SCRIPT_PATH, "--check", ...analyzerArguments(aiSettings)],
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

function queueQueuedJob(
  captureSessionId: string,
  burstEventIdHint: string | null = null,
  aiSettings: AiSettings = readAiSettings(),
): void {
  const burstEventId = burstEventIdHint ?? lookupBurstEventId(captureSessionId);
  queueAnalysisJobIfEnabled(sqliteDb, {
    captureSessionId,
    burstEventId,
    engine: AUDIO_ANALYSIS_ENGINE,
    paramsJson: JSON.stringify({
      vadModel: path.basename(AI_VAD_MODEL_PATH),
      asrModel: configuredAsrModel(),
      asrRevision: configuredAsrRevision(),
      cpuThreads: aiSettings.cpuThreads,
      hotwordsConfigured: aiSettings.hotwords.length > 0,
    }),
  });
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

function backfillQueuedJobs(aiSettings: AiSettings, limit = 48): number {
  void aiSettings;
  return queueHistoricalAnalysisJobs(sqliteDb, AUDIO_ANALYSIS_ENGINE, limit);
}

function claimNextJob(): PendingJobRow | null {
  return claimNextEligibleAnalysisJob(sqliteDb, AUDIO_ANALYSIS_ENGINE);
}

async function runAudioAnalyzer(audioPath: string, aiSettings: AiSettings): Promise<SigintAudioPayload> {
  const args = [AI_SCRIPT_PATH, "--wav", audioPath, ...analyzerArguments(aiSettings)];
  const hotwords = aiSettings.hotwords;
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
  const aiSettings = readAiSettings();
  if (!aiSettings.enabled) {
    return;
  }
  workerState.processing = true;
  try {
    const runtime = await checkAnalysisRuntime(aiSettings);
    if (!runtime.ok) {
      return;
    }
    // Re-read after the asynchronous runtime check so a live disable cannot race into a claim.
    if (!readAiSettings().enabled) {
      return;
    }
    const job = claimNextJob();
    if (!job) {
      return;
    }
    workerState.currentJob = { id: job.id, captureSessionId: job.captureSessionId };
    const audioAbsolutePath = captureAbsolutePath(job.audioRelativePath);
    if (!audioAbsolutePath || !existsSync(audioAbsolutePath)) {
      const errorText = "audio capture missing";
      writeFailedJob(job.id, errorText);
      workerState.lastResult = { status: "failed", endedAtMs: Date.now(), errorText };
      return;
    }
    try {
      const payload = await runAudioAnalyzer(audioAbsolutePath, aiSettings);
      if (payload.status === "completed") {
        writeSuccessfulJob(job, payload);
        workerState.lastResult = { status: "completed", endedAtMs: Date.now(), errorText: null };
      } else {
        const errorText = payload.error || "analysis failed";
        writeFailedJob(job.id, errorText);
        workerState.lastResult = { status: "failed", endedAtMs: Date.now(), errorText };
      }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : "analysis failed";
      writeFailedJob(job.id, errorText);
      workerState.lastResult = { status: "failed", endedAtMs: Date.now(), errorText };
    }
  } catch (error) {
    console.error("[analysis-worker] Worker tick error:", error);
  } finally {
    workerState.currentJob = null;
    workerState.processing = false;
    scheduleWorker();
  }
}

export function ensureAnalysisWorkerStarted(): void {
  if (!readAiSettings().enabled) {
    return;
  }
  if (workerState.running) {
    scheduleWorker(150);
    return;
  }
  workerState.running = true;
  scheduleWorker(500);
}

function captureSupportsAudioAnalysis(captureSessionId: string, aiSettings: AiSettings): boolean {
  const capture = appDb
    .select({ module: captureSessions.module })
    .from(captureSessions)
    .where(eq(captureSessions.id, captureSessionId))
    .limit(1)
    .get();
  return Boolean(capture && aiSettings.modules.includes(capture.module as AiSettings["modules"][number]));
}

export function queueCaptureAnalysisJob(captureSessionId: string, burstEventId: string | null = null): void {
  const aiSettings = readAiSettings();
  if (!aiSettings.enabled || !captureSupportsAudioAnalysis(captureSessionId, aiSettings)) {
    return;
  }
  queueQueuedJob(captureSessionId, burstEventId, aiSettings);
  ensureAnalysisWorkerStarted();
}

export function ensureCaptureAnalysisUpToDate(captureSessionId: string): void {
  const aiSettings = readAiSettings();
  if (!aiSettings.enabled || !captureSupportsAudioAnalysis(captureSessionId, aiSettings)) {
    return;
  }
  if (captureHasPreferredAnalysisJob(captureSessionId)) {
    ensureAnalysisWorkerStarted();
    return;
  }
  queueQueuedJob(captureSessionId, null, aiSettings);
  ensureAnalysisWorkerStarted();
}

export function warmAnalysisBackfill(): void {
  ensureAnalysisWorkerStarted();
}

export function notifyAiSettingsChanged(previousEnabled: boolean, nextEnabled: boolean): void {
  if (!previousEnabled && nextEnabled) {
    writeAiQueuePolicy(sqliteDb, { version: 1, claimQueuedAfterMs: Date.now() });
  }
  if (nextEnabled) {
    ensureAnalysisWorkerStarted();
  }
}

export async function requestAnalysisBackfill(limit = 48): Promise<{ queued: number; enabled: boolean }> {
  const aiSettings = readAiSettings();
  if (!aiSettings.enabled) {
    return { queued: 0, enabled: false };
  }
  writeAiQueuePolicy(sqliteDb, { version: 1, claimQueuedAfterMs: 0 });
  const queued = backfillQueuedJobs(aiSettings, Math.max(1, Math.min(500, Math.trunc(limit))));
  ensureAnalysisWorkerStarted();
  return { queued, enabled: true };
}

export async function getAnalysisWorkerStatus(forceRuntimeCheck = false): Promise<AnalysisWorkerStatus> {
  const savedSnapshot = settingsStore.getSnapshot();
  const savedAiSettings = resolveSavedAiSettings(
    savedSnapshot.values.ai,
    savedSnapshot.sections.ai.source,
    process.env,
  );
  const aiSettings = readAiSettings();
  const policyReason = runtimeAiDisableReason(process.env);
  const counts = countAnalysisJobs(sqliteDb, AUDIO_ANALYSIS_ENGINE);
  const runtimeInstalled = analysisRuntimePathsReady();
  const runtime = runtimeInstalled && aiSettings.enabled
    ? await checkAnalysisRuntime(aiSettings, forceRuntimeCheck)
    : workerState.runtimeCheck;
  return {
    enabled: aiSettings.enabled,
    savedEnabled: savedAiSettings.enabled,
    lockedByRuntime: policyReason !== null,
    runtimePolicyReason: policyReason,
    runtimeInstalled,
    runtimeHealthy: runtimeInstalled ? runtime?.ok ?? null : false,
    runtimeError: runtimeInstalled ? runtime?.errorText ?? "" : "Local SIGINT Audio v2 runtime is not installed yet.",
    workerRunning: workerState.running,
    processing: workerState.processing,
    queuedJobs: counts.queuedJobs ?? 0,
    heldQueuedJobs: counts.heldQueuedJobs ?? 0,
    runningJobs: counts.runningJobs ?? 0,
    currentJob: workerState.currentJob ? { ...workerState.currentJob } : null,
    lastResult: workerState.lastResult ? { ...workerState.lastResult } : null,
  };
}
