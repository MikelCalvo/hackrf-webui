import { compareText, normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const RRT_FM_URL = "http://epaslaugos.rrt.lt/bc/RadioA.aspx";

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

function normalizeLocationToCity(value) {
  return normalizeText(normalizeText(value).replace(/\s*\([^)]*\)\s*/gu, " "));
}

function extractHiddenField(html, fieldName) {
  const pattern = new RegExp(
    String.raw`name="${fieldName}"[^>]*value="([^"]*)"`,
    "i",
  );
  return html.match(pattern)?.[1];
}

function extractTableRows(html) {
  const tableMatch = html.match(/<table[^>]+id="dgStations"[\s\S]*?<\/table>/i);
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

function buildDescription({ cityName, holderName, polarization }) {
  return [
    `Lithuanian FM register entry listed by RRT for ${cityName}.`,
    `Holder: ${holderName}.`,
    polarization ? `Polarization: ${polarization}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function loadRrtLtStations() {
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const initialResponse = await fetch(RRT_FM_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!initialResponse.ok) {
    throw new Error(`Failed to load Lithuanian FM form: HTTP ${initialResponse.status}`);
  }

  const initialHtml = await initialResponse.text();
  const viewState = extractHiddenField(initialHtml, "__VIEWSTATE");
  const viewStateGenerator = extractHiddenField(initialHtml, "__VIEWSTATEGENERATOR");
  const eventValidation = extractHiddenField(initialHtml, "__EVENTVALIDATION");
  if (!viewState || !viewStateGenerator || !eventValidation) {
    throw new Error("Failed to extract ASP.NET state fields from Lithuanian FM form");
  }

  const resultResponse = await fetch(RRT_FM_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
    body: new URLSearchParams({
      __EVENTVALIDATION: eventValidation,
      __VIEWSTATE: viewState,
      __VIEWSTATEGENERATOR: viewStateGenerator,
      "UcRadioA1$lstLoc": "",
      "UcRadioA1$txtFreq": "",
      btnSearch: "Ieškoti",
    }),
  });

  if (!resultResponse.ok) {
    throw new Error(`Failed to fetch Lithuanian FM list: HTTP ${resultResponse.status}`);
  }

  const rows = extractTableRows(await resultResponse.text());
  const dedupe = new Map();

  for (const row of rows) {
    if (row.length < 7) {
      continue;
    }

    const [locationName, bandName, frequencyLabel, holderName, erpLabel, polarization] = row;
    if (normalizeText(bandName).toUpperCase() !== "FM") {
      continue;
    }

    const cityName = normalizeLocationToCity(locationName);
    const freqMhz = parseFreq(frequencyLabel);
    if (!cityName || !holderName || !Number.isFinite(freqMhz)) {
      continue;
    }

    const dedupeKey = `${cityName}|${holderName}|${freqMhz.toFixed(3)}`;
    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.set(dedupeKey, {
      cityName,
      countryCode: "LT",
      curated: false,
      description: buildDescription({
        cityName,
        holderName: normalizeText(holderName),
        polarization: normalizeText(polarization),
      }),
      freqMhz,
      name: normalizeText(holderName),
      source: "RRT analogue radio frequency list",
      sourceUrl: RRT_FM_URL,
      tags: [
        "fm",
        "official",
        "lithuania",
        "rrt",
        toTag(erpLabel),
        toTag(holderName),
      ],
      timezone: "Europe/Vilnius",
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
