import test from "node:test";
import assert from "node:assert/strict";

import {
  HACKRF_ONE_FREQUENCY_RANGE_HZ,
  filterMorseCatalog,
  haversineDistanceKm,
  rankMorseCatalog,
  toMorseRadioSessionChannels,
  withHackrfCompatibility,
} from "@/lib/morse-catalog";
import { INITIAL_MORSE_CATALOG } from "@/data/morse/initial-catalog";
import type { MorseCatalogEntry } from "@/lib/morse-catalog";

const provenance = {
  authority: "Test authority",
  url: "https://example.test/source",
  publishedOrEffectiveDate: "2026-01-01",
  verifiedDate: "2026-08-11",
  format: "HTML" as const,
  classification: "legal" as const,
};

function pointEntry(overrides: Partial<MorseCatalogEntry> = {}): MorseCatalogEntry {
  return {
    id: "test-point",
    kind: "beacon",
    sourceClass: "beacon",
    name: "Test point",
    frequencyHz: 14_100_000,
    iaruRegions: ["1"],
    countryCodes: ["ES"],
    provenance,
    ...overrides,
  };
}

test("haversineDistanceKm measures a one-degree equatorial separation", () => {
  assert.ok(Math.abs(haversineDistanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }) - 111.195) < 0.01);
});

test("rankMorseCatalog uses a resolved app position and leaves entries without a point after nearby entries", () => {
  const ranked = rankMorseCatalog(
    [
      pointEntry({ id: "far", location: { latitude: 42, longitude: -3 } }),
      pointEntry({ id: "near", location: { latitude: 40.1, longitude: -3 } }),
      pointEntry({ id: "regional-cw", kind: "amateur-cw-segment", sourceClass: "amateur-band-plan", frequencyHz: null }),
    ],
    {
      configured: true,
      sourceMode: "map",
      gpsdFallbackMode: "none",
      catalogScope: { regionId: null, regionName: null, countryId: null, countryCode: "ES", countryName: "Spain", cityId: null, cityName: null, latitude: null, longitude: null },
      mapPin: { latitude: 40, longitude: -3 },
      resolvedPosition: { latitude: 40, longitude: -3 },
      sourceStatus: "ready",
      sourceDetail: "test",
    },
  );

  assert.deepEqual(ranked.map(({ entry }) => entry.id), ["near", "far", "regional-cw"]);
  assert.equal(ranked[0].distanceKm, 11.12);
  assert.equal(ranked[2].distanceKm, null);
});

test("withHackrfCompatibility includes the official one MHz to six GHz endpoints and preserves a reason for exclusions", () => {
  const compatibility = withHackrfCompatibility([
    pointEntry({ id: "low", frequencyHz: HACKRF_ONE_FREQUENCY_RANGE_HZ.minHz }),
    pointEntry({ id: "high", frequencyHz: HACKRF_ONE_FREQUENCY_RANGE_HZ.maxHz }),
    pointEntry({ id: "too-low", frequencyHz: 999_999 }),
    pointEntry({ id: "segment", kind: "amateur-cw-segment", sourceClass: "amateur-band-plan", frequencyHz: null }),
  ]);

  assert.deepEqual(compatibility.map(({ compatible }) => compatible), [true, true, false, false]);
  assert.match(compatibility[2].incompatibilityReason ?? "", /1 MHz.*6 GHz/);
  assert.match(compatibility[3].incompatibilityReason ?? "", /point frequency/i);
});

test("filterMorseCatalog narrows by source class, IARU region, and country without discarding global entries", () => {
  const globalBeacon = pointEntry({ id: "global", applicability: "global", iaruRegions: [], countryCodes: [] });
  const selected = filterMorseCatalog(
    [pointEntry({ id: "r1-es" }), pointEntry({ id: "r2-us", iaruRegions: ["2"], countryCodes: ["US"] }), globalBeacon],
    { sourceClasses: ["beacon"], iaruRegion: "1", countryCode: "ES" },
  );

  assert.deepEqual(selected.map((entry) => entry.id), ["r1-es", "global"]);
});

test("toMorseRadioSessionChannels converts compatible point frequencies into exact deck-safe MHz entries", () => {
  const channels = toMorseRadioSessionChannels(withHackrfCompatibility([
    pointEntry({ id: "beacon", frequencyHz: 14_100_000, name: "IBP 14.100 MHz" }),
    pointEntry({ id: "unavailable", frequencyHz: 500_000 }),
    pointEntry({ id: "segment", kind: "amateur-cw-segment", sourceClass: "amateur-band-plan", frequencyHz: null }),
  ]));

  assert.deepEqual(channels, [{
    id: "morse:beacon",
    bandId: "morse-catalog",
    number: 1,
    freqMhz: 14.1,
    label: "IBP 14.100 MHz",
    notes: "MORSE catalog: beacon",
    expectedIdentifier: null,
    catalogSource: "Test authority",
    catalogRecordId: "beacon",
    catalogVersion: "2026-01-01",
  }]);
});

test("starter catalog remains small and auditable while worldwide point data lives in country shards", () => {
  assert.ok(INITIAL_MORSE_CATALOG.length > 8);
  assert.ok(INITIAL_MORSE_CATALOG.length < 40);
  assert.ok(INITIAL_MORSE_CATALOG.some((entry) => entry.kind === "amateur-cw-segment"));
  assert.ok(INITIAL_MORSE_CATALOG.some((entry) => entry.kind === "beacon"));
  assert.ok(INITIAL_MORSE_CATALOG.some((entry) => entry.kind === "navigation-aid"));
  for (const entry of INITIAL_MORSE_CATALOG) {
    assert.match(entry.provenance.url, /^https:\/\//);
    assert.ok(entry.provenance.authority);
    assert.ok(entry.provenance.publishedOrEffectiveDate);
    assert.ok(entry.provenance.verifiedDate);
  }
});
