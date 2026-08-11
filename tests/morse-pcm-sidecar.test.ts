import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const nativeSource = readFileSync(new URL("../native/hackrf_audio_stream.c", import.meta.url), "utf8");
const hackrfSource = readFileSync(new URL("../src/server/hackrf.ts", import.meta.url), "utf8");
const sessionSource = readFileSync(new URL("../src/server/radio/morse-session.ts", import.meta.url), "utf8");

test("native audio stream can mirror demodulated PCM to a sidecar FIFO/file", () => {
  assert.match(nativeSource, /MORSE_PCM|PCM sidecar|morse_pcm/i);
  assert.match(nativeSource, /write_pcm16le/);
});

test("HackRF service exposes MORSE PCM frames separately from MP3 audio", () => {
  assert.match(hackrfSource, /onMorsePcm|MorsePcm/);
  assert.match(hackrfSource, /pcm/i);
});

test("MORSE session feeds sidecar PCM into the deterministic runtime and updates evidence", () => {
  assert.match(sessionSource, /runtimeFactory\s*\(/);
  assert.match(sessionSource, /process\(/);
  assert.match(sessionSource, /rawMorse/);
  assert.match(sessionSource, /completedDecode/);
  assert.match(sessionSource, /persistMorsePersistenceRecords/);
});
