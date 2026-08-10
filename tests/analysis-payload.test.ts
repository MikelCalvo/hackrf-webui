import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSigintAudioPayload,
  type SigintAudioPayload,
} from "@/server/sigint-audio-payload";

const validPayload: SigintAudioPayload = {
  schema_version: 2,
  engine: "sigint-audio-v2",
  status: "completed",
  classification: "speech",
  confidence: 0.82,
  error: "",
  audio_seconds: 4.2,
  rms: 0.04,
  elapsed_ms: 911,
  voice_activity: {
    detected: true,
    ratio: 0.55,
    seconds: 2.31,
    longest_burst_seconds: 1.4,
    confidence: 0.9,
    detector: "silero-vad-v6",
    region_count: 2,
    speech_regions: [
      { start: 100, end: 500, start_ms: 6, end_ms: 31, mean_probability: 0.9 },
    ],
  },
  transcript: {
    engine: "faster-whisper",
    accepted: true,
    skipped: false,
    language: "es",
    language_probability: 0.92,
    text: "Recibido, cambio.",
    confidence: 0.74,
    duration_after_vad: 2.31,
    segment_count: 1,
    accepted_segments: 1,
    mean_avg_logprob: -0.3,
    max_no_speech_prob: 0.1,
    segments: [
      {
        start: 0.4,
        end: 1.9,
        text: "Recibido, cambio.",
        accepted: true,
        avg_logprob: -0.3,
        no_speech_prob: 0.1,
        compression_ratio: 1.1,
        words: [{ start: 0.4, end: 0.9, word: "Recibido", probability: 0.88 }],
      },
    ],
  },
  explanation: "Voice activity was detected and transcribed locally.",
  components: {
    vad: { engine: "silero-vad", model: "silero_vad_v6.onnx" },
    asr: { engine: "faster-whisper", model: "Systran/faster-whisper-base" },
  },
};

test("normalizes a completed SIGINT Audio v2 payload", () => {
  const payload = normalizeSigintAudioPayload(validPayload);
  assert.ok(payload);
  assert.equal(payload.classification, "speech");
  assert.equal(payload.transcript.text, "Recibido, cambio.");
  assert.equal(payload.voice_activity.detector, "silero-vad-v6");
});

test("rejects unknown schema versions and malformed results", () => {
  assert.equal(normalizeSigintAudioPayload({ ...validPayload, schema_version: 1 }), null);
  assert.equal(normalizeSigintAudioPayload({ ...validPayload, status: "ok" }), null);
  assert.equal(normalizeSigintAudioPayload({ ...validPayload, transcript: null }), null);
});

test("clamps scores and removes malformed nested entries", () => {
  const payload = normalizeSigintAudioPayload({
    ...validPayload,
    confidence: 4,
    voice_activity: {
      ...validPayload.voice_activity,
      confidence: -2,
      speech_regions: [
        ...validPayload.voice_activity.speech_regions,
        { start: "bad" },
      ],
    },
    transcript: {
      ...validPayload.transcript,
      language_probability: 9,
      segments: [
        ...validPayload.transcript.segments,
        { text: 4 },
      ],
    },
  });
  assert.ok(payload);
  assert.equal(payload.confidence, 1);
  assert.equal(payload.voice_activity.confidence, 0);
  assert.equal(payload.transcript.language_probability, 1);
  assert.equal(payload.voice_activity.speech_regions.length, 1);
  assert.equal(payload.transcript.segments.length, 1);
});

test("keeps failed payloads usable by the analysis worker", () => {
  const payload = normalizeSigintAudioPayload({
    ...validPayload,
    status: "failed",
    classification: "unknown",
    error: "model unavailable",
    transcript: { ...validPayload.transcript, accepted: false, text: "", segments: [] },
  });
  assert.ok(payload);
  assert.equal(payload.status, "failed");
  assert.equal(payload.error, "model unavailable");
});
