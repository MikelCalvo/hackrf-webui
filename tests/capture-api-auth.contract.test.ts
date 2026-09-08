import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePaths = [
  "src/app/api/activity-events/route.ts",
  "src/app/api/adsb/route.ts",
  "src/app/api/adsb/history/route.ts",
  "src/app/api/ais/route.ts",
  "src/app/api/ais/history/route.ts",
  "src/app/api/capture-files/[fileId]/route.ts",
  "src/app/api/hardware/route.ts",
  "src/app/api/location/gpsd/route.ts",
  "src/app/api/location/maps/route.ts",
  "src/app/api/sigint/captures/route.ts",
  "src/app/api/sigint/captures/[captureSessionId]/route.ts",
  "src/app/api/sigint/routes/route.ts",
  "src/app/api/spectrum/route.ts",
];

test("sensitive evidence, receiver, and tracking APIs authorize before data access", async () => {
  const sources = await Promise.all(
    routePaths.map(async (routePath) => ({
      routePath,
      source: await readFile(new URL(`../${routePath}`, import.meta.url), "utf8"),
    })),
  );

  for (const { routePath, source } of sources) {
    assert.match(source, /authorizeApiRequest/);
    assert.match(source, /sensitive:\s*true/);
    assert.match(source, /export async function GET/);

    const routeSource = source.slice(source.indexOf("export async function GET"));
    const authorizeMatch = /const authFailure = authorizeApiRequest[\s\S]*?if \(authFailure\)[\s\S]*?return authFailure;/.exec(routeSource);
    assert.ok(authorizeMatch, `${routePath} returns authorization failures`);

    const dataAccessIndex = routeSource.search(
      /appDb|listSigintCaptureSummaries|getSigintCaptureDetail|listActivityEvents|adsbService|aisService|hackrfService|readGpsdSnapshot|buildOfflineMapSummary|listAisTrackHistory|listAdsbTrackHistory|listSigintTrackSummaries/,
    );
    assert.ok(dataAccessIndex > (authorizeMatch?.index ?? Number.POSITIVE_INFINITY), `${routePath} authorizes before data access`);
  }
});
