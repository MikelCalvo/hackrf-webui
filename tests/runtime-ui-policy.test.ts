import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AIS and ADS-B feeds require an explicit start action", async () => {
  const source = await readFile(new URL("../src/components/live-map.ts", import.meta.url), "utf8");
  const warnings = await Promise.all([
    readFile(new URL("../src/server/ais-runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/server/adsb-runtime.ts", import.meta.url), "utf8"),
  ]);

  const mountEffect = source.slice(source.indexOf("const boot = async () =>"), source.indexOf("useEffect(() => {\n    let cancelled = false;\n    let timer"));
  assert.doesNotMatch(mountEffect, /await startRuntimeRef\.current\(\)/);
  assert.doesNotMatch(mountEffect, /stopRuntimeRef\.current\(\)/);
  assert.match(mountEffect, /await refreshSnapshotRef\.current\(\)/);
  assert.doesNotMatch(warnings.join("\n"), /Open the (?:AIS|ADS-B) panel to start/);
  assert.match(warnings.join("\n"), /Select START SCANNING to begin live reception/);
});

test("interactive radio controls expose accessible names", async () => {
  const files = await Promise.all([
    readFile(new URL("../src/components/sigint.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/airband.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/maritime.tsx", import.meta.url), "utf8"),
  ]);
  const source = files.join("\n");

  for (const label of [
    "Search SIGINT captures",
    "Search loaded stations",
    "FM region",
    "FM country",
    "FM city",
    "Airband manual frequency",
    "Airband preset label",
    "Airband preset notes",
    "Airband sequential scan mode",
    "Airband random scan mode",
    "Maritime manual frequency",
    "Maritime preset label",
    "Maritime preset notes",
    "Maritime sequential scan mode",
    "Maritime random scan mode",
  ]) {
    assert.match(source, new RegExp(`aria-label=["']${label}["']`));
  }
});
