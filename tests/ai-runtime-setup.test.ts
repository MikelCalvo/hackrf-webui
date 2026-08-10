import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const start = readFileSync(new URL("../start.sh", import.meta.url), "utf8");
const runtimeDocs = readFileSync(new URL("../docs/runtime.md", import.meta.url), "utf8");

test("start.sh installs SIGINT Audio v2 with one compact synchronized environment", () => {
  assert.match(start, /audio_analyzer\.py/);
  assert.match(start, /silero_vad_v6\.onnx/);
  assert.match(start, /pip sync/);
  assert.match(start, /--require-hashes/);
  assert.match(start, /Synchronizing the pinned local SIGINT AI packages/);
  assert.match(start, /rm -rf "\$AI_CACHE_DIR"/);
  assert.doesNotMatch(start, /yamnet|audio_tagger|webrtcvad|AI_LABELS/i);
});

test("start.sh pins the default ASR model revision and requires matching overrides", () => {
  assert.match(start, /Systran\/faster-whisper-base/);
  assert.match(start, /ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66/);
  assert.match(start, /HACKRF_WEBUI_AI_ASR_REVISION/);
  assert.match(runtimeDocs, /immutable `HACKRF_WEBUI_AI_ASR_REVISION` commit SHA/);
});

test("start.sh verifies the bundled Silero artifact before use", () => {
  assert.match(start, /sha256sum --check/);
  assert.match(start, /silero_vad_v6\.onnx\.sha256/);
});
