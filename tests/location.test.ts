import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCatalogScopeCaption,
  buildCatalogScopeFilters,
  buildCatalogScopeLabel,
  createEmptyCatalogScope,
  normalizeStoredAppLocation,
  resolveAppLocation,
} from "@/lib/location";
import type { GpsdSnapshot, StoredAppLocation } from "@/lib/types";

const catalogScope = {
  regionId: "europe",
  regionName: "Europe",
  countryId: "spain",
  countryCode: "ES",
  countryName: "Spain",
  cityId: "bilbao",
  cityName: "Bilbao",
  latitude: 43.263,
  longitude: -2.935,
};

test("catalog scope labels, captions and filters prefer the most specific configured scope", () => {
  assert.equal(buildCatalogScopeLabel(catalogScope), "Bilbao, ES");
  assert.equal(buildCatalogScopeCaption(catalogScope), "Bilbao in Spain");
  assert.deepEqual(buildCatalogScopeFilters(catalogScope), {
    regionFilter: "europe",
    countryFilter: "spain",
    cityFilter: "bilbao",
  });

  assert.equal(buildCatalogScopeCaption(createEmptyCatalogScope()), "Global");
});

test("normalizeStoredAppLocation trims strings and falls back invalid modes safely", () => {
  const normalized = normalizeStoredAppLocation({
    configured: true,
    sourceMode: "invalid",
    gpsdFallbackMode: "also-invalid",
    catalogScope: {
      ...catalogScope,
      cityName: " Bilbao ",
      latitude: "43.263",
    },
    mapPin: { latitude: 43.26, longitude: -2.93 },
    updatedAt: " 2026-01-01T00:00:00.000Z ",
  });

  assert.equal(normalized?.sourceMode, "catalog");
  assert.equal(normalized?.gpsdFallbackMode, "catalog");
  assert.equal(normalized?.catalogScope.cityName, "Bilbao");
  assert.equal(normalized?.catalogScope.latitude, null);
  assert.deepEqual(normalized?.mapPin, { latitude: 43.26, longitude: -2.93 });
  assert.equal(normalized?.updatedAt, "2026-01-01T00:00:00.000Z");
});

test("resolveAppLocation uses GPSD fixes and documented fallbacks", () => {
  const location: StoredAppLocation = {
    version: 2,
    configured: true,
    sourceMode: "gpsd",
    gpsdFallbackMode: "catalog",
    catalogScope,
    mapPin: { latitude: 40, longitude: -3 },
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const gpsFix: GpsdSnapshot = {
    available: true,
    host: "127.0.0.1",
    port: 2947,
    activeDevices: 1,
    fixState: "3d",
    mode: 3,
    latitude: 43.1,
    longitude: -2.9,
    altitudeMeters: null,
    speedMps: null,
    trackDeg: null,
    time: "2026-01-01T00:00:00.000Z",
    device: null,
    message: "ok",
  };

  assert.deepEqual(resolveAppLocation(location, gpsFix).resolvedPosition, { latitude: 43.1, longitude: -2.9 });

  const waitingGps: GpsdSnapshot = { ...gpsFix, fixState: "no-fix", mode: 1, latitude: null, longitude: null };
  const resolved = resolveAppLocation(location, waitingGps);
  assert.equal(resolved.sourceStatus, "ready");
  assert.deepEqual(resolved.resolvedPosition, { latitude: 43.263, longitude: -2.935 });
  assert.equal(resolved.sourceDetail, "GPSD waiting, using catalog fallback");
});
