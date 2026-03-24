import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const execFileAsync = promisify(execFile);

const RTE_FM_TABLE_URL = "https://2rn.ie/wp-content/uploads/2023/11/2RN_FM_table_Nov_2023_web.pdf";
const RTE_ANALOGUE_PAGE_URL = "https://2rn.ie/analogue-radio/";

const SERVICE_COLUMNS = [
  { offset: 1, stationName: "RTÉ Radio 1" },
  { offset: 2, stationName: "RTÉ 2FM" },
  { offset: 3, stationName: "RTÉ Raidió na Gaeltachta" },
  { offset: 4, stationName: "RTÉ lyric fm" },
];

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

async function extractPdfText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download 2RN FM table PDF: HTTP ${res.status}`);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hackrf-webui-ie-"));
  const pdfPath = path.join(tempDir, "source.pdf");

  try {
    await fs.writeFile(pdfPath, Buffer.from(await res.arrayBuffer()));
    const { stdout } = await execFileAsync("pdftotext", ["-layout", pdfPath, "-"]);
    return stdout;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function splitColumns(line) {
  return String(line ?? "")
    .replace(/\f/g, "")
    .split(/\s{2,}/)
    .map(normalizeText)
    .filter(Boolean);
}

function parseRows(text) {
  const rows = [];
  let sectionLabel = "";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = normalizeText(rawLine);
    if (
      !line ||
      line === "FM RADIO NETWORK" ||
      line.startsWith("RTÉ") ||
      line.startsWith("(All frequencies") ||
      line.startsWith("November")
    ) {
      continue;
    }

    if (line === "Main Stations" || line === "Relay Stations") {
      sectionLabel = line;
      continue;
    }

    const parts = splitColumns(rawLine);
    if (parts.length < 2 || !sectionLabel) {
      continue;
    }

    const cityName = parts[0];
    for (const service of SERVICE_COLUMNS) {
      const value = parts[service.offset] ?? "";
      if (!value || value === "----") {
        continue;
      }

      const freqMhz = normalizeFreqMhz(value.replace(",", "."));
      if (!Number.isFinite(freqMhz)) {
        continue;
      }

      rows.push({
        cityName,
        freqMhz,
        sectionLabel,
        stationName: service.stationName,
      });
    }
  }

  return rows;
}

function buildDescription({ cityName, freqMhz, sectionLabel, stationName }) {
  return [
    `2RN FM network site listed in the official Irish FM table for ${cityName}.`,
    `Station: ${stationName}.`,
    `Site class: ${sectionLabel}.`,
    `Frequency: ${freqMhz.toFixed(1)} MHz.`,
  ].join(" ");
}

export async function loadRteIeStations() {
  const text = await extractPdfText(RTE_FM_TABLE_URL);
  const rows = parseRows(text);
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const row of rows) {
    const dedupeKey = `${row.cityName}|${row.stationName}|${row.freqMhz.toFixed(3)}`;
    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.set(dedupeKey, {
      cityName: row.cityName,
      countryCode: "IE",
      curated: false,
      description: buildDescription(row),
      freqMhz: row.freqMhz,
      name: row.stationName,
      source: "2RN FM radio network table",
      sourceUrl: RTE_ANALOGUE_PAGE_URL,
      tags: [
        "fm",
        "official",
        "ireland",
        "2rn",
        toTag(row.sectionLabel),
        toTag(row.stationName),
      ],
      timezone: "Europe/Dublin",
      verifiedAt,
    });
  }

  return [...dedupe.values()];
}
