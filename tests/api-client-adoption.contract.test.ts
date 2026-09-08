import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const protectedClientPaths = [
  "src/components/adsb.tsx",
  "src/components/ais.tsx",
  "src/components/dashboard.tsx",
  "src/components/location-modal.tsx",
  "src/components/sigint.tsx",
  "src/components/spectrum-dock.tsx",
  "src/lib/activity-events.ts",
  "src/lib/sigint.ts",
];

test("browser clients use apiFetch for token-protected receiver APIs", async () => {
  for (const path of protectedClientPaths) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");

    assert.match(source, /apiFetch/, `${path} imports or calls the authenticated API client`);
    assert.doesNotMatch(source, /fetch\("\/api\//, `${path} has no unauthenticated static API fetches`);
  }
});
