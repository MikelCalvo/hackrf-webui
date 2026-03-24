import { compareText, normalizeKey, toTag } from "../lib/utils.mjs";

const ARCOM_RADIOS_INDEX_URL =
  "https://www.arcom.fr/radio-et-audio-numerique/radio-fm-dab/radios";
const ARCOM_BASE_URL = "https://www.arcom.fr";

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseLocaleNumber(value) {
  let raw = normalizeText(value);
  if (!raw) {
    return NaN;
  }

  raw = raw.replace(/mhz$/i, "");

  if (raw.includes(",") && raw.includes(".")) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  } else if (raw.includes(",")) {
    raw = raw.replace(",", ".");
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function decodeMaybe(value) {
  return normalizeText(
    value
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">"),
  );
}

function stripTags(html) {
  return html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ");
}

function cleanInnerText(html) {
  return decodeMaybe(
    stripTags(html)
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function buildDescription({ stationName, departmentCode, cityName, transmitterSite }) {
  const parts = [
    `FM entry listed by Arcom for ${stationName}.`,
    cityName ? `Coverage point: ${cityName}${departmentCode ? ` (${departmentCode})` : ""}.` : "",
    transmitterSite ? `Transmitter site: ${transmitterSite}.` : "",
  ];

  return parts.filter(Boolean).join(" ");
}

function extractStationLinks(html) {
  const links = new Set();
  const pattern = /<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
  let match;

  while ((match = pattern.exec(html))) {
    const href = normalizeText(match[1]);
    if (!href || href.startsWith("#")) {
      continue;
    }

    if (!/^\/radio-et-audio-numerique\/radio-fm-dab\/radios\/[^/?#]+$/i.test(href)) {
      continue;
    }

    links.add(new URL(href, ARCOM_BASE_URL).toString());
  }

  return [...links].sort(compareText);
}

function parseRadioRows(html, pageUrl, verifiedAt, dedupe) {
  const rows = [];
  const rowPattern =
    /<tr>\s*<td>\s*FM\s*<\/td>\s*<td>\s*([^<]+?)\s*<\/td>\s*<td>\s*([^<]+?)\s*<\/td>\s*<td>\s*<a[^>]*>([^<]+)<\/a>[\s\S]*?<\/tr>/gi;
  let match;

  while ((match = rowPattern.exec(html))) {
    const freqMhz = parseLocaleNumber(match[1]);
    const stationName = cleanInnerText(match[2]);
    const locationLabel = cleanInnerText(match[3]);
    if (!Number.isFinite(freqMhz) || !stationName || !locationLabel) {
      continue;
    }

    const locationParts = locationLabel.split(/\s+-\s+/).map((part) => normalizeText(part));
    const departmentCode = normalizeText(locationParts[0] || "");
    const cityName = normalizeText(locationParts[1] || "");
    const transmitterSite = normalizeText(locationParts.slice(2).join(" - "));

    if (!departmentCode || !cityName) {
      continue;
    }

    const uniqueKey = [
      normalizeKey(stationName),
      departmentCode.toUpperCase(),
      normalizeKey(cityName),
      normalizeKey(transmitterSite),
      freqMhz.toFixed(3),
    ].join("|");
    if (dedupe.has(uniqueKey)) {
      continue;
    }

    dedupe.add(uniqueKey);
    rows.push({
      admin1Code: departmentCode,
      cityName,
      countryCode: "FR",
      curated: false,
      description: buildDescription({
        stationName,
        departmentCode,
        cityName,
        transmitterSite,
      }),
      freqMhz: Number.parseFloat(freqMhz.toFixed(3)),
      name: stationName,
      source: "Arcom radio FM station list",
      sourceUrl: pageUrl || ARCOM_RADIOS_INDEX_URL,
      tags: [
        "fm",
        "official",
        "arcom",
        "france",
        toTag(departmentCode),
      ],
      verifiedAt,
    });
  }

  return rows;
}

async function fetchHtml(url, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(() => controller.abort(), 20000);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
      },
    });

    if (res.status === 404) {
      return null;
    }

    if (!res.ok) {
      throw new Error(`Failed to fetch Arcom page ${url}: HTTP ${res.status}`);
    }

    return res.text();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

async function mapPool(items, limit, iteratee) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      results.push(await iteratee(current));
    }
  }

  const workers = Array.from({ length: Math.max(1, limit) }, () => worker());
  await Promise.all(workers);
  return results.flat();
}

export async function loadArcomFrStations({ signal } = {}) {
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const indexHtml = await fetchHtml(ARCOM_RADIOS_INDEX_URL, signal);
  const stationUrls = extractStationLinks(indexHtml);
  const dedupe = new Set();

  const stations = await mapPool(stationUrls, 4, async (stationUrl) => {
    if (signal?.aborted) {
      return [];
    }

    let html;
    try {
      html = await fetchHtml(stationUrl, signal);
    } catch {
      return [];
    }

    if (!html) {
      return [];
    }
    return parseRadioRows(html, stationUrl, verifiedAt, dedupe);
  });

  return stations
    .flat()
    .sort((left, right) => {
      const departmentDiff = compareText(left.admin1Code || "", right.admin1Code || "");
      if (departmentDiff !== 0) {
        return departmentDiff;
      }

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
