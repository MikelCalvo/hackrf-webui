import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const analyzer = readFileSync(new URL("../scripts/ai/audio_analyzer.py", import.meta.url), "utf8");
const requirements = readFileSync(new URL("../scripts/ai/requirements.txt", import.meta.url), "utf8");

test("SIGINT Audio v2 uses Silero VAD plus faster-whisper and removes YAMNet", () => {
  assert.match(analyzer, /SileroVADModel/);
  assert.match(analyzer, /WhisperModel/);
  assert.doesNotMatch(analyzer, /yamnet|webrtcvad|tflite/i);
  assert.doesNotMatch(requirements, /yamnet|webrtcvad|tensorflow|ai-edge-litert/i);
});

test("SIGINT Audio v2 uses pinned compact CPU dependencies", () => {
  assert.match(requirements, /^faster-whisper==1\.2\.1\s+\\$/m);
  assert.match(requirements, /^ctranslate2==4\.8\.1\s+\\$/m);
  assert.match(requirements, /^av==18\.0\.0\s+\\$/m);
  assert.match(requirements, /^onnxruntime==1\.28\.0\s+\\$/m);
  assert.match(requirements, /^numpy==2\.4\.3\s+\\$/m);
  assert.doesNotMatch(requirements, /torch|cuda|tensorflow|ai-edge-litert/i);
  assert.match(requirements, /--hash=sha256:/);
});

test("SIGINT Audio v2 defaults to compact multilingual base CPU int8 inference", () => {
  assert.match(analyzer, /DEFAULT_ASR_MODEL\s*=\s*"Systran\/faster-whisper-base"/);
  assert.match(analyzer, /device="cpu"/);
  assert.match(analyzer, /compute_type="int8"/);
  assert.match(analyzer, /cpu_threads=/);
  assert.match(analyzer, /num_workers=1/);
});

test("SIGINT Audio v2 exposes explicit prepare, check, VAD-only and offline analysis modes", () => {
  assert.match(analyzer, /--prepare/);
  assert.match(analyzer, /--check/);
  assert.match(analyzer, /--skip-asr/);
  assert.match(analyzer, /--vad-model/);
  assert.match(analyzer, /--model-cache/);
  assert.match(analyzer, /local_files_only=not prepare/);
  assert.match(analyzer, /ASR model is not prepared/);
});

test("SIGINT Audio v2 emits the worker contract", () => {
  for (const field of [
    '"schema_version": 2',
    '"engine": ENGINE_NAME',
    '"classification"',
    '"voice_activity"',
    '"transcript"',
    '"segments"',
    '"language"',
    '"language_probability"',
    '"avg_logprob"',
    '"no_speech_prob"',
    '"compression_ratio"',
    '"elapsed_ms"',
  ]) {
    assert.ok(analyzer.includes(field), `missing analyzer result field ${field}`);
  }
});

test("SIGINT Audio v2 is tuned for short noisy radio bursts", () => {
  assert.match(analyzer, /TARGET_RATE\s*=\s*16000/);
  assert.match(analyzer, /MAX_SECONDS\s*=\s*20\.0/);
  assert.match(analyzer, /MIN_SECONDS\s*=\s*0\.20/);
  assert.match(analyzer, /VAD_THRESHOLD\s*=\s*0\.42/);
  assert.match(analyzer, /min_speech_duration_ms=120/);
  assert.match(analyzer, /min_silence_duration_ms=180/);
  assert.match(analyzer, /speech_pad_ms=120/);
});

test("SIGINT Audio v2 transcribes only precomputed voice regions", () => {
  assert.match(analyzer, /if speech_regions and not args\.skip_asr/);
  assert.match(analyzer, /for timestamp in \(/);
  assert.match(analyzer, /float\(region\["start"\]\) \/ TARGET_RATE/);
  assert.match(analyzer, /float\(region\["end"\]\) \/ TARGET_RATE/);
  assert.match(analyzer, /segment_iterator, info = model\.transcribe/);
  assert.match(analyzer, /clip_timestamps=clip_timestamps/);
  assert.match(analyzer, /vad_filter=False/);
  assert.match(analyzer, /task="transcribe"/);
  assert.match(analyzer, /condition_on_previous_text=False/);
});

test("SIGINT Audio v2 rejects unreliable ASR while preserving metrics", () => {
  assert.match(analyzer, /segment_accepted/);
  assert.match(analyzer, /avg_logprob >=/);
  assert.match(analyzer, /no_speech_prob <=/);
  assert.match(analyzer, /compression_ratio <=/);
  assert.match(analyzer, /transcript_text = ""/);
  assert.match(analyzer, /rejected as unreliable/);
});

test("SIGINT Audio v2 stays local, bounded and evidence-preserving", () => {
  assert.match(analyzer, /ffmpeg/);
  assert.match(analyzer, /f32le/);
  assert.match(analyzer, /seconds=MAX_SECONDS/);
  assert.doesNotMatch(analyzer, /http:\/\/|https:\/\/|API_KEY|TOKEN/);
  assert.doesNotMatch(analyzer, /unlink\(|remove\(|rename\(|writeframes|wavfile\.write/);
});

test("SIGINT Audio v2 rejects stale or mismatched cached model revisions", () => {
  assert.match(analyzer, /manifest\.get\("model_id"\) == model_id/);
  assert.match(analyzer, /manifest\.get\("revision"\) == revision/);
  assert.match(analyzer, /is_model_cached\(model_cache, args\.asr_model, args\.asr_revision\)/);
  assert.doesNotMatch(analyzer, /models--.*snapshots/);
});

test("SIGINT Audio v2 returns JSON for checks, preparation, success and failure", () => {
  assert.match(analyzer, /def build_error/);
  assert.match(analyzer, /"status": "ok"/);
  assert.match(analyzer, /"status": "completed"/);
  assert.match(analyzer, /"status": "failed"/);
  assert.match(analyzer, /"prepared"/);
  assert.match(analyzer, /print\(json\.dumps\(payload, ensure_ascii=False\)\)/);
});

test("SIGINT Audio v2 has a standalone CLI and no database or UI coupling", () => {
  assert.match(analyzer, /argparse\.ArgumentParser/);
  assert.match(analyzer, /if __name__ == "__main__"/);
  assert.match(analyzer, /raise SystemExit\(main\(\)\)/);
  assert.doesNotMatch(analyzer, /sqlite|drizzle|react|nextjs|tailwind/i);
});
