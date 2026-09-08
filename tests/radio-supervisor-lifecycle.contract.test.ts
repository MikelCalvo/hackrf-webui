import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("radio supervisor serializes lifecycle transitions and releases its lease after native teardown", async () => {
  const [supervisor, fmSession, narrowbandSession, morseSession] = await Promise.all([
    readFile(new URL("../src/server/radio/supervisor.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/server/radio/fm-session.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/server/radio/narrowband-session.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/server/radio/morse-session.ts", import.meta.url), "utf8"),
  ]);

  assert.match(supervisor, /AsyncSerial/);
  assert.match(supervisor, /this\.serial\.run\(\(\) => this\.createSessionInternal\(request\)\)/);
  assert.match(supervisor, /this\.serial\.run\(\(\) => this\.stopSessionInternal\(sessionId\)\)/);
  assert.match(supervisor, /await session\.stop\(\);[\s\S]*?this\.scheduler\.release\(sessionId\);/);
  for (const source of [fmSession, narrowbandSession, morseSession]) {
    assert.match(source, /await hackrfService\.stopStream\(\);/);
  }
});
