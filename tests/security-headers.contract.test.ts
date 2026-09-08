import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Next config applies baseline anti-sniffing, anti-framing, and referrer headers", async () => {
  const source = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");

  assert.match(source, /X-Content-Type-Options/);
  assert.match(source, /nosniff/);
  assert.match(source, /X-Frame-Options/);
  assert.match(source, /DENY/);
  assert.match(source, /Referrer-Policy/);
  assert.match(source, /no-referrer/);
  assert.match(source, /async headers\(\)/);
});
