import { compareText, normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const SANMARINO_RADIO_URL = "https://www.sanmarinortv.sm/radio";
const USER_AGENT = "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)";

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
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'");
}

function normalizeText(value) {
  return decodeHtmlEntities(String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value) {
  return decodeHtmlEntities(
    String(value ?? "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
}

function parseFrequencyMhz(value) {
  const numeric = Number.parseFloat(normalizeText(value).match(/\d+(?:\.\d+)?/u)?.[0] || "");
  return Number.isFinite(numeric) ? normalizeFreqMhz(numeric) : NaN;
}

function extractAddressInfo(html) {
  const blockMatch = html.match(
    /<h4>\s*SAN MARINO RTV\s*<\/h4>\s*<div class="[^"]*\bxs-pad\b[^"]*\bmain\b[^"]*">([\s\S]*?)<\/div>/iu,
  );
  if (!blockMatch) {
    throw new Error("San Marino RTV address block not found");
  }

  const lines = stripHtml(blockMatch[1])
    .split(/\r?\n/u)
    .map((line) => normalizeText(line))
    .filter(Boolean);

  const [streetAddress = "", cityName = "", countryName = ""] = lines;
  if (!streetAddress || !cityName) {
    throw new Error("San Marino RTV address block is missing street or city data");
  }

  return {
    address: [streetAddress, cityName, countryName].filter(Boolean).join(", "),
    cityName,
    licenseeName: "San Marino RTV",
  };
}

function extractRadioStations(html) {
  const blockMatch = html.match(
    /<h4 class="[^"]*\bmm\b[^"]*">CANALI RADIO[\s\S]*?<\/h4>\s*<div class="[^"]*\bfc\b[^"]*\bxs-pad\b[^"]*">([\s\S]*?)<\/div>/iu,
  );
  if (!blockMatch) {
    throw new Error("San Marino RTV radio channels block not found");
  }

  const stations = [];
  const entryPattern =
    /<span class="line"><\/span>\s*([^<]+?)<br\s*\/?>\s*FM\s*([\d.]+)\s*<br\s*\/?>\s*(?:<a[^>]+href="mailto:([^"]+)")?/giu;

  for (const match of blockMatch[1].matchAll(entryPattern)) {
    const name = normalizeText(match[1]);
    const freqMhz = parseFrequencyMhz(match[2]);
    const contactEmail = normalizeText(match[3]);

    if (!name || !Number.isFinite(freqMhz)) {
      continue;
    }

    stations.push({
      contactEmail,
      freqMhz,
      name,
    });
  }

  if (!stations.length) {
    throw new Error("San Marino RTV radio channels block did not yield any FM stations");
  }

  return stations;
}

function buildDescription(station, addressInfo) {
  const parts = [
    `San Marino FM service listed by the official San Marino RTV radio page for ${addressInfo.cityName}.`,
    `Licensee: ${addressInfo.licenseeName}.`,
    `Frequency: ${station.freqMhz.toFixed(1)} MHz.`,
    `Address: ${addressInfo.address}.`,
    station.contactEmail ? `Contact: ${station.contactEmail}.` : "",
  ];

  return parts.filter(Boolean).join(" ");
}

export async function loadSanMarinoSmStations() {
  const response = await fetch(SANMARINO_RADIO_URL, {
    headers: {
      "user-agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to load San Marino RTV radio page: HTTP ${response.status}`);
  }

  const html = await response.text();
  const addressInfo = extractAddressInfo(html);
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const station of extractRadioStations(html)) {
    const dedupeKey = `${station.name.toUpperCase()}|${station.freqMhz.toFixed(3)}`;
    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.set(dedupeKey, {
      cityName: addressInfo.cityName,
      countryCode: "SM",
      curated: false,
      description: buildDescription(station, addressInfo),
      freqMhz: station.freqMhz,
      licenseeName: addressInfo.licenseeName,
      name: station.name,
      source: "San Marino RTV official radio page",
      sourceUrl: SANMARINO_RADIO_URL,
      tags: [
        "fm",
        "official",
        "san-marino",
        "san-marino-rtv",
        toTag(station.name),
      ],
      timezone: "Europe/San_Marino",
      verifiedAt,
    });
  }

  return [...dedupe.values()].sort((left, right) => {
    if (left.freqMhz !== right.freqMhz) {
      return left.freqMhz - right.freqMhz;
    }
    return compareText(left.name, right.name);
  });
}

export const SANMARINO_SM_SOURCE_URL = SANMARINO_RADIO_URL;
