import { normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const HAKOM_FM_URL = "https://app.hakom.hr/default.aspx?id=406";
const HAKOM_LEVELS = [
  "Državna razina",
  "Lokalna i gradska razina",
  "Mjesna razina",
  "Razina dijela grada",
  "Regionalna razina",
  "Županijska razina",
];

function normalizeText(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
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

function normalizeLocationToCity(value) {
  const withoutParentheses = normalizeText(value).replace(/\s*\([^)]*\)\s*/gu, " ");
  const beforeHyphen = withoutParentheses.split(/\s*[-–]\s*/u)[0] ?? withoutParentheses;
  return normalizeText(
    beforeHyphen
      .replace(/\s+\d+$/u, "")
      .replace(/\s+[A-Z]{1,3}\.?$/u, ""),
  );
}

function extractRows(html) {
  const rowHtmls = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const rows = [];

  for (const rowHtml of rowHtmls) {
    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) =>
      stripHtml(match[1]),
    );
    if (cells.length === 12) {
      rows.push(cells);
    }
  }

  return rows;
}

function buildDescription({
  cityName,
  concessionCode,
  countyName,
  coverageRange,
  levelName,
  notes,
  stationName,
  transmitterSite,
}) {
  return [
    `Croatian FM entry listed by HAKOM for ${cityName}.`,
    `Operator: ${stationName}.`,
    transmitterSite && transmitterSite !== cityName ? `Transmitter site: ${transmitterSite}.` : "",
    levelName ? `Coverage level: ${levelName}.` : "",
    countyName ? `County: ${countyName}.` : "",
    concessionCode ? `Concession code: ${concessionCode}.` : "",
    coverageRange ? `Coverage range: ${coverageRange}.` : "",
    notes ? `Notes: ${notes}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

async function fetchLevelRows(levelName) {
  const response = await fetch(HAKOM_FM_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
    body: new URLSearchParams({
      frek: "-1",
      ist: "-1",
      konc: "-1",
      kor: "-1",
      lok: "-1",
      ras: "-1",
      raz: levelName,
      zup: "-1",
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch HAKOM FM list for ${levelName}: HTTP ${response.status}`);
  }

  return extractRows(await response.text());
}

export async function loadHakomHrStations() {
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const levelName of HAKOM_LEVELS) {
    const rows = await fetchLevelRows(levelName);
    for (const row of rows) {
      const [
        ,
        locationName,
        frequencyLabel,
        countyName,
        concessionCode,
        operatorName,
        coverageRange,
        noteA,
        noteB,
      ] = row;
      const transmitterSite = normalizeText(locationName);
      const cityName = normalizeLocationToCity(locationName);
      const stationName = normalizeText(operatorName);
      const freqMhz = parseFreq(frequencyLabel);
      const notes = normalizeText([noteA, noteB].filter(Boolean).join(" | "));

      if (!cityName || !stationName || !Number.isFinite(freqMhz)) {
        continue;
      }

      const dedupeKey = `${cityName}|${stationName}|${freqMhz.toFixed(3)}`;
      if (dedupe.has(dedupeKey)) {
        continue;
      }

      dedupe.set(dedupeKey, {
        cityName,
        countryCode: "HR",
        curated: false,
        description: buildDescription({
          cityName,
          concessionCode: normalizeText(concessionCode),
          countyName: normalizeText(countyName),
          coverageRange: normalizeText(coverageRange),
          levelName,
          notes,
          stationName,
          transmitterSite,
        }),
        freqMhz,
        name: stationName,
        source: "HAKOM FM concession table",
        sourceUrl: HAKOM_FM_URL,
        tags: [
          "fm",
          "official",
          "croatia",
          "hakom",
          toTag(levelName),
          toTag(stationName),
        ],
        timezone: "Europe/Zagreb",
        verifiedAt,
      });
    }
  }

  return [...dedupe.values()];
}
