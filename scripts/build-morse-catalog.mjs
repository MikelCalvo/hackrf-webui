#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const SOURCE_URL = "https://davidmegginson.github.io/ourairports-data/navaids.csv";
const SOURCE_PAGE = "https://ourairports.com/data/";
const LICENSE_URL = "https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/LICENSE";
const OUTPUT_ROOT = path.resolve("public/morse");
const COUNTRY_ROOT = path.join(OUTPUT_ROOT, "countries");
const INCLUDED_TYPES = new Set(["VOR", "VOR-DME", "VORTAC"]);
const COUNTRY_NAMES = new Intl.DisplayNames(["en"], { type: "region" });

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const headers = rows.shift();
  if (!headers) return [];
  return rows.filter((values) => values.length === headers.length).map((values) => Object.fromEntries(headers.map((header, i) => [header, values[i]])));
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stableEntry(row, fetchedAt) {
  const frequencyKhz = finiteNumber(row.frequency_khz);
  const latitude = finiteNumber(row.latitude_deg);
  const longitude = finiteNumber(row.longitude_deg);
  if (!row.id || !row.ident || !row.iso_country || !INCLUDED_TYPES.has(row.type)) return null;
  if (frequencyKhz === null || frequencyKhz < 108_000 || frequencyKhz > 117_950) return null;
  if (latitude === null || latitude < -90 || latitude > 90 || longitude === null || longitude < -180 || longitude > 180) return null;
  const frequencyHz = Math.round(frequencyKhz * 1_000);
  return {
    id: `ourairports-${row.id}`,
    kind: "navigation-aid",
    sourceClass: "aeronautical-information",
    name: `${row.ident} ${row.name} ${row.type} (${(frequencyHz / 1_000_000).toFixed(3)} MHz)`,
    identifier: row.ident.trim().toUpperCase(),
    frequencyHz,
    frontEnd: "am_tone",
    applicability: "countries",
    iaruRegions: [],
    countryCodes: [row.iso_country],
    location: { latitude, longitude },
    schedule: "Published navigation-aid record; operational availability is not guaranteed. Check the current AIP and NOTAM.",
    provenance: {
      authority: "OurAirports open aviation data",
      url: SOURCE_PAGE,
      publishedOrEffectiveDate: fetchedAt.slice(0, 10),
      verifiedDate: fetchedAt.slice(0, 10),
      format: "CSV",
      classification: "curated",
      license: "Public Domain",
      licenseUrl: LICENSE_URL,
      sourceRecordId: row.id,
    },
  };
}

async function sourceBytes() {
  const fixture = process.env.MORSE_NAVAIDS_CSV;
  if (fixture) return readFile(fixture);
  const response = await fetch(SOURCE_URL, { headers: { "User-Agent": "hackrf-webui-morse-catalog/1.0" } });
  if (!response.ok) throw new Error(`Failed to download navaids.csv (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

const data = await sourceBytes();
const fetchedAt = new Date().toISOString();
const checksum = createHash("sha256").update(data).digest("hex");
const rows = parseCsv(data.toString("utf8"));
const byCountry = new Map();
for (const row of rows) {
  const entry = stableEntry(row, fetchedAt);
  if (!entry) continue;
  const code = entry.countryCodes[0];
  const entries = byCountry.get(code) ?? [];
  entries.push(entry);
  byCountry.set(code, entries);
}

await rm(OUTPUT_ROOT, { recursive: true, force: true });
await mkdir(COUNTRY_ROOT, { recursive: true });
const countries = [];
let entryCount = 0;
for (const [code, entries] of [...byCountry].sort(([a], [b]) => a.localeCompare(b))) {
  entries.sort((a, b) => a.name.localeCompare(b.name) || a.frequencyHz - b.frequencyHz || a.id.localeCompare(b.id));
  entryCount += entries.length;
  const name = COUNTRY_NAMES.of(code) || code;
  const shardUrl = `/morse/countries/${code}.json`;
  const shard = {
    schemaVersion: 1,
    generatedAt: fetchedAt,
    country: { code, name, entryCount: entries.length },
    source: { name: "OurAirports navaids.csv", url: SOURCE_URL, pageUrl: SOURCE_PAGE, license: "Public Domain", licenseUrl: LICENSE_URL, fetchedAt, sha256: checksum },
    entries,
  };
  await writeFile(path.join(COUNTRY_ROOT, `${code}.json`), `${JSON.stringify(shard)}\n`);
  countries.push({ code, name, entryCount: entries.length, shardUrl, sourceQuality: "curated-global", lastImportedAt: fetchedAt.slice(0, 10) });
}
const manifest = {
  schemaVersion: 1,
  generatedAt: fetchedAt,
  source: { name: "OurAirports navaids.csv", url: SOURCE_URL, pageUrl: SOURCE_PAGE, license: "Public Domain", licenseUrl: LICENSE_URL, fetchedAt, sha256: checksum },
  countries,
  stats: { countryCount: countries.length, entryCount },
  caution: "Catalog records are discovery data, not real-time operational status. Verify the current national AIP and NOTAM before operational use.",
};
await writeFile(path.join(OUTPUT_ROOT, "manifest.json"), `${JSON.stringify(manifest)}\n`);
console.log(`MORSE catalog: ${entryCount} VOR/VOR-DME/VORTAC records across ${countries.length} countries`);
