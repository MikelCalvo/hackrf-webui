import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const installer = readFileSync(new URL("../scripts/install-dump1090-fa.mjs", import.meta.url), "utf8");

test("dump1090-fa installer tolerates GCC format truncation diagnostics from pinned upstream", () => {
  assert.match(installer, /-Wno-error=format-truncation/);
});
