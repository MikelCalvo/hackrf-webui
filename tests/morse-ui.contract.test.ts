import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const morseComponent = new URL("../src/components/morse.tsx", import.meta.url);
const morsePage = new URL("../src/app/morse/page.tsx", import.meta.url);
const modules = new URL("../src/lib/modules.ts", import.meta.url);
const dashboard = new URL("../src/components/dashboard.tsx", import.meta.url);

test("MORSE route is a local Dashboard module and navigation is registered", async () => {
  const [page, moduleRegistry, dashboardSource] = await Promise.all([
    readFile(morsePage, "utf8"),
    readFile(modules, "utf8"),
    readFile(dashboard, "utf8"),
  ]);

  assert.match(page, /<Dashboard activeModule="morse"/);
  assert.match(moduleRegistry, /id:\s*"morse"/);
  assert.match(moduleRegistry, /path:\s*"\/morse"/);
  assert.match(dashboardSource, /MorseModule/);
  assert.match(dashboardSource, /activeModule === "morse"/);
  assert.match(dashboardSource, /id === "morse"/);
});

test("MORSE navigation sits below AIS in the left module bar", async () => {
  const moduleRegistry = await readFile(modules, "utf8");
  const aisPosition = moduleRegistry.indexOf('{ id: "ais"');
  const morsePosition = moduleRegistry.indexOf('{ id: "morse"');

  assert.ok(aisPosition >= 0, "AIS module must be registered");
  assert.ok(morsePosition > aisPosition, "MORSE must be registered after AIS");
});

test("MORSE UI is idle until an explicit manual or scan start action", async () => {
  const source = await readFile(morseComponent, "utf8");

  assert.match(source, /useRadioSession[\s\S]*\("morse"\)/);
  assert.match(source, /START SCANNING/);
  assert.match(source, /LISTEN\/START MANUAL/);
  assert.match(source, /start\("scan"\)/);
  assert.match(source, /start\("manual"\)/);
  assert.doesNotMatch(source, /useEffect[\s\S]{0,800}createSession\(/);
});

test("MORSE UI consumes the explicit local session contract and exposes decode evidence", async () => {
  const source = await readFile(morseComponent, "utf8");

  assert.match(source, /kind:\s*"morse"/);
  assert.match(source, /module:\s*"morse"/);
  assert.match(source, /frontEnd:\s*frontEnd/);
  assert.match(source, /INITIAL_MORSE_CATALOG/);
  assert.match(source, /rankMorseCatalog/);
  assert.match(source, /Nearby navigation/);
  assert.match(source, /Amateur CW/);
  assert.match(source, /International beacons/);
  assert.match(source, /Manual/);
  assert.match(source, /"recommended"/);
  assert.match(source, /"selected"/);
  assert.match(source, /"all"/);
  assert.match(source, /incompatibilityReason/);
  assert.match(source, /Raw Morse/);
  assert.match(source, /Decoded text/);
  assert.match(source, /Confidence/);
  assert.match(source, /WPM/);
  assert.match(source, /HOLD/);
  assert.match(source, /aria-label=/);
  assert.match(source, /max-\[899px\]/);
  assert.doesNotMatch(source, /toast/i);
});

test("MORSE local failures stay in the module", async () => {
  const source = await readFile(morseComponent, "utf8");

  assert.match(source, /setLocalError/);
  assert.match(source, /localError/);
  assert.match(source, /session\?\.lastError/);
});

test("MORSE scan uses exactly the compatible entries visible in the active catalog tab", async () => {
  const source = await readFile(morseComponent, "utf8");

  assert.match(source, /const scanEntries = useMemo/);
  assert.match(source, /catalogMode === "recommended"[\s\S]*slice\(0, 8\)/);
  assert.match(source, /catalogMode === "selected"[\s\S]*selectedChannelId/);
  assert.match(source, /channels: mode === "manual" \? manualChannels : scanChannels/);
});

test("MORSE highlights and keeps the current scan row visible with a moving status", async () => {
  const source = await readFile(morseComponent, "utf8");

  assert.match(source, /isScanCursor/);
  assert.match(source, /data-scan-current=/);
  assert.match(source, /SCANNING/);
  assert.match(source, /channelPositionLabel/);
  assert.match(source, /bg-cyan-300\/\[0\.18\]/);
  assert.match(source, /currentChannelRowRef/);
  assert.match(source, /scrollIntoView\(\{ block: "nearest" \}\)/);
});
