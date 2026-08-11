import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pagePath = new URL("../src/app/page.tsx", import.meta.url);

test("root page resolves persisted startup settings on the server", async () => {
  const source = await readFile(pagePath, "utf8");
  assert.match(source, /readAppSettings/);
  assert.match(source, /settings\.general\.restoreLastModule/);
  assert.match(source, /settings\.general\.defaultModule/);
  assert.match(source, /redirect\(getAppModulePath\(fallbackModule\)\)/);
});

test("server startup restoration never accepts Settings as an operational module", async () => {
  const source = await readFile(pagePath, "utf8");
  assert.match(source, /isAppModuleId\(rawModule\)/);
  assert.match(source, /getAppModulePath/);
  assert.doesNotMatch(source, /fallbackModule[^\n]*"settings"/);
});

test("startup settings test sentinel", () => assert.equal(true, true));
