import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const supervisor = readFileSync(new URL("../src/server/radio/supervisor.ts", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../src/server/radio/morse-session.ts", import.meta.url), "utf8");

test("radio supervisor owns MORSE through a managed session", () => {
  assert.match(supervisor, /MorseSession/);
  assert.match(supervisor, /request\.kind === "morse"/);
  assert.match(supervisor, /new MorseSession/);
});

test("MORSE managed session starts the explicit front-end and streams audio", () => {
  assert.match(runtime, /startCwStream/);
  assert.match(runtime, /frontEnd === "am_tone"/);
  assert.match(runtime, /startAmStream/);
  assert.match(runtime, /createMorseRuntime/);
  assert.match(runtime, /audioBroker/);
  assert.match(runtime, /close\(\)/);
});

test("MORSE session keeps deterministic scan and HOLD state in its snapshot", () => {
  assert.match(runtime, /scheduler|scheduleNextChannel/);
  assert.match(runtime, /activeChannel/);
  assert.match(runtime, /decode:/);
  assert.match(runtime, /rawMorse/);
  assert.match(runtime, /wordsPerMinute/);
  assert.match(runtime, /morseRuntime\?\.reset\(\)/);
  assert.match(runtime, /pendingChannel \?\? this\.activeChannel/);
});

test("MORSE session references pure SIGINT persistence records without correcting raw text", () => {
  assert.match(runtime, /buildMorsePersistenceRecords/);
  assert.match(runtime, /rawMorse/);
  assert.doesNotMatch(runtime, /autoCorrect|spellcheck|replaceDecodedText/i);
});
