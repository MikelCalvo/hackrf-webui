import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/components/sigint.tsx", import.meta.url), "utf8");

test("SIGINT places a global evidence-text search above the workspace", () => {
  assert.match(source, /data-testid="sigint-global-search"/);
  assert.match(source, /Search transcripts, decoded MORSE, raw symbols, identifiers, labels or places/);
});

test("SIGINT renders dedicated MORSE evidence without presenting it as speech AI", () => {
  assert.match(source, /MORSE decode/);
  assert.match(source, /Raw MORSE/);
  assert.match(source, /Expected identifier/);
  assert.match(source, /Catalog provenance/);
  assert.match(source, /Review against the original WAV and IQ evidence/);
  assert.match(source, /captureDetail\.morseSummary/);
});

test("SIGINT queue previews searchable transcript evidence", () => {
  assert.match(source, /item\.transcriptPreview/);
  assert.match(source, /Decoded MORSE/);
});
