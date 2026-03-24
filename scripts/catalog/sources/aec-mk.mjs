import XLSX from "xlsx";

import { compareText, normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const AVMU_BROADCASTERS_URL = "https://avmu.mk/en/broadcasters/";
const USER_AGENT = "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)";

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, rawCode) => {
      const code = Number.parseInt(rawCode, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, rawCode) => {
      const code = Number.parseInt(rawCode, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'");
}

function parseFrequencyMhz(value) {
  const numeric = Number.parseFloat(
    normalizeText(value)
      .replace(",", ".")
      .match(/\d+(?:\.\d+)?/u)?.[0] || "",
  );
  return Number.isFinite(numeric) ? normalizeFreqMhz(numeric) : NaN;
}

function normalizeCoverageArea(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  if (/^All of the territory of the Republic of North Macedonia$/i.test(normalized)) {
    return "North Macedonia";
  }
  return normalized.replace(/^Municipality of\s+/i, "");
}

function splitNationalSiteAndCity(value) {
  const normalized = normalizeText(value).replace(/[.;]+$/g, "").trim();
  if (!normalized) {
    return {
      cityName: "",
      siteName: "",
    };
  }

  const parentheticalMatch = normalized.match(/^(.*?)\s*\(([^)]+)\)\s*$/u);
  if (parentheticalMatch) {
    return {
      cityName: normalizeText(parentheticalMatch[2]),
      siteName: normalizeText(parentheticalMatch[1]),
    };
  }

  const commaParts = normalized.split(/\s*,\s*/u).map(normalizeText).filter(Boolean);
  if (commaParts.length >= 2) {
    return {
      cityName: commaParts.at(-1),
      siteName: commaParts.slice(0, -1).join(", "),
    };
  }

  return {
    cityName: normalized,
    siteName: normalized,
  };
}

function parseTransmission(segment, coverageArea) {
  const normalizedSegment = normalizeText(segment).replace(/[;]+$/g, "").trim();
  if (!normalizedSegment) {
    return null;
  }

  const freqMatch = normalizedSegment.match(
    /(\d{1,3}(?:[.,]\d{1,3})?)\s*(?:M\s*H\s*Z)?\.?$/iu,
  );
  if (!freqMatch) {
    return null;
  }

  const freqMhz = parseFrequencyMhz(freqMatch[1]);
  if (!Number.isFinite(freqMhz)) {
    return null;
  }

  const siteLabel = normalizeText(normalizedSegment.slice(0, freqMatch.index))
    .replace(/[,:-]+$/g, "")
    .trim();
  const normalizedArea = normalizeCoverageArea(coverageArea);
  const isNational = normalizedArea === "North Macedonia";
  const nationalSite = splitNationalSiteAndCity(siteLabel);

  const siteName = nationalSite.siteName || siteLabel || normalizedArea || "North Macedonia";
  const cityName = isNational
    ? nationalSite.cityName || siteName || normalizedArea || "North Macedonia"
    : normalizedArea || nationalSite.cityName || siteName || "North Macedonia";

  return {
    cityName,
    freqMhz,
    siteName,
  };
}

function buildDescription(row, transmission) {
  const parts = [
    `North Macedonian FM radio entry listed by AVMU for ${transmission.cityName}.`,
    row.licenseeName ? `Licensee: ${row.licenseeName}.` : "",
    row.coverageLevel ? `Coverage level: ${row.coverageLevel}.` : "",
    row.coverageArea ? `Service area: ${row.coverageArea}.` : "",
    transmission.siteName && transmission.siteName !== transmission.cityName
      ? `Transmitter site: ${transmission.siteName}.`
      : "",
    row.licenseReference ? `Broadcasting licence: ${row.licenseReference}.` : "",
    row.validityPeriod ? `Validity: ${row.validityPeriod}.` : "",
  ];

  return parts.filter(Boolean).join(" ");
}

async function discoverWorkbookUrl() {
  const response = await fetch(AVMU_BROADCASTERS_URL, {
    headers: {
      "user-agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to load AVMU broadcasters page: HTTP ${response.status}`);
  }

  const html = await response.text();
  const workbookMatch = decodeHtmlEntities(html).match(
    /href="([^"]*ENGL-Registar-na-RA[^"]+\.xlsx)"/iu,
  );

  if (!workbookMatch) {
    throw new Error("AVMU broadcasters page does not expose the English radio workbook");
  }

  return new URL(workbookMatch[1], AVMU_BROADCASTERS_URL).href;
}

async function downloadWorkbook(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download AVMU radio workbook: HTTP ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function parseWorkbookRows(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets.Sheet1 ?? workbook.Sheets[workbook.SheetNames[0]];

  if (!sheet) {
    throw new Error("AVMU workbook does not contain a readable worksheet");
  }

  return XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    header: 1,
  });
}

function buildStationRows(rows) {
  const stations = [];

  for (const row of rows) {
    const sequenceNumber = normalizeText(row[0]);
    const coverageLevel = normalizeText(row[4]);
    const coverageArea = normalizeText(row[5]);
    const transmissionMethod = normalizeText(row[6]);
    const transmissionCell = normalizeText(row[7]);

    if (!/^\d+$/u.test(sequenceNumber)) {
      continue;
    }
    if (!coverageLevel || !/terrestrial transmitter/i.test(transmissionMethod)) {
      continue;
    }

    // MRT terrestrial rows are linked to a dead AVMU document URL, so only rows
    // with explicit site/frequency text can be imported reproducibly.
    if (!transmissionCell || /^Link to the locations and broadcasting frequencies/i.test(transmissionCell)) {
      continue;
    }

    const stationRow = {
      coverageArea,
      coverageLevel,
      licenseReference: normalizeText(row[8]),
      licenseeName: normalizeText(row[1]),
      name: normalizeText(row[2]) || normalizeText(row[1]),
      validityPeriod: normalizeText(row[9]),
    };

    const segments = transmissionCell.split(/\s*;\s*/u).map(normalizeText).filter(Boolean);
    for (const segment of segments) {
      const transmission = parseTransmission(segment, coverageArea);
      if (!transmission) {
        throw new Error(
          `AVMU row ${sequenceNumber} (${stationRow.name}) contains an unparseable transmission: ${segment}`,
        );
      }

      stations.push({
        ...stationRow,
        ...transmission,
      });
    }
  }

  return stations;
}

export async function loadAecMkStations() {
  const workbookUrl = await discoverWorkbookUrl();
  const rows = parseWorkbookRows(await downloadWorkbook(workbookUrl));
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const row of buildStationRows(rows)) {
    const dedupeKey = [
      row.name,
      row.licenseeName,
      row.siteName,
      row.cityName,
      row.freqMhz.toFixed(3),
    ]
      .map((part) => normalizeText(part).toUpperCase())
      .join("|");

    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.set(dedupeKey, {
      cityName: row.cityName,
      countryCode: "MK",
      coverageLevel: row.coverageLevel,
      curated: false,
      description: buildDescription(row, row),
      freqMhz: row.freqMhz,
      licenseReference: row.licenseReference,
      licenseeName: row.licenseeName,
      name: row.name,
      siteName: row.siteName,
      source: "AVMU Register of Radios workbook",
      sourceUrl: workbookUrl,
      tags: [
        "fm",
        "official",
        "avmu",
        "north-macedonia",
        row.coverageLevel ? toTag(row.coverageLevel) : "radio",
        row.cityName ? toTag(row.cityName) : "north-macedonia",
      ],
      timezone: "Europe/Skopje",
      verifiedAt,
    });
  }

  return [...dedupe.values()].sort((left, right) => {
    const cityDiff = compareText(left.cityName, right.cityName);
    if (cityDiff !== 0) {
      return cityDiff;
    }
    if (left.freqMhz !== right.freqMhz) {
      return left.freqMhz - right.freqMhz;
    }
    return compareText(left.name, right.name);
  });
}

export const AEC_MK_SOURCE_URL = AVMU_BROADCASTERS_URL;
