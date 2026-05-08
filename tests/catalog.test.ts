import test from "node:test";
import assert from "node:assert/strict";

import { buildCatalogData, buildCustomStation, hydrateCountryShard, sortStations } from "@/lib/catalog";
import type { CatalogCountryShard, CatalogManifest, SeedFmStation } from "@/lib/types";

const regions = [
  { id: "europe", name: "Europe", sortOrder: 20 },
  { id: "americas", name: "Americas", sortOrder: 10 },
];
const countries = [
  { id: "spain", code: "ES", name: "Spain", regionId: "europe" },
  { id: "canada", code: "CA", name: "Canada", regionId: "americas" },
];
const cities = [
  { id: "bilbao", name: "Bilbao", countryId: "spain", timezone: "Europe/Madrid", latitude: 43.263, longitude: -2.935 },
  { id: "toronto", name: "Toronto", countryId: "canada", timezone: "America/Toronto", latitude: 43.653, longitude: -79.383 },
];
const stations: SeedFmStation[] = [
  {
    id: "radio-b",
    name: "Beta",
    freqMhz: 101.2,
    cityId: "bilbao",
    description: "Beta station",
    tags: ["test"],
    source: "fixture",
    verifiedAt: "2026-01-01",
    curated: true,
  },
  {
    id: "radio-a",
    name: "Alpha",
    freqMhz: 88.1,
    cityId: "toronto",
    description: "Alpha station",
    tags: ["test"],
    source: "fixture",
    verifiedAt: "2026-01-01",
    curated: true,
  },
];

test("buildCatalogData enriches station locations and applies stable sorting", () => {
  const data = buildCatalogData({ regions, countries, cities, stations });

  assert.deepEqual(data.regions.map((region) => region.id), ["americas", "europe"]);
  assert.deepEqual(data.countries.map((country) => country.id), ["canada", "spain"]);
  assert.deepEqual(data.stations.map((station) => station.id), ["radio-a", "radio-b"]);
  assert.deepEqual(data.stations[1].location, {
    regionId: "europe",
    regionName: "Europe",
    countryId: "spain",
    countryName: "Spain",
    countryCode: "ES",
    cityId: "bilbao",
    cityName: "Bilbao",
    label: "Bilbao, Spain",
  });
});

test("sortStations orders by location, frequency and then name without mutating input", () => {
  const data = buildCatalogData({ regions, countries, cities, stations });
  const reversed = [...data.stations].reverse();
  const sorted = sortStations(reversed);

  assert.deepEqual(sorted.map((station) => station.id), ["radio-a", "radio-b"]);
  assert.deepEqual(reversed.map((station) => station.id), ["radio-b", "radio-a"]);
});

test("hydrateCountryShard strips manifest summaries before enriching shard stations", () => {
  const manifest: CatalogManifest = {
    generatedAt: "2026-01-01T00:00:00.000Z",
    regions,
    countries: [
      {
        ...countries[0],
        cityCount: 1,
        stationCount: 1,
        coverageTier: "manual-seed",
        sourceQuality: "manual-curated",
        coverageStatus: "manual",
        coverageScope: "city-seed",
        coverageScore: 10,
        sourceCount: 1,
        sources: [{ name: "fixture" }],
        hasOfficialImporter: false,
      },
    ],
    stats: {
      totalCountries: 1,
      totalCities: 1,
      totalStations: 1,
      byCoverageStatus: { manual: 1 },
    },
  };
  const shard: CatalogCountryShard = {
    country: manifest.countries[0],
    cities: [{ ...cities[0], stationCount: 1 }],
    stations: [stations[0]],
  };

  const hydrated = hydrateCountryShard(manifest, shard);
  assert.equal(hydrated.countries[0].name, "Spain");
  assert.equal(hydrated.stations[0].location.countryCode, "ES");
});

test("buildCustomStation matches countries by name or code and generates local fallback ids", () => {
  const custom = buildCustomStation(
    { name: "  My FM ", freqMhz: "99.7", country: " es ", city: " Bilbao ", description: "" },
    { regions, countries },
  );

  assert.equal(custom.name, "My FM");
  assert.equal(custom.freqMhz, 99.7);
  assert.equal(custom.location.countryName, "Spain");
  assert.equal(custom.location.countryCode, "ES");
  assert.equal(custom.location.regionName, "Europe");
  assert.match(custom.id, /^custom-es-bilbao-my-fm-/);
});
