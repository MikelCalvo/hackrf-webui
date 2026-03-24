import { compareText, normalizeFreqMhz, normalizeKey, toTag } from "../lib/utils.mjs";

const ESAKARI_LV_URL = "https://www.esakari.lv/lv/fm-apraides-staciju-saraksts";

// These are transmitter-site labels from the official table that do not resolve
// cleanly against the catalog's GeoNames `cities500` dataset.
const LOCATION_ALIAS_MAP = new Map(
  Object.entries({
    "AIZPURVE": "Viļaka",
    "BLĪDENE": "Brocēni",
    "MĀLE": "Gulbene",
    "OŠĀNI": "Sala",
    "PŪRE": "Kandava",
    "RĪTERI": "Koknese",
    "RUGĀJI": "Balvi",
    "SKAISTA": "Krāslava",
    "SĒLPILS": "Sala",
    "VIĻĶENE": "Limbaži",
    "ĒVARŽI": "Saldus",
  }),
);

function normalizeText(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value) {
  return normalizeText(
    String(value ?? "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function parseFreq(value) {
  const numeric = Number(normalizeText(value).replace(",", "."));
  return Number.isFinite(numeric) ? normalizeFreqMhz(numeric) : NaN;
}

function normalizeLocationToCity(siteName) {
  const normalizedSiteName = normalizeText(siteName);
  return LOCATION_ALIAS_MAP.get(normalizedSiteName) ?? normalizedSiteName;
}

function extractRows(html) {
  const tableMatch = html.match(/<table[^>]+id="datatable"[\s\S]*?<\/table>/i);
  if (!tableMatch) {
    return [];
  }

  const rowMatches = [...tableMatch[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].slice(1);
  return rowMatches.map((match) =>
    [...match[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
      stripHtml(cell[1]),
    ),
  );
}

function buildDescription({
  cityName,
  permitAddressee,
  permitHolder,
  programName,
  siteName,
}) {
  return [
    `Latvian FM entry listed by Elektroniskie sakari for ${cityName}.`,
    `Program: ${programName}.`,
    siteName && siteName !== cityName ? `Transmitter site: ${siteName}.` : "",
    permitAddressee
      ? `Broadcast transmitter permit addressee: ${permitAddressee}.`
      : "",
    permitHolder ? `Broadcast permit holder: ${permitHolder}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function loadEsakariLvStations() {
  const response = await fetch(ESAKARI_LV_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Latvian FM list: HTTP ${response.status}`);
  }

  const verifiedAt = new Date().toISOString().slice(0, 10);
  const rows = extractRows(await response.text());
  const dedupe = new Map();

  for (const row of rows) {
    if (row.length !== 6) {
      continue;
    }

    const [
      ,
      frequencyLabel,
      siteNameRaw,
      programNameRaw,
      permitAddresseeRaw,
      permitHolderRaw,
    ] = row;
    const siteName = normalizeText(siteNameRaw);
    const cityName = normalizeLocationToCity(siteName);
    const programName = normalizeText(programNameRaw);
    const permitAddressee = normalizeText(permitAddresseeRaw);
    const permitHolder = normalizeText(permitHolderRaw);
    const freqMhz = parseFreq(frequencyLabel);

    if (!siteName || !programName || !Number.isFinite(freqMhz)) {
      continue;
    }

    const dedupeKey = [
      normalizeKey(siteName),
      normalizeKey(programName),
      freqMhz.toFixed(3),
    ].join("|");
    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.set(dedupeKey, {
      cityName,
      countryCode: "LV",
      curated: false,
      description: buildDescription({
        cityName,
        permitAddressee,
        permitHolder,
        programName,
        siteName,
      }),
      freqMhz,
      name: programName,
      source: "Elektroniskie sakari FM station table",
      sourceUrl: ESAKARI_LV_URL,
      tags: [
        "fm",
        "official",
        "latvia",
        "esakari",
        toTag(programName),
        permitHolder ? toTag(permitHolder) : "",
      ].filter(Boolean),
      timezone: "Europe/Riga",
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
