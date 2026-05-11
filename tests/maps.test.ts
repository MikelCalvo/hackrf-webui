import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildOfflineMapSummary } from "@/server/maps";

test("buildOfflineMapSummary falls back to live tiles when manifest is missing", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "hackrf-webui-maps-test-"));
  const manifestPath = path.join(workspace, "missing.json");
  const warnings: string[] = [];

  try {
    const summary = buildOfflineMapSummary(warnings, manifestPath);

    assert.equal(summary.available, false);
    assert.equal(summary.mode, "remote-live");
    assert.equal(summary.tileUrlTemplate, "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    assert.equal(summary.manifestPath, null);
    assert.match(warnings.join("\n"), /Offline maps are not installed/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("buildOfflineMapSummary falls back safely when manifest is invalid", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "hackrf-webui-maps-test-"));
  const manifestPath = path.join(workspace, "manifest.json");
  const warnings: string[] = [];

  try {
    await writeFile(manifestPath, "not-json", "utf8");
    const summary = buildOfflineMapSummary(warnings, manifestPath);

    assert.equal(summary.available, false);
    assert.equal(summary.mode, "remote-live");
    assert.equal(summary.manifestPath, manifestPath);
    assert.match(warnings.join("\n"), /could not be parsed/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("buildOfflineMapSummary normalizes local PMTiles layers and merged bounds", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "hackrf-webui-maps-test-"));
  const manifestPath = path.join(workspace, "manifest.json");
  const warnings: string[] = [];

  try {
    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        name: "Local pack",
        installedAt: "2026-01-01T00:00:00.000Z",
        layers: [
          {
            id: "global-dark",
            role: "global",
            kind: "pmtiles",
            name: "Global dark",
            pmtilesUrl: "/tiles/osm/global/world.pmtiles",
            flavor: "black",
            minZoom: 1,
            maxZoom: 8,
            bounds: { west: -10, south: 35, east: 5, north: 45 },
          },
          {
            id: "es",
            role: "country",
            countryId: "es",
            countryName: "Spain",
            kind: "pmtiles",
            pmtilesUrl: "/tiles/osm/countries/es.pmtiles",
            minZoom: 4,
            maxZoom: 14,
            bounds: { west: -9.4, south: 35.9, east: 3.4, north: 43.8 },
          },
        ],
      }),
      "utf8",
    );

    const summary = buildOfflineMapSummary(warnings, manifestPath);

    assert.equal(summary.available, true);
    assert.equal(summary.mode, "local-pack");
    assert.equal(summary.kind, "pmtiles");
    assert.equal(summary.name, "Local pack");
    assert.equal(summary.countryLayerCount, 1);
    assert.equal(summary.pmtilesUrl, "/tiles/osm/global/world.pmtiles");
    assert.equal(summary.flavor, "black");
    assert.equal(summary.minZoom, 1);
    assert.equal(summary.maxZoom, 14);
    assert.deepEqual(summary.bounds, { west: -10, south: 35, east: 5, north: 45 });
    assert.deepEqual(warnings, []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
