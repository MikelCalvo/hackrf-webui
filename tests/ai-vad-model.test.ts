import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const analyzer = readFileSync(new URL("../scripts/ai/audio_analyzer.py", import.meta.url), "utf8");

test("speech segmentation uses the explicitly loaded bundled Silero model", () => {
  assert.match(analyzer, /model = SileroVADModel\(str\(vad_model\)\)/);
  assert.match(analyzer, /probabilities = np\.asarray\(model\(padded\)/);
  assert.match(analyzer, /speech_timestamps_from_probabilities\(probabilities/);
  assert.doesNotMatch(analyzer, /get_speech_timestamps/);
});
