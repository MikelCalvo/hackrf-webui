import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createSimulatedSpectrumFrame,
} from "@/server/hackrf-simulator";

test("CW simulator spectrum is narrow and tune-aware", () => {
  const spectrum = createSimulatedSpectrumFrame(7_030_000, "cw", 0);

  assert.equal(spectrum.centerFreqHz, 7_030_000);
  assert.equal(spectrum.spanHz, 25_000);
  assert.equal(spectrum.bins.length, 96);
});

test("the public TypeScript stream contract includes CW type and service plumbing", () => {
  const typesSource = readFileSync(path.join(process.cwd(), "src/lib/types.ts"), "utf8");
  const serviceSource = readFileSync(path.join(process.cwd(), "src/server/hackrf.ts"), "utf8");

  assert.match(typesSource, /export type AudioDemodMode = .*"cw"/);
  assert.match(serviceSource, /startCwStream\(request: StreamRequest, signal: AbortSignal\)/);
  assert.match(serviceSource, /startStreamInternal\(request, "cw", signal\)/);
  assert.match(serviceSource, /case "cw":\s*return "10000"/);
});
