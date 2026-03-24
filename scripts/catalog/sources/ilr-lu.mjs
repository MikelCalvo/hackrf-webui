import { compareText, normalizeFreqMhz, normalizeKey, toTag } from "../lib/utils.mjs";

const ILR_PAGE_URL = "https://www.ilr.lu/publications/liste-des-emetteurs-de-programmes-de-radio/";

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripTags(value) {
  return decodeHtmlEntities(String(value ?? "").replace(/<[^>]+>/g, " "));
}

function cleanCellText(value) {
  return normalizeText(stripTags(value));
}

function parseFreqMhz(value) {
  let raw = normalizeText(value);
  if (!raw) {
    return NaN;
  }

  raw = raw.replace(/mhz$/i, "").replace(",", ".");
  return normalizeFreqMhz(raw);
}

function extractTableRows(html) {
  const tableMatch = html.match(/<table\b[\s\S]*?<\/table>/i);
  if (!tableMatch) {
    throw new Error("Failed to find ILR radio table");
  }

  return [...tableMatch[0].matchAll(/<tr>\s*(<td[\s\S]*?<\/tr>)/gi)].map((match) => match[1]);
}

function extractCells(rowHtml) {
  return [...String(rowHtml).matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
}

function buildDescription({ cityName, powerLabel, stationName }) {
  return [
    `Luxembourg FM transmitter listed by ILR for ${cityName}.`,
    stationName ? `Program: ${stationName}.` : "",
    powerLabel ? `Power: ${powerLabel}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function loadIlrLuStations({ signal } = {}) {
  const res = await fetch(ILR_PAGE_URL, {
    signal,
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download ILR radio page: HTTP ${res.status}`);
  }

  const rows = extractTableRows(await res.text());
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const rowHtml of rows) {
    const cells = extractCells(rowHtml);
    if (cells.length < 4) {
      continue;
    }

    const stationName = cleanCellText(cells[0]);
    const freqMhz = parseFreqMhz(cells[1]);
    const cityName = cleanCellText(cells[2]);
    const powerLabel = cleanCellText(cells[3]);

    if (!stationName || !cityName || !Number.isFinite(freqMhz)) {
      continue;
    }

    const dedupeKey = [
      normalizeKey(stationName),
      normalizeKey(cityName),
      freqMhz.toFixed(3),
    ].join("|");
    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.set(dedupeKey, {
      cityName,
      countryCode: "LU",
      curated: false,
      description: buildDescription({ cityName, powerLabel, stationName }),
      freqMhz,
      name: stationName,
      source: "ILR radio transmitters list",
      sourceUrl: ILR_PAGE_URL,
      tags: [
        "fm",
        "official",
        "ilr",
        "luxembourg",
        toTag(cityName),
        powerLabel ? toTag(powerLabel) : "fm",
      ],
      timezone: "Europe/Luxembourg",
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
