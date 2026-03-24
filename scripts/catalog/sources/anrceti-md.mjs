import { compareText, normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const AUDIOVISUAL_COUNCIL_RADIO_REGISTER_URL =
  "https://consiliuaudiovizual.md/registers/registrul-furnizorilor-de-servicii-media-de-radiodifuziune-sonora/";
const USER_AGENT = "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)";
const FM_MIN_MHZ = 87.5;
const FM_MAX_MHZ = 108;

const HTML_ENTITY_MAP = new Map([
  ["nbsp", " "],
  ["amp", "&"],
  ["quot", '"'],
  ["apos", "'"],
  ["lt", "<"],
  ["gt", ">"],
  ["ndash", "–"],
  ["mdash", "—"],
  ["laquo", "«"],
  ["raquo", "»"],
  ["abreve", "ă"],
  ["Abreve", "Ă"],
  ["acirc", "â"],
  ["Acirc", "Â"],
  ["icirc", "î"],
  ["Icirc", "Î"],
  ["scedil", "ș"],
  ["Scedil", "Ș"],
  ["tcedil", "ț"],
  ["Tcedil", "Ț"],
]);

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitLines(value) {
  return String(value ?? "")
    .split(/\r?\n/u)
    .map((line) => normalizeText(line))
    .filter(Boolean);
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);/giu, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/gu, (_, decimal) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&([a-zA-Z]+);/gu, (match, name) => HTML_ENTITY_MAP.get(name) ?? match);
}

function stripTagsPreservingBreaks(value) {
  const withBreaks = String(value ?? "")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/p>/giu, "\n")
    .replace(/<[^>]+>/gu, " ");

  return splitLines(decodeHtmlEntities(withBreaks)).join("\n");
}

function extractRows(html) {
  const tableHtml = String(html).match(/<table[^>]+class="n_table"[^>]*>([\s\S]*?)<\/table>/iu)?.[1];
  const tbodyHtml = tableHtml?.match(/<tbody>([\s\S]*?)<\/tbody>/iu)?.[1];
  if (!tbodyHtml) {
    return [];
  }

  return [...tbodyHtml.matchAll(/<tr>([\s\S]*?)<\/tr>/giu)].map((match) => match[1]);
}

function extractCells(rowHtml) {
  return [...String(rowHtml).matchAll(/<td[^>]*data-column="([^"]+)"[^>]*>([\s\S]*?)<\/td>/giu)].map(
    (match) => ({
      column: normalizeText(match[1]),
      text: stripTagsPreservingBreaks(match[2]),
    }),
  );
}

function parseDecimal(value) {
  const match = normalizeText(value)
    .replace(/\./g, "")
    .replace(",", ".")
    .match(/-?\d+(?:\.\d+)?/u);
  if (!match) {
    return NaN;
  }

  const numeric = Number.parseFloat(match[0]);
  return Number.isFinite(numeric) ? numeric : NaN;
}

function cleanStationName(value) {
  return normalizeText(value).replace(/^[„"“]+|[”"“]+$/gu, "");
}

function extractLicenseeName(value) {
  const nameLines = [];
  for (const line of splitLines(value)) {
    if (/^IDNO:/iu.test(line) || /^Adresa juridic/i.test(line)) {
      break;
    }
    nameLines.push(line);
  }

  return normalizeText(nameLines.join(" "));
}

function extractIdno(value) {
  return normalizeText(String(value).match(/IDNO:\s*([0-9]+)/iu)?.[1] ?? "");
}

function extractLicenseMetadata(value) {
  const text = normalizeText(value);
  const lines = splitLines(value);
  const firstLine = lines[0] ?? "";
  const dates = [...text.matchAll(/\b\d{2}\.\d{2}\.\d{4}\b/gu)].map((match) => match[0]);
  const issueDate = dates[0] ?? "";
  const expiryDate = dates[1] ?? "";
  const licenseNumber = normalizeText(firstLine.replace(/\bdin\b\s*\d{2}\.\d{2}\.\d{4}\b/iu, ""));

  let statusNote = normalizeText(text);
  if (licenseNumber) {
    statusNote = statusNote.replace(licenseNumber, "");
  }
  if (issueDate) {
    statusNote = statusNote.replace(new RegExp(String.raw`\bdin\b\s*${escapeRegex(issueDate)}`, "u"), "");
    statusNote = statusNote.replace(new RegExp(escapeRegex(issueDate), "u"), "");
  }
  if (expiryDate) {
    statusNote = statusNote.replace(new RegExp(escapeRegex(expiryDate), "u"), "");
  }
  statusNote = normalizeText(statusNote);

  return {
    expiryDate,
    issueDate,
    licenseNumber,
    statusNote,
  };
}

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanLocation(value) {
  return normalizeText(value)
    .replace(/^[,;–-]\s*/u, "")
    .replace(/\s*[.;,]$/u, "");
}

function extractCityName(locationRaw) {
  const withoutRayon = normalizeText(locationRaw).replace(/\s*,\s*r-nul.*$/iu, "");
  const withoutParenthetical = withoutRayon.replace(/\s*\([^)]*\)\s*$/u, "");
  return normalizeText(withoutParenthetical.split(/\s*,\s*/u)[0] ?? withoutParenthetical);
}

function extractTransmissionEntries(value) {
  const transmissions = [];

  for (const line of splitLines(value)) {
    const match = line.match(
      /^\s*(\d{1,3}(?:\s*[.,]\s*\d+)?)\s*MHz\b\s*[,–-]?\s*(.+?)\s*$/iu,
    );
    if (!match) {
      continue;
    }

    const freqMhz = normalizeFreqMhz(parseDecimal(match[1]));
    const locationRaw = cleanLocation(match[2]);
    if (!Number.isFinite(freqMhz) || !locationRaw) {
      continue;
    }
    if (freqMhz < FM_MIN_MHZ || freqMhz > FM_MAX_MHZ) {
      continue;
    }

    transmissions.push({
      cityName: extractCityName(locationRaw) || "Moldova",
      freqMhz,
      locationRaw,
    });
  }

  return transmissions;
}

function shouldSkipStatus(statusNote) {
  return /nu a fost notificat despre începerea emisiei/iu.test(statusNote);
}

function buildDescription({
  cityName,
  conceptName,
  coverageClass,
  licenseNumber,
  licenseeName,
  locationRaw,
  publicStatus,
  stationName,
  statusNote,
}) {
  const parts = [
    `Moldovan FM service listed by the Audiovisual Council for ${stationName} in ${cityName}.`,
    licenseeName ? `Licensee: ${licenseeName}.` : "",
    publicStatus && publicStatus !== "–" ? `Status: ${publicStatus}.` : "",
    coverageClass && coverageClass !== "–" ? `Coverage class: ${coverageClass}.` : "",
    conceptName && conceptName !== "–" ? `Format: ${conceptName}.` : "",
    licenseNumber ? `Licence: ${licenseNumber}.` : "",
    locationRaw ? `Distribution entry: ${locationRaw}.` : "",
    statusNote && statusNote !== "Activ" ? `Register note: ${statusNote}.` : "",
  ];

  return parts.filter(Boolean).join(" ");
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Moldova radio register ${url}: HTTP ${response.status}`);
  }

  return response.text();
}

export async function loadAnrcetiMdStations() {
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const html = await fetchText(AUDIOVISUAL_COUNCIL_RADIO_REGISTER_URL);
  const rows = extractRows(html);
  if (!rows.length) {
    throw new Error("Audiovisual Council radio register page does not expose any table rows");
  }

  const dedupe = new Map();

  for (const rowHtml of rows) {
    const cells = extractCells(rowHtml);
    if (cells.length < 12) {
      continue;
    }

    const stationName = cleanStationName(cells[1]?.text);
    const holderText = cells[2]?.text;
    const licenseeName = extractLicenseeName(holderText);
    const idno = extractIdno(holderText);
    const publicStatus = normalizeText(cells[7]?.text);
    const coverageClass = normalizeText(cells[8]?.text);
    const conceptName = normalizeText(cells[9]?.text);
    const license = extractLicenseMetadata(cells[10]?.text);
    const transmissions = extractTransmissionEntries(cells[11]?.text);

    if (!stationName || !licenseeName || !transmissions.length) {
      continue;
    }
    if (shouldSkipStatus(license.statusNote)) {
      continue;
    }

    for (const transmission of transmissions) {
      const dedupeKey = [
        stationName,
        license.licenseNumber,
        transmission.freqMhz.toFixed(3),
        transmission.locationRaw,
      ]
        .map((part) => normalizeText(part).toUpperCase())
        .join("|");

      if (dedupe.has(dedupeKey)) {
        continue;
      }

      const tags = new Set([
        "fm",
        "official",
        "moldova",
        "audiovisual-council",
        transmission.cityName ? toTag(transmission.cityName) : "moldova",
        license.licenseNumber ? toTag(license.licenseNumber) : "license",
      ]);

      if (publicStatus && publicStatus !== "–") {
        tags.add(toTag(publicStatus));
      }
      if (coverageClass && coverageClass !== "–") {
        tags.add(toTag(coverageClass));
      }
      if (conceptName && conceptName !== "–") {
        tags.add(toTag(conceptName));
      }

      dedupe.set(dedupeKey, {
        cityName: transmission.cityName,
        countryCode: "MD",
        curated: false,
        description: buildDescription({
          cityName: transmission.cityName,
          conceptName,
          coverageClass,
          licenseNumber: license.licenseNumber,
          licenseeName,
          locationRaw: transmission.locationRaw,
          publicStatus,
          stationName,
          statusNote: license.statusNote,
        }),
        freqMhz: transmission.freqMhz,
        name: stationName,
        source: "Consiliul Audiovizualului radio media register",
        sourceUrl: AUDIOVISUAL_COUNCIL_RADIO_REGISTER_URL,
        tags: [...tags],
        timezone: "Europe/Chisinau",
        verifiedAt,
        ...(idno ? { externalId: idno } : {}),
        ...(license.issueDate ? { startsAt: license.issueDate } : {}),
        ...(license.expiryDate ? { endsAt: license.expiryDate } : {}),
      });
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

export const ANRCETI_MD_SOURCE_URL = AUDIOVISUAL_COUNCIL_RADIO_REGISTER_URL;
