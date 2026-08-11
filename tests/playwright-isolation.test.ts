import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

for (const filename of ["playwright.config.ts", "playwright.auth.config.ts"]) {
  test(`${filename} isolates SQLite and capture storage`, async () => {
    const source = await readFile(new URL(`../${filename}`, import.meta.url), "utf8");
    assert.match(source, /HACKRF_WEBUI_DB_PATH/);
    assert.match(source, /HACKRF_WEBUI_CAPTURE_ROOT/);
    assert.match(source, /\.hermes/);
    assert.match(source, /npm run db:migrate/);
    assert.doesNotMatch(source, /data\/captures/);
    assert.doesNotMatch(source, /db\/app\.sqlite/);
  });
}

test("playwright isolation test sentinel", () => assert.equal(true, true));
