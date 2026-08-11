import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildMorseScanPlan,
  filterMorseCatalog,
  type MorseCatalogEntry,
} from "@/lib/morse-catalog";

const source = {
  authority: "Test",
  url: "https://example.test",
  publishedOrEffectiveDate: "2026-01-01",
  verifiedDate: "2026-08-11",
  format: "CSV" as const,
  classification: "curated" as const,
};

function entry(overrides: Partial<MorseCatalogEntry>): MorseCatalogEntry {
  return {
    id: "test",
    kind: "navigation-aid",
    sourceClass: "aeronautical-information",
    name: "Test",
    identifier: "TST",
    frequencyHz: 113_000_000,
    frontEnd: "am_tone",
    applicability: "countries",
    iaruRegions: [],
    countryCodes: ["ES"],
    location: { latitude: 40, longitude: -3 },
    provenance: source,
    ...overrides,
  };
}

test("country filtering includes only the selected country plus explicitly global entries", () => {
  const rows = [
    entry({ id: "es", countryCodes: ["ES"] }),
    entry({ id: "fr", countryCodes: ["FR"] }),
    entry({ id: "global", applicability: "global", countryCodes: [] }),
    entry({ id: "unknown", applicability: "unknown", countryCodes: [] }),
  ];
  assert.deepEqual(filterMorseCatalog(rows, { countryCode: "ES" }).map((item) => item.id), ["es", "global"]);
});

test("scan plans deduplicate frequency and frontend, prefer identified entries, and cap the deck", () => {
  const rows = [
    entry({ id: "weak", identifier: null }),
    entry({ id: "identified", identifier: "TST" }),
    entry({ id: "other-frontend", frontEnd: "cw_carrier" }),
    entry({ id: "other-frequency", frequencyHz: 114_000_000 }),
  ];
  const fullPlan = buildMorseScanPlan(rows, 10);
  assert.equal(fullPlan.channels.length, 3);
  assert.ok(fullPlan.channels.some((channel) => channel.id === "morse:identified"));
  assert.ok(!fullPlan.channels.some((channel) => channel.id === "morse:weak"));
  const limitedPlan = buildMorseScanPlan(rows, 2);
  assert.equal(limitedPlan.channels.length, 2);
  assert.equal(limitedPlan.excludedByLimit, 1);
});

test("the generated worldwide catalog has broad country coverage and valid point records", () => {
  const manifest = JSON.parse(readFileSync("public/morse/manifest.json", "utf8")) as {
    countries: Array<{ code: string; entryCount: number; shardUrl: string }>;
    stats: { countryCount: number; entryCount: number };
  };
  assert.ok(manifest.stats.countryCount >= 150);
  assert.ok(manifest.stats.entryCount >= 2_000);
  for (const code of ["ES", "FR", "GB", "US", "CA", "AU", "JP", "PT", "DE", "IT", "NL"]) {
    assert.ok(manifest.countries.some((country) => country.code === code && country.entryCount > 0), code);
  }

  const spain = JSON.parse(readFileSync("public/morse/countries/ES.json", "utf8")) as {
    entries: MorseCatalogEntry[];
  };
  assert.ok(spain.entries.length >= 20);
  for (const item of spain.entries) {
    assert.ok(Number.isInteger(item.frequencyHz));
    assert.ok(item.identifier);
    assert.equal(item.frontEnd, "am_tone");
    assert.deepEqual(item.countryCodes, ["ES"]);
  }
});
