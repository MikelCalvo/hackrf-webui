export type SigintSpeechRegion = {
  start: number;
  end: number;
  start_ms: number;
  end_ms: number;
  mean_probability: number;
};

export type SigintTranscriptWord = {
  start: number;
  end: number;
  word: string;
  probability: number;
};

export type SigintTranscriptSegment = {
  start: number;
  end: number;
  text: string;
  accepted: boolean;
  avg_logprob: number;
  no_speech_prob: number;
  compression_ratio: number;
  words: SigintTranscriptWord[];
};

export type SigintAudioPayload = {
  schema_version: 2;
  engine: "sigint-audio-v2";
  status: "completed" | "failed";
  classification: "speech" | "noise" | "unknown";
  confidence: number;
  error: string;
  audio_seconds: number;
  rms: number;
  elapsed_ms: number;
  voice_activity: {
    detected: boolean;
    ratio: number;
    seconds: number;
    longest_burst_seconds: number;
    confidence: number;
    detector: string;
    region_count: number;
    speech_regions: SigintSpeechRegion[];
  };
  transcript: {
    engine: "faster-whisper";
    accepted: boolean;
    skipped: boolean;
    language: string;
    language_probability: number;
    text: string;
    confidence: number;
    duration_after_vad: number;
    segment_count: number;
    accepted_segments: number;
    mean_avg_logprob: number;
    max_no_speech_prob: number;
    segments: SigintTranscriptSegment[];
  };
  explanation: string;
  components: {
    vad: { engine: string; model: string };
    asr: { engine: string; model: string };
  };
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function integer(value: unknown, fallback = 0): number {
  return Math.max(0, Math.round(finite(value, fallback)));
}

function score(value: unknown): number {
  return Math.min(1, Math.max(0, finite(value)));
}

function boolean(value: unknown): boolean {
  return value === true;
}

function normalizeSpeechRegions(value: unknown): SigintSpeechRegion[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((candidate) => {
    const row = record(candidate);
    if (!row || typeof row.start !== "number" || typeof row.end !== "number") {
      return [];
    }
    return [{
      start: integer(row.start),
      end: integer(row.end),
      start_ms: integer(row.start_ms),
      end_ms: integer(row.end_ms),
      mean_probability: score(row.mean_probability),
    }];
  });
}

function normalizeWords(value: unknown): SigintTranscriptWord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((candidate) => {
    const row = record(candidate);
    if (!row || typeof row.word !== "string") {
      return [];
    }
    return [{
      start: finite(row.start),
      end: finite(row.end),
      word: row.word,
      probability: score(row.probability),
    }];
  });
}

function normalizeSegments(value: unknown): SigintTranscriptSegment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((candidate) => {
    const row = record(candidate);
    if (!row || typeof row.text !== "string") {
      return [];
    }
    return [{
      start: finite(row.start),
      end: finite(row.end),
      text: row.text,
      accepted: boolean(row.accepted),
      avg_logprob: finite(row.avg_logprob),
      no_speech_prob: score(row.no_speech_prob),
      compression_ratio: finite(row.compression_ratio),
      words: normalizeWords(row.words),
    }];
  });
}

export function normalizeSigintAudioPayload(value: unknown): SigintAudioPayload | null {
  const payload = record(value);
  const voice = record(payload?.voice_activity);
  const transcript = record(payload?.transcript);
  const components = record(payload?.components);
  const vad = record(components?.vad);
  const asr = record(components?.asr);
  if (
    !payload
    || payload.schema_version !== 2
    || payload.engine !== "sigint-audio-v2"
    || (payload.status !== "completed" && payload.status !== "failed")
    || !voice
    || !transcript
    || transcript.engine !== "faster-whisper"
    || !vad
    || !asr
  ) {
    return null;
  }

  const classification = payload.classification === "speech" || payload.classification === "noise"
    ? payload.classification
    : "unknown";
  return {
    schema_version: 2,
    engine: "sigint-audio-v2",
    status: payload.status,
    classification,
    confidence: score(payload.confidence),
    error: text(payload.error),
    audio_seconds: Math.max(0, finite(payload.audio_seconds)),
    rms: Math.max(0, finite(payload.rms)),
    elapsed_ms: integer(payload.elapsed_ms),
    voice_activity: {
      detected: boolean(voice.detected),
      ratio: score(voice.ratio),
      seconds: Math.max(0, finite(voice.seconds)),
      longest_burst_seconds: Math.max(0, finite(voice.longest_burst_seconds)),
      confidence: score(voice.confidence),
      detector: text(voice.detector),
      region_count: integer(voice.region_count),
      speech_regions: normalizeSpeechRegions(voice.speech_regions),
    },
    transcript: {
      engine: "faster-whisper",
      accepted: boolean(transcript.accepted),
      skipped: boolean(transcript.skipped),
      language: text(transcript.language),
      language_probability: score(transcript.language_probability),
      text: text(transcript.text),
      confidence: score(transcript.confidence),
      duration_after_vad: Math.max(0, finite(transcript.duration_after_vad)),
      segment_count: integer(transcript.segment_count),
      accepted_segments: integer(transcript.accepted_segments),
      mean_avg_logprob: finite(transcript.mean_avg_logprob),
      max_no_speech_prob: score(transcript.max_no_speech_prob),
      segments: normalizeSegments(transcript.segments),
    },
    explanation: text(payload.explanation),
    components: {
      vad: { engine: text(vad.engine), model: text(vad.model) },
      asr: { engine: text(asr.engine), model: text(asr.model) },
    },
  };
}
