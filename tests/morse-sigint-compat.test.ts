import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/components/sigint.tsx", import.meta.url), "utf8");

test("SIGINT renders a compact MORSE module label for persisted evidence", () => {
  assert.match(source, /case "morse":\s*\n\s*return "CW";/);
});
