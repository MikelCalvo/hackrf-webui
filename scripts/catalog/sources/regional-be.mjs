import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const execFileAsync = promisify(execFile);

const FLANDERS_FM_URL =
  "https://www.vlaanderen.be/cjm/sites/default/files/2020-07/erkende-lokale-radios_noodfonds.pdf";

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseBelgianNumber(value) {
  const normalized = normalizeText(value).replace(",", ".");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : NaN;
}

async function extractPdfText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download Belgian FM PDF: HTTP ${res.status}`);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hackrf-webui-be-"));
  const pdfPath = path.join(tempDir, "source.pdf");

  try {
    await fs.writeFile(pdfPath, Buffer.from(await res.arrayBuffer()));
    const { stdout } = await execFileAsync("pdftotext", ["-layout", pdfPath, "-"]);
    return stdout;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function extractFlandersPairs(locationBlock) {
  const pairPattern =
    /([\p{Letter}\p{Mark}0-9'"“”«»()./&+\- ]+?)\s+(\d{2,3}(?:,\d+)?)\s*FM\b/gu;
  const pairs = [];

  for (const match of locationBlock.matchAll(pairPattern)) {
    const cityName = normalizeText(match[1]);
    const freqMhz = normalizeFreqMhz(parseBelgianNumber(match[2]));
    if (!cityName || !Number.isFinite(freqMhz)) {
      continue;
    }
    pairs.push({ cityName, freqMhz });
  }

  return pairs;
}

function buildDescription({ cityName, stationName, address }) {
  return [
    `Flemish local FM package listed by the Flemish government for ${cityName}.`,
    stationName ? `Brand: ${stationName}.` : "",
    address ? `Registered seat: ${address}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function loadRegionalBeStations() {
  const text = await extractPdfText(FLANDERS_FM_URL);
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const line of text.split(/\r?\n/)) {
    const rowMatch = line.match(/^FP\s+\d+\s+-\s+(.+?)\s{2,}(.+?)\s{2,}(.+)$/u);
    if (!rowMatch) {
      continue;
    }

    const [, locationBlock, stationNameRaw, addressRaw] = rowMatch;
    const stationName = normalizeText(stationNameRaw);
    const address = normalizeText(addressRaw);
    if (!stationName) {
      continue;
    }

    for (const pair of extractFlandersPairs(locationBlock)) {
      const dedupeKey = `${pair.cityName}|${stationName}|${pair.freqMhz.toFixed(3)}`;
      if (dedupe.has(dedupeKey)) {
        continue;
      }

      dedupe.set(dedupeKey, {
        cityName: pair.cityName,
        countryCode: "BE",
        curated: false,
        description: buildDescription({
          address,
          cityName: pair.cityName,
          stationName,
        }),
        freqMhz: pair.freqMhz,
        name: stationName,
        source: "Vlaamse overheid local FM packages",
        sourceUrl: FLANDERS_FM_URL,
        tags: [
          "fm",
          "official",
          "belgium",
          "flanders",
          "regional-import",
          toTag(stationName),
        ],
        timezone: "Europe/Brussels",
        verifiedAt,
      });
    }
  }

  return [...dedupe.values()];
}
