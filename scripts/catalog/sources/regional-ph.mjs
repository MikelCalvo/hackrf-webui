import { normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const NTC_REGION7_PAGE_URL = "https://region7.ntc.gov.ph/regional-profile/radio-and-tv-broadcast-station/";
const NTC_REGION7_JSON_URL = "https://region7.ntc.gov.ph/wp-json/wp/v2/pages/37";

const DEFAULT_CITY_BY_PROVINCE = {
  Bohol: "Tagbilaran City",
  Cebu: "Cebu City",
  "Negros Oriental": "Dumaguete City",
};

const KNOWN_PLACES_BY_PROVINCE = {
  Bohol: ["Tagbilaran City", "Jagna", "Ubay", "Carmen"],
  Cebu: [
    "Cebu City",
    "Mandaue City",
    "Bogo City",
    "Toledo City",
    "Balamban",
    "Barili",
    "Daan Bantayan",
    "Pinamungahan",
    "Argao",
    "Moalboal",
    "Bantayan",
    "Siquijor",
  ],
  "Negros Oriental": [
    "Dumaguete City",
    "Guihulngan City",
    "Bais City",
    "Bayawan City",
  ],
};

const PLACE_ALIASES_BY_PROVINCE = {
  Bohol: [
    { pattern: /\bTagbilaran\b/i, value: "Tagbilaran City" },
  ],
  Cebu: [
    { pattern: /\bC\.C\.\b/i, value: "Cebu City" },
    { pattern: /\bCebu\b/i, value: "Cebu City" },
    { pattern: /\bBogo\b/i, value: "Bogo City" },
    { pattern: /\bToledo\b/i, value: "Toledo City" },
    { pattern: /\bBantayan\b/i, value: "Bantayan" },
  ],
  "Negros Oriental": [
    { pattern: /\bDgte\.?\b/i, value: "Dumaguete City" },
    { pattern: /\bDumaguete\b/i, value: "Dumaguete City" },
    { pattern: /\bGuihulngan\b/i, value: "Guihulngan City" },
    { pattern: /\bBayawan\b/i, value: "Bayawan City" },
    { pattern: /\bBais\b/i, value: "Bais City" },
  ],
};

function normalizeText(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value) {
  return normalizeText(String(value ?? "").replace(/<[^>]+>/g, " "));
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&ntilde;/g, "ñ")
    .replace(/&Ntilde;/g, "Ñ")
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú");
}

function parseFrequency(value) {
  const match = normalizeText(value).match(/(\d{2,3}(?:\.\d+)?)/);
  return match ? normalizeFreqMhz(match[1]) : NaN;
}

function parseProvince(sectionTitle) {
  const normalized = normalizeText(sectionTitle)
    .replace(/\s+FM BROADCAST STATIONS$/i, "")
    .replace(/\s+PROVINCE$/i, "");
  return normalized
    .toLocaleLowerCase("en")
    .split(/\s+/)
    .map((part) => `${part[0]?.toLocaleUpperCase("en") || ""}${part.slice(1)}`)
    .join(" ");
}

function pickCityCandidate(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  const cityMatches = [...normalized.matchAll(/([A-Z][A-Za-z.' -]+?\s+City)\b/g)];
  if (cityMatches.length) {
    return normalizeText(cityMatches.at(-1)?.[1] || "");
  }

  const segments = normalized
    .split(",")
    .map((segment) =>
      normalizeText(
        segment
          .replace(/\b(?:Cebu|Bohol|Negros Oriental|Siquijor)\b/gi, "")
          .replace(/\b(?:Brgy|Barangay|Poblacion|District|Province)\b/gi, ""),
      ),
    )
    .filter(Boolean);

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const candidate = segments[index];
    if (
      !/\d/.test(candidate) &&
      !/\b(?:Street|St\.|Ave\.|Avenue|Blvd|Road|Rd\.|Hotel|Building|Bldg|Compound)\b/i.test(
        candidate,
      ) &&
      candidate.split(/\s+/).length <= 4
    ) {
      return candidate;
    }
  }

  return "";
}

function deriveCityName(province, studioLocation, transmitterLocation) {
  const provincePlaces = KNOWN_PLACES_BY_PROVINCE[province] ?? [];
  const provinceAliases = PLACE_ALIASES_BY_PROVINCE[province] ?? [];
  for (const location of [transmitterLocation, studioLocation]) {
    const normalizedLocation = normalizeText(location);
    const placeMatch = provincePlaces.find((place) =>
      new RegExp(`\\b${place.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(
        normalizedLocation,
      ),
    );
    if (placeMatch) {
      return placeMatch;
    }

    const aliasMatch = provinceAliases.find((alias) => alias.pattern.test(normalizedLocation));
    if (aliasMatch) {
      return aliasMatch.value;
    }
  }

  return (
    pickCityCandidate(transmitterLocation) ||
    pickCityCandidate(studioLocation) ||
    DEFAULT_CITY_BY_PROVINCE[province] ||
    province
  );
}

function buildDescription({ ownerName, callSign, province, studioLocation, transmitterLocation }) {
  return [
    `Region VII FM station listed by the Philippine NTC for ${province}.`,
    callSign ? `Call sign: ${callSign}.` : "",
    ownerName ? `Licensee: ${ownerName}.` : "",
    studioLocation ? `Studio: ${studioLocation}.` : "",
    transmitterLocation ? `Transmitter: ${transmitterLocation}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function extractRows(html) {
  const tableMatch = html.match(/<table[\s\S]*?<\/table>/i);
  if (!tableMatch) {
    return [];
  }

  const rows = tableMatch[0].match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const parsedRows = [];
  let currentProvince = "";
  let currentSection = "";

  for (const row of rows) {
    const cells = [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((match) =>
      stripTags(decodeHtml(match[1])),
    );

    if (!cells.length) {
      continue;
    }

    const firstCell = normalizeText(cells[0]);
    if (!firstCell) {
      continue;
    }

    if (firstCell.endsWith("PROVINCE")) {
      currentProvince = parseProvince(firstCell);
      currentSection = "";
      continue;
    }

    if (firstCell.endsWith("FM BROADCAST STATIONS")) {
      currentSection = firstCell;
      if (!currentProvince) {
        currentProvince = parseProvince(firstCell);
      }
      continue;
    }

    if (!currentSection || firstCell === "No." || cells.length < 7) {
      continue;
    }

    parsedRows.push({
      callSign: normalizeText(cells[2]),
      frequency: normalizeText(cells[3]),
      ownerName: normalizeText(cells[1]),
      power: normalizeText(cells[4]),
      province: currentProvince,
      studioLocation: normalizeText(cells[5]),
      transmitterLocation: normalizeText(cells[6]),
    });
  }

  return parsedRows;
}

export async function loadRegionalPhStations() {
  const res = await fetch(NTC_REGION7_JSON_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download NTC Region VII JSON: HTTP ${res.status}`);
  }

  const payload = await res.json();
  const html = String(payload?.content?.rendered ?? "");
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const row of extractRows(html)) {
    const freqMhz = parseFrequency(row.frequency);
    const cityName = deriveCityName(
      row.province,
      row.studioLocation,
      row.transmitterLocation,
    );
    const name = row.callSign || row.ownerName;

    if (!name || !cityName || !Number.isFinite(freqMhz)) {
      continue;
    }

    const dedupeKey = `${cityName}|${name}|${freqMhz.toFixed(3)}`;
    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.set(dedupeKey, {
      cityName,
      countryCode: "PH",
      curated: false,
      description: buildDescription(row),
      freqMhz,
      name,
      source: "NTC Region VII broadcast stations",
      sourceUrl: NTC_REGION7_PAGE_URL,
      tags: [
        "fm",
        "official",
        "philippines",
        "region-vii",
        row.province ? toTag(row.province) : "philippines",
      ],
      timezone: "Asia/Manila",
      verifiedAt,
    });
  }

  return [...dedupe.values()];
}
