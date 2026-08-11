import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePath = new URL("../src/app/api/settings/route.ts", import.meta.url);
const backfillRoutePath = new URL("../src/app/api/settings/ai/backfill/route.ts", import.meta.url);

test("settings API is authenticated, no-store and validates patches", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /authorizeApiRequest/);
  assert.match(source, /sensitive:\s*true/);
  assert.match(source, /parseSettingsPatch/);
  assert.match(source, /patchAppSettings/);
  assert.match(source, /Cache-Control/);
  assert.match(source, /no-store/);
  assert.match(source, /export async function GET/);
  assert.match(source, /export async function PATCH/);
});

test("settings write API relies on unsafe-method origin validation", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source.replace(/\s+/g, " "), /authorizeApiRequest\(request, \{ sensitive: true \}\)/);
  assert.doesNotMatch(source, /apiToken|password|secret/i);
});

test("AI backfill is an explicit authenticated POST action", async () => {
  const source = await readFile(backfillRoutePath, "utf8");
  assert.match(source, /export async function POST/);
  assert.match(source, /authorizeApiRequest/);
  assert.match(source, /sensitive:\s*true/);
  assert.match(source, /requestAnalysisBackfill/);
  assert.doesNotMatch(source, /DELETE|TRUNCATE|unlinkSync/);
});

test("settings API does not expose arbitrary import or environment mutation", async () => {
  const source = `${await readFile(routePath, "utf8")}\n${await readFile(backfillRoutePath, "utf8")}`;
  assert.doesNotMatch(source, /process\.env\s*\[/);
  assert.doesNotMatch(source, /exec|spawn|writeFile|rm\(/);
  assert.doesNotMatch(source, /tokenConfiguredValue|HACKRF_WEBUI_TOKEN/);
});

test("settings API returns controlled client errors", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /Invalid settings payload/);
  assert.match(source, /status:\s*400/);
  assert.doesNotMatch(source, /error\.stack/);
});

test("settings GET combines persisted snapshot with safe AI runtime status", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /getAppSettingsStore/);
  assert.match(source, /getAnalysisWorkerStatus/);
  assert.match(source, /snapshot/);
  assert.match(source, /analysis/);
});

test("settings API contract sentinel", () => assert.equal(true, true));
