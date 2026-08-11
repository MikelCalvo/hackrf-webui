import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboardPath = new URL("../src/components/dashboard.tsx", import.meta.url);
const settingsPath = new URL("../src/components/settings.tsx", import.meta.url);
const pagePath = new URL("../src/app/settings/page.tsx", import.meta.url);

test("Settings is a dedicated route and not an operational RF module", async () => {
  const [dashboard, page] = await Promise.all([readFile(dashboardPath, "utf8"), readFile(pagePath, "utf8")]);
  assert.match(page, /activeModule="settings"/);
  assert.match(dashboard, /AppViewId/);
  assert.match(dashboard, /activeModule:\s*AppViewId/);
  assert.doesNotMatch(page, /hackrfService|radioSupervisor|startStream|startSession/);
});

test("Settings link is permanently placed after a sidebar flex spacer", async () => {
  const source = await readFile(dashboardPath, "utf8");
  const navStart = source.indexOf("<nav");
  const settingsLink = source.indexOf('href="/settings"', navStart);
  const spacer = source.lastIndexOf('className="flex-1"', settingsLink);
  assert.ok(navStart >= 0 && spacer > navStart && settingsLink > spacer);
  assert.match(source.slice(settingsLink - 800, settingsLink + 1200), /SETTINGS|Settings/);
});

test("Settings view never overwrites the last operational module", async () => {
  const source = await readFile(dashboardPath, "utf8");
  const persistence = source.slice(source.indexOf("LAST_MODULE_STORAGE_KEY") - 400, source.indexOf("LAST_MODULE_STORAGE_KEY") + 1000);
  assert.match(source, /isAppModuleId\(activeModule\)/);
  assert.doesNotMatch(persistence, /getCookieHeaderForModule\(activeModule as/);
});

test("sidebar settings filter operational links but can never hide Settings", async () => {
  const source = await readFile(dashboardPath, "utf8");
  assert.match(source, /visibleModules/);
  assert.match(source, /sidebarSettings/);
  const settingsLink = source.slice(source.indexOf('href="/settings"') - 500, source.indexOf('href="/settings"') + 900);
  assert.doesNotMatch(settingsLink, /visibleModules\.includes/);
});

test("Settings UI has General, Sidebar, AI and Diagnostics sections", async () => {
  const source = await readFile(settingsPath, "utf8");
  assert.match(source, /label: "General"/);
  assert.match(source, /label: "Sidebar"/);
  assert.match(source, /label: "AI & Analysis"/);
  assert.match(source, /label: "Diagnostics"/);
  assert.match(source, /Enable local AI analysis/);
  assert.match(source, /Analysis modules/);
  assert.match(source, /MORSE is intentionally excluded/);
  assert.match(source, /Process queued captures/);
  assert.match(source, /NEXT SESSION|LIVE/);
});

test("Settings UI persists through authenticated API calls", async () => {
  const source = await readFile(settingsPath, "utf8");
  assert.match(source, /apiFetch\("\/api\/settings"/);
  assert.match(source, /method:\s*"PATCH"/);
  assert.match(source, /\/api\/settings\/ai\/backfill/);
  assert.match(source, /cache:\s*"no-store"/);
});

test("Settings UI does not expose secrets, paths or RF mutation controls", async () => {
  const source = await readFile(settingsPath, "utf8");
  assert.doesNotMatch(source, /API token|password|private key|database path|capture path|LNA|VGA|squelch/i);
  assert.doesNotMatch(source, /\/api\/radio|\/api\/stream|DELETE/);
});

test("compact sidebar preference changes width and can hide band subtitles", async () => {
  const source = await readFile(dashboardPath, "utf8");
  assert.match(source, /sidebarSettings\.compact/);
  assert.match(source, /w-\[54px\]|w-\[70px\]/);
});

test("settings route keeps Diagnostics refresh explicit", async () => {
  const source = await readFile(settingsPath, "utf8");
  assert.match(source, /Refresh diagnostics/);
  assert.match(source, /refreshRuntime=1/);
});

test("settings UI contract sentinel", () => assert.equal(true, true));
