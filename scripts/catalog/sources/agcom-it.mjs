import { compareText, normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const AGCOM_CNF_PUBLIC_URL = "http://www.catastofrequenze.agcom.it/catasto/pubblico";
const AGCOM_CNF_HOME_URL = "http://www.catastofrequenze.agcom.it/catasto/";
const USER_AGENT = "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)";
const FM_MIN_MHZ = 87.5;
const FM_MAX_MHZ = 108;
const REQUEST_CONCURRENCY = 3;

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#039;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&egrave;/gi, "è")
    .replace(/&agrave;/gi, "à")
    .replace(/&igrave;/gi, "ì")
    .replace(/&ograve;/gi, "ò")
    .replace(/&ugrave;/gi, "ù")
    .replace(/&Egrave;/g, "È")
    .replace(/&Agrave;/g, "À")
    .replace(/&Igrave;/g, "Ì")
    .replace(/&Ograve;/g, "Ò")
    .replace(/&Ugrave;/g, "Ù")
    .replace(/&#x([0-9a-f]+);/giu, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/gu, (_, decimal) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    );
}

function stripTags(value) {
  return normalizeText(decodeHtmlEntities(String(value ?? "").replace(/<[^>]+>/g, " ")));
}

function cleanQuotedText(value) {
  return normalizeText(value).replace(/^"+|"+$/g, "");
}

function normalizeLocationText(value) {
  return normalizeText(value)
    .replace(/\s+-\s+-\s+/gu, " - ")
    .replace(/^\s*-\s+/u, "")
    .replace(/\s+-\s*$/u, "");
}

function titleCaseToken(token) {
  if (!token) {
    return "";
  }
  if (/^\d+$/u.test(token)) {
    return token;
  }
  if (/^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI)$/u.test(token)) {
    return token;
  }
  if (/^[A-Z]{1,3}$/u.test(token) && !/[AEIOU]/u.test(token)) {
    return token;
  }

  const lower = token.toLocaleLowerCase("it");
  return `${lower[0]?.toLocaleUpperCase("it") || ""}${lower.slice(1)}`;
}

function formatPlaceName(value) {
  const normalized = normalizeLocationText(value);
  if (!normalized) {
    return "";
  }

  return normalized
    .split(/(\s+|[-/'])/u)
    .map((part) => {
      if (!part || /^(\s+|[-/'])$/u.test(part)) {
        return part;
      }
      return titleCaseToken(part);
    })
    .join("")
    .replace(/\bS\./gu, "S.")
    .replace(/\bM\./gu, "M.");
}

function parseDecimal(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return NaN;
  }

  const numeric = Number.parseFloat(
    normalized.includes(",")
      ? normalized.replace(/\./g, "").replace(",", ".")
      : normalized,
  );
  return Number.isFinite(numeric) ? numeric : NaN;
}

function parseInteger(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return NaN;
  }

  const numeric = Number.parseInt(normalized.replace(/\./g, ""), 10);
  return Number.isFinite(numeric) ? numeric : NaN;
}

function decodeAgcomCoordinate(raw, axis) {
  const value = normalizeText(raw);
  if (!value) {
    return NaN;
  }

  const match =
    axis === "lon"
      ? value.match(/^(\d{2,3})([EW])(\d{2})(\d{2})$/u)
      : value.match(/^(\d{2})([NS])(\d{2})(\d{2})$/u);
  if (!match) {
    return NaN;
  }

  const degrees = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[3], 10);
  const seconds = Number.parseInt(match[4], 10);
  const sign =
    match[2] === "W" || match[2] === "S"
      ? -1
      : 1;

  return sign * (degrees + minutes / 60 + seconds / 3600);
}

function formatCoordinate(value) {
  return Number.isFinite(value) ? value.toFixed(4) : "";
}

function formatDbw(value) {
  return Number.isFinite(value)
    ? `${Number.parseFloat(value.toFixed(3)).toString()} dBW`
    : "";
}

function parseErpCell(value) {
  const text = normalizeText(value);
  return {
    horizontalDbw: parseDecimal(text.match(/H:\s*([-\d.,]+)/iu)?.[1] ?? ""),
    verticalDbw: parseDecimal(text.match(/V:\s*([-\d.,]+)/iu)?.[1] ?? ""),
  };
}

function extractRegionOptions(html) {
  const selectHtml = String(html).match(
    /<select[^>]+name="regione"[^>]*>([\s\S]*?)<\/select>/iu,
  )?.[1];
  if (!selectHtml) {
    return [];
  }

  return [...selectHtml.matchAll(/<option value="([^"]*)">([\s\S]*?)<\/option>/giu)]
    .map((match) => ({
      code: normalizeText(match[1]),
      name: cleanQuotedText(stripTags(match[2])),
    }))
    .filter((region) => region.code);
}

function extractRows(html) {
  const tbodyHtml = String(html).match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/iu)?.[1];
  if (!tbodyHtml) {
    return [];
  }

  return [...tbodyHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/giu)].map((match) => match[1]);
}

function extractCells(rowHtml) {
  return [...String(rowHtml).matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/giu)].map((match) => ({
    attrs: match[1] || "",
    html: match[2] || "",
    text: stripTags(match[2] || ""),
  }));
}

function extractInputValue(html, fieldName) {
  return (
    String(html).match(
      new RegExp(
        String.raw`<input[^>]+name="${fieldName}"[^>]+value="([^"]+)"`,
        "iu",
      ),
    )?.[1] ?? ""
  );
}

function parseFoundCount(html) {
  const count = String(html).match(/Trovati\s+([0-9.]+)\s+impianti/iu)?.[1] ?? "";
  return Number.parseInt(count.replace(/\./g, ""), 10);
}

function cleanLocationCandidate(value) {
  return normalizeLocationText(value)
    .replace(/([\p{Letter}'`])\d{4,}$/u, "$1")
    .replace(/[,-]\s*$/u, "");
}

function deriveCityName(siteName, regionName) {
  const segments = normalizeText(siteName)
    .split(/\s+-\s+/u)
    .map((segment) => cleanLocationCandidate(segment))
    .filter(Boolean);
  const candidate = segments.at(-1) || cleanLocationCandidate(siteName) || regionName;
  return formatPlaceName(candidate);
}

function buildDescription({
  altitudeM,
  cityName,
  latitude,
  longitude,
  operatorName,
  plantId,
  programName,
  provinceCode,
  regionName,
  siteName,
  erpHorizontalDbw,
  erpVerticalDbw,
}) {
  const erpParts = [
    formatDbw(erpHorizontalDbw) ? `H ${formatDbw(erpHorizontalDbw)}` : "",
    formatDbw(erpVerticalDbw) ? `V ${formatDbw(erpVerticalDbw)}` : "",
  ].filter(Boolean);

  return [
    `Italian FM transmitter listed by AGCOM CNF for ${cityName}, ${regionName}.`,
    operatorName ? `Operator: ${operatorName}.` : "",
    programName && programName !== operatorName ? `Service: ${programName}.` : "",
    siteName ? `Site: ${siteName}.` : "",
    provinceCode ? `Province: ${provinceCode}.` : "",
    plantId ? `Plant ID: ${plantId}.` : "",
    Number.isFinite(altitudeM) ? `Altitude: ${altitudeM} m.` : "",
    erpParts.length ? `Max ERP: ${erpParts.join(" / ")}.` : "",
    Number.isFinite(latitude) && Number.isFinite(longitude)
      ? `Coordinates: ${formatCoordinate(latitude)}, ${formatCoordinate(longitude)}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function parseResultRows(html, region, verifiedAt) {
  const rows = extractRows(html);
  const stations = [];

  for (const rowHtml of rows) {
    const cells = extractCells(rowHtml);
    if (cells.length < 13) {
      continue;
    }

    const internalPlantId = extractInputValue(cells[0]?.html, "idImpianto");
    const operatorName = cleanQuotedText(cells[1]?.text);
    const plantId = normalizeText(cells[2]?.text) || internalPlantId;
    const typeText = normalizeText(cells[3]?.text).replace(/\s+/g, " ");
    const siteName = formatPlaceName(cells[4]?.text);
    const provinceCode = normalizeText(cells[5]?.text).toUpperCase();
    const latitude = decodeAgcomCoordinate(cells[6]?.text, "lat");
    const longitude = decodeAgcomCoordinate(cells[7]?.text, "lon");
    const altitudeM = parseInteger(cells[8]?.text);
    const freqMhz = normalizeFreqMhz(parseDecimal(cells[10]?.text));
    const programName = cleanQuotedText(cells[11]?.text);
    const erp = parseErpCell(cells[12]?.text);

    if (!plantId || !Number.isFinite(freqMhz)) {
      continue;
    }
    if (!typeText.includes("FM") || freqMhz < FM_MIN_MHZ || freqMhz > FM_MAX_MHZ) {
      continue;
    }

    const cityName = deriveCityName(siteName, region.name);
    const stationName = programName || operatorName || plantId;
    const tags = new Set([
      "fm",
      "official",
      "agcom",
      "cnf",
      "italy",
      toTag(region.name),
      provinceCode ? toTag(provinceCode.toLowerCase()) : "it",
      plantId ? toTag(plantId) : "impianto",
    ]);

    if (operatorName) {
      tags.add(toTag(operatorName));
    }
    if (programName) {
      tags.add(toTag(programName));
    }

    stations.push({
      cityName,
      countryCode: "IT",
      curated: false,
      description: buildDescription({
        altitudeM,
        cityName,
        latitude,
        longitude,
        operatorName,
        plantId,
        programName,
        provinceCode,
        regionName: region.name,
        siteName,
        erpHorizontalDbw: erp.horizontalDbw,
        erpVerticalDbw: erp.verticalDbw,
      }),
      freqMhz,
      latitude,
      longitude,
      name: stationName,
      plantId,
      source: "AGCOM CNF public site",
      sourceUrl: AGCOM_CNF_PUBLIC_URL,
      tags: [...tags],
      timezone: "Europe/Rome",
      verifiedAt,
    });
  }

  return {
    foundCount: parseFoundCount(html),
    stations,
  };
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "user-agent": USER_AGENT,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch AGCOM CNF page ${url}: HTTP ${response.status}`);
  }

  return response.text();
}

async function fetchRegionResults(region, verifiedAt) {
  const body = new URLSearchParams({
    tipoImpianto: "RA",
    regione: region.code,
  }).toString();

  const html = await fetchText(AGCOM_CNF_PUBLIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body,
  });

  return parseResultRows(html, region, verifiedAt);
}

async function mapPool(items, limit, iteratee) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await iteratee(items[currentIndex]);
    }
  }

  const workers = Array.from({ length: Math.max(1, limit) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function loadAgcomItStations() {
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const searchPageHtml = await fetchText(AGCOM_CNF_PUBLIC_URL);
  const regions = extractRegionOptions(searchPageHtml);
  if (!regions.length) {
    throw new Error("AGCOM CNF public page does not expose any region options");
  }

  const regionResults = await mapPool(regions, REQUEST_CONCURRENCY, async (region) =>
    fetchRegionResults(region, verifiedAt),
  );

  const dedupe = new Map();
  for (let index = 0; index < regions.length; index += 1) {
    const region = regions[index];
    const result = regionResults[index];
    const parsedCount = result?.stations?.length ?? 0;

    if (Number.isFinite(result?.foundCount) && result.foundCount !== parsedCount) {
      throw new Error(
        `AGCOM CNF returned ${result.foundCount} FM plants for ${region.code} but ${parsedCount} rows were parsed`,
      );
    }
    if (!parsedCount && result?.foundCount > 0) {
      throw new Error(
        `AGCOM CNF returned ${result.foundCount} FM plants for ${region.code} but no rows were parsed`,
      );
    }

    for (const station of result?.stations ?? []) {
      const dedupeKey = station.plantId || [
        station.cityName,
        station.name,
        station.freqMhz.toFixed(3),
      ].join("|");
      if (!dedupe.has(dedupeKey)) {
        dedupe.set(dedupeKey, station);
      }
    }
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

export const AGCOM_IT_SOURCE_URL = AGCOM_CNF_HOME_URL;
