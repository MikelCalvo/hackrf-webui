import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { compareText, normalizeKey, toTag } from "../lib/utils.mjs";

const execFileAsync = promisify(execFile);

const CONATEL_COMMERCIAL_URL =
  "https://www.conatel.gov.py/conatel/wp-content/uploads/2025/04/servicio-de-radiodifusion-sonora-por-modulacion-de-frecuencia_fm-comercial-14.04.25.pdf";
const CONATEL_COMMUNITY_URL =
  "https://www.conatel.gov.py/wp-content/uploads/2025/08/Servicio-Radiodifusion-Sonora-de-Pequena-y-Mediana-Cobertura-25.07.2025.pdf";

const COMMERCIAL_COLUMNS = [
  { id: "rowNumber", min: 0, max: 135 },
  { id: "callsign", min: 135, max: 175 },
  { id: "station", min: 175, max: 245 },
  { id: "licensee", min: 245, max: 336 },
  { id: "freq", min: 336, max: 359 },
  { id: "power", min: 359, max: 382 },
  { id: "department", min: 382, max: 443.5 },
  { id: "locality", min: 443.5, max: 500 },
  { id: "address", min: 500, max: 670 },
  { id: "phone", min: 670, max: Infinity },
];

const COMMUNITY_COLUMNS = [
  { id: "rowNumber", min: 0, max: 40 },
  { id: "callsign", min: 40, max: 72 },
  { id: "station", min: 72, max: 132 },
  { id: "authorized", min: 132, max: 245 },
  { id: "freq", min: 245, max: 269 },
  { id: "address", min: 269, max: 384 },
  { id: "responsible", min: 384, max: 455 },
  { id: "phone", min: 455, max: 521 },
  { id: "resolution", min: 521, max: 559 },
  { id: "date", min: 559, max: 595 },
  { id: "locality", min: 595, max: 646 },
  { id: "department", min: 646, max: Infinity },
];

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLocaleNumber(value) {
  let raw = normalizeText(value);
  if (!raw) {
    return NaN;
  }

  if (raw.includes(",") && raw.includes(".")) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  } else if (raw.includes(",")) {
    raw = raw.replace(",", ".");
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function extractPrimaryCity(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return "";
  }

  const cleaned = raw.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const parts = cleaned.split(/\s*(?:\/|;|\||,)\s*/);
  return normalizeText(parts[0] || cleaned);
}

function buildAdmin1Code(departmentName) {
  return `PY-${toTag(departmentName).toUpperCase()}`;
}

function sortWords(words) {
  return [...words].sort((left, right) => {
    if (left.page !== right.page) {
      return left.page - right.page;
    }

    if (Math.abs(left.top - right.top) > 0.2) {
      return left.top - right.top;
    }

    return left.left - right.left;
  });
}

function parseTsvWords(tsvText) {
  const pages = new Map();

  for (const line of String(tsvText || "").split(/\r?\n/)) {
    if (!line) {
      continue;
    }

    const parts = line.split("\t");
    if (parts[0] !== "5") {
      continue;
    }

    const page = Number(parts[1]);
    const left = Number(parts[6]);
    const top = Number(parts[7]);
    const text = normalizeText(parts[11]);

    if (!Number.isFinite(page) || !Number.isFinite(left) || !Number.isFinite(top) || !text) {
      continue;
    }

    const pageWords = pages.get(page) || [];
    pageWords.push({ page, left, top, text });
    pages.set(page, pageWords);
  }

  for (const [page, words] of pages.entries()) {
    pages.set(page, sortWords(words));
  }

  return pages;
}

function buildRecords(pages, config) {
  const records = [];

  const pageNumbers = [...pages.keys()].sort((left, right) => left - right);
  for (const pageNumber of pageNumbers) {
    const words = pages.get(pageNumber) || [];
    const rowStarts = words.filter((word) => config.isRowStart(word));
    if (rowStarts.length === 0) {
      continue;
    }

    for (let index = 0; index < rowStarts.length; index += 1) {
      const rowStart = rowStarts[index];
      const previous = rowStarts[index - 1];
      const next = rowStarts[index + 1];
      const lowerBound = previous
        ? (previous.top + rowStart.top) / 2
        : config.continuationMinTop;
      const upperBound = next
        ? (rowStart.top + next.top) / 2
        : Infinity;

      const rowWords = words.filter(
        (word) => word.top >= lowerBound && word.top < upperBound,
      );

      records.push({
        rowNumber: rowStart.text,
        words: rowWords,
      });
    }
  }

  return records;
}

function assignColumns(words, columns) {
  const buckets = new Map(columns.map((column) => [column.id, []]));

  for (const word of sortWords(words)) {
    const column = columns.find((candidate) => word.left >= candidate.min && word.left < candidate.max);
    if (!column) {
      continue;
    }

    buckets.get(column.id)?.push(word.text);
  }

  return Object.fromEntries(
    [...buckets.entries()].map(([key, values]) => [key, normalizeText(values.join(" "))]),
  );
}

async function downloadPdf(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download CONATEL PDF: HTTP ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

async function extractPdfTsv(buffer, fileName) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hackrf-webui-conatel-"));
  const pdfPath = path.join(tempDir, fileName);

  try {
    await fs.writeFile(pdfPath, buffer);
    const { stdout } = await execFileAsync("pdftotext", ["-tsv", pdfPath, "-"], {
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("pdftotext is required to parse the official CONATEL PDFs");
    }
    throw error;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function buildCommercialDescription(row, cityName, departmentName, powerKw) {
  const parts = [
    `FM commercial station listed by CONATEL for ${cityName}, ${departmentName}.`,
    row.callsign ? `Callsign: ${row.callsign}.` : "",
    row.licensee ? `Licensee: ${row.licensee}.` : "",
    Number.isFinite(powerKw) ? `Authorized power: ${powerKw.toFixed(3).replace(/\.?0+$/, "")} kW.` : "",
    row.address ? `Studio address: ${row.address}.` : "",
  ];

  return parts.filter(Boolean).join(" ");
}

function buildCommunityDescription(row, cityName, departmentName) {
  const parts = [
    `FM community station listed by CONATEL for ${cityName}, ${departmentName}.`,
    row.callsign ? `Callsign: ${row.callsign}.` : "",
    row.authorized ? `Authorized entity: ${row.authorized}.` : "",
    row.responsible ? `Responsible contact: ${row.responsible}.` : "",
    row.resolution ? `Resolution: ${row.resolution}${row.date ? ` (${row.date})` : ""}.` : "",
    row.address ? `Studio address: ${row.address}.` : "",
  ];

  return parts.filter(Boolean).join(" ");
}

function mapCommercialRecords(records, verifiedAt) {
  const dedupe = new Map();

  for (const record of records) {
    const row = assignColumns(record.words, COMMERCIAL_COLUMNS);
    const callsign = normalizeText(row.callsign);
    const stationName = normalizeText(row.station);
    const departmentName = normalizeText(row.department);
    const localityRaw = normalizeText(row.locality);
    const cityName = extractPrimaryCity(localityRaw);
    const freqMhz = parseLocaleNumber(row.freq);
    const powerKw = parseLocaleNumber(row.power);

    if (!callsign || !stationName || !departmentName || !cityName || !Number.isFinite(freqMhz)) {
      continue;
    }

    const admin1Code = buildAdmin1Code(departmentName);
    const dedupeKey = [
      "commercial",
      callsign,
      normalizeKey(stationName),
      admin1Code,
      normalizeKey(cityName),
      freqMhz.toFixed(3),
    ].join("|");

    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.set(dedupeKey, {
      admin1Code,
      cityName,
      countryCode: "PY",
      curated: false,
      description: buildCommercialDescription(row, cityName, departmentName, powerKw),
      freqMhz: Number.parseFloat(freqMhz.toFixed(3)),
      name: stationName,
      source: "CONATEL FM Comercial register",
      sourceUrl: CONATEL_COMMERCIAL_URL,
      tags: [
        "fm",
        "official",
        "conatel",
        "paraguay",
        "commercial",
        toTag(departmentName),
      ],
      verifiedAt,
    });
  }

  return [...dedupe.values()];
}

function mapCommunityRecords(records, verifiedAt) {
  const dedupe = new Map();

  for (const record of records) {
    const row = assignColumns(record.words, COMMUNITY_COLUMNS);
    const callsign = normalizeText(row.callsign);
    const stationName = normalizeText(row.station);
    const departmentName = normalizeText(row.department);
    const localityRaw = normalizeText(row.locality);
    const cityName = extractPrimaryCity(localityRaw);
    const freqMhz = parseLocaleNumber(row.freq);

    if (!callsign || !stationName || !departmentName || !cityName || !Number.isFinite(freqMhz)) {
      continue;
    }

    const admin1Code = buildAdmin1Code(departmentName);
    const dedupeKey = [
      "community",
      callsign,
      normalizeKey(stationName),
      admin1Code,
      normalizeKey(cityName),
      freqMhz.toFixed(3),
    ].join("|");

    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.set(dedupeKey, {
      admin1Code,
      cityName,
      countryCode: "PY",
      curated: false,
      description: buildCommunityDescription(row, cityName, departmentName),
      freqMhz: Number.parseFloat(freqMhz.toFixed(3)),
      name: stationName,
      source: "CONATEL community FM register",
      sourceUrl: CONATEL_COMMUNITY_URL,
      tags: [
        "fm",
        "official",
        "conatel",
        "paraguay",
        "community",
        toTag(departmentName),
      ],
      verifiedAt,
    });
  }

  return [...dedupe.values()];
}

function isCommercialRowStart(word) {
  return word.left < 135 && /^\d+$/.test(word.text);
}

function isCommunityRowStart(word) {
  return word.left < 40 && /^\d+$/.test(word.text);
}

export async function loadConatelPyStations() {
  const verifiedAt = new Date().toISOString().slice(0, 10);

  const [commercialTsv, communityTsv] = await Promise.all([
    extractPdfTsv(await downloadPdf(CONATEL_COMMERCIAL_URL), "conatel-py-commercial.pdf"),
    extractPdfTsv(await downloadPdf(CONATEL_COMMUNITY_URL), "conatel-py-community.pdf"),
  ]);

  const commercialRecords = buildRecords(parseTsvWords(commercialTsv), {
    continuationMinTop: 55,
    isRowStart: isCommercialRowStart,
  });
  const communityRecords = buildRecords(parseTsvWords(communityTsv), {
    continuationMinTop: 60,
    isRowStart: isCommunityRowStart,
  });

  const stations = [
    ...mapCommercialRecords(commercialRecords, verifiedAt),
    ...mapCommunityRecords(communityRecords, verifiedAt),
  ];

  return stations.sort((left, right) => {
    const adminDiff = compareText(left.admin1Code || "", right.admin1Code || "");
    if (adminDiff !== 0) {
      return adminDiff;
    }

    const cityDiff = compareText(left.cityName || "", right.cityName || "");
    if (cityDiff !== 0) {
      return cityDiff;
    }

    if (left.freqMhz !== right.freqMhz) {
      return left.freqMhz - right.freqMhz;
    }

    return compareText(left.name || "", right.name || "");
  });
}
