import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "native/hackrf_audio_stream.c"), "utf8");

test("native audio stream exposes a carrier-tone CW mode rather than AM envelope audio", () => {
  assert.match(source, /DEMOD_CW\s*=\s*\d+/);
  assert.match(source, /\[-m am\|nfm\|wfm\|cw\]/);
  assert.match(source, /case DEMOD_CW:\s*\n\s*return "cw";/);
  assert.match(source, /strcasecmp\(text, "cw"\)\s*==\s*0[\s\S]*?\*out_mode\s*=\s*DEMOD_CW/);

  // CW has a narrow complex RF path and creates a 700 Hz BFO sidetone.
  assert.match(source, /#define CW_BFO_HZ 700\.0/);
  assert.match(source, /case DEMOD_CW:[\s\S]*?rf_cutoff_hz\s*=\s*500;/);
  assert.match(source, /case DEMOD_CW:[\s\S]*?cw_step\s*=\s*2\.0 \* M_PI \* CW_BFO_HZ/);
  assert.match(source, /cw_envelope/);
  assert.match(source, /state->cw_envelope \* cos\(state->cw_phase\)/);

  const cwBranch = source.match(/if \(state->mode == DEMOD_CW\) \{([\s\S]*?)\n    \}\n\n    norm/)?.[1] ?? "";
  assert.match(cwBranch, /hypot\(filtered_i, filtered_q\)/);
  assert.doesNotMatch(cwBranch, /process_demod_audio\(state, hypot/);
});
