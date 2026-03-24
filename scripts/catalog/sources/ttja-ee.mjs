import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { compareText, normalizeFreqMhz, normalizeKey, toTag } from "../lib/utils.mjs";

const execFileAsync = promisify(execFile);

const TTJA_LANDING_PAGE_URL =
  "https://www.ttja.ee/eraklient/side-ja-meediateenused/raadioside/tv-ja-raadioringhaaling";

const SITE_CITY_ALIASES = new Map([
  ["muhu liiva", "Liiva"],
]);

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function splitColumns(value) {
  return String(value ?? "")
    .replace(/\f/g, "")
    .split(/\s{2,}/)
    .map(normalizeText)
    .filter(Boolean);
}

function titleCaseEstonian(value) {
  const normalized = normalizeText(value).toLocaleLowerCase("et");
  if (!normalized) {
    return "";
  }

  return normalized
    .split(/(\s+|-)/)
    .map((part) => {
      if (!part || /^\s+$/.test(part) || part === "-") {
        return part;
      }

      return `${part[0].toLocaleUpperCase("et")}${part.slice(1)}`;
    })
    .join("");
}

function formatSiteOrCountyLabel(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  return normalized === normalized.toLocaleUpperCase("et")
    ? titleCaseEstonian(normalized)
    : normalized;
}

function parsePdfDateFromUrl(pdfUrl) {
  const match = String(pdfUrl).match(/FMraadio_(\d{4})\.(\d{2})\.(\d{2})\.pdf/i);
  if (!match) {
    return "";
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function toProgramTag(value) {
  return toTag(String(value ?? "").replace(/\+/g, " plus "));
}

function normalizeProgrammeAlias(value) {
  return normalizeKey(String(value ?? "").replace(/\+/g, " plus "));
}

function buildProgrammeAliases(programName) {
  const raw = normalizeText(programName);
  const variants = new Set();
  const rawVariants = [
    raw,
    raw.replace(/\braadio\b/giu, "radio"),
    raw.replace(/\bradio\b/giu, "raadio"),
    raw.replace(/^(?:raadio|radio)\s+/iu, ""),
  ];

  if (!raw) {
    return [];
  }

  for (const variant of rawVariants) {
    const normalized = normalizeProgrammeAlias(variant);
    if (normalized) {
      variants.add(normalized);
    }
  }

  return [...variants].filter(Boolean);
}

function buildProgrammeLookup(entries) {
  const lookup = new Map();

  for (const entry of entries) {
    for (const alias of buildProgrammeAliases(entry.programName)) {
      if (!lookup.has(alias)) {
        lookup.set(alias, entry);
      }
    }
  }

  return lookup;
}

function findProgrammeMetadata(lookup, title) {
  for (const alias of buildProgrammeAliases(title)) {
    const entry = lookup.get(alias);
    if (entry) {
      return entry;
    }
  }

  return undefined;
}

function deriveCityName(siteName) {
  const formattedSite = formatSiteOrCountyLabel(siteName);
  if (!formattedSite) {
    return "";
  }

  const alias = SITE_CITY_ALIASES.get(normalizeKey(formattedSite));
  if (alias) {
    return alias;
  }

  if (formattedSite.includes(" ")) {
    return normalizeText(formattedSite.split(/\s+/)[0]);
  }

  return formattedSite;
}

function parseFreqMhz(value) {
  return normalizeFreqMhz(normalizeText(value).replace(",", "."));
}

function polarizationTag(value) {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === "V") {
    return "vertical-polarization";
  }
  if (normalized === "H") {
    return "horizontal-polarization";
  }
  return "mixed-polarization";
}

function buildDescription({
  cityName,
  countyName,
  documentDate,
  language,
  polarization,
  programName,
  provider,
  siteName,
}) {
  return [
    `Estonian FM transmitter listed by TTJA for ${cityName}.`,
    `Program: ${programName}.`,
    provider ? `Provider: ${provider}.` : "",
    language ? `Language: ${language}.` : "",
    siteName ? `Transmitter site: ${siteName}.` : "",
    countyName ? `County: ${countyName}.` : "",
    polarization ? `Polarization: ${polarization}.` : "",
    documentDate ? `Document date: ${documentDate}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function extractCurrentPdfUrl(html) {
  const matches = new Set(
    [...String(html).matchAll(/href="([^"]*FMraadio_\d{4}\.\d{2}\.\d{2}\.pdf[^"]*)"/gi)].map(
      (match) => new URL(match[1], TTJA_LANDING_PAGE_URL).toString(),
    ),
  );
  const candidates = [...matches];

  if (candidates.length === 0) {
    throw new Error("Failed to discover current TTJA FM PDF");
  }

  return candidates.sort((left, right) => {
    const leftDate = parsePdfDateFromUrl(left).replace(/-/g, "");
    const rightDate = parsePdfDateFromUrl(right).replace(/-/g, "");
    return rightDate.localeCompare(leftDate);
  })[0];
}

async function curlText(url) {
  const { stdout } = await execFileAsync("curl", [
    "-fsSL",
    "--max-time",
    "90",
    "-A",
    "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    url,
  ]);
  return stdout;
}

async function downloadPdfText(pdfUrl) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hackrf-webui-ee-"));
  const pdfPath = path.join(tempDir, "source.pdf");

  try {
    await execFileAsync("curl", [
      "-fsSL",
      "--max-time",
      "120",
      "-A",
      "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
      "-o",
      pdfPath,
      pdfUrl,
    ]);
    const { stdout } = await execFileAsync("pdftotext", ["-layout", pdfPath, "-"], {
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("pdftotext is required to parse the official TTJA FM PDF");
    }
    throw error;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function parseProgrammeMetadata(pdfText) {
  const entries = [];
  let inOverview = false;
  let pendingProviderLines = [];
  let pendingEntry = null;

  for (const rawLine of pdfText.split(/\r?\n/)) {
    const line = normalizeText(rawLine);
    if (line === "Eestis väljastatud raadioload") {
      inOverview = true;
      continue;
    }

    if (!inOverview) {
      continue;
    }

    if (line.includes("kokku:")) {
      break;
    }

    if (!line || line.startsWith("Raadioprogramm")) {
      continue;
    }

    const columns = splitColumns(rawLine);
    if (columns.length >= 3) {
      pendingEntry = null;
      pendingProviderLines = [];
      entries.push({
        programName: columns[0],
        provider: columns[1],
        language: columns.slice(2).join(" "),
      });
      continue;
    }

    if (columns.length === 2) {
      pendingEntry = {
        programName: columns[0],
        provider: normalizeText(pendingProviderLines.join(" ")),
        language: columns[1],
      };
      pendingProviderLines = [];
      entries.push(pendingEntry);
      continue;
    }

    if (columns.length === 1) {
      if (pendingEntry) {
        pendingEntry.provider = normalizeText(
          [pendingEntry.provider, columns[0]].filter(Boolean).join(" "),
        );
      } else {
        pendingProviderLines.push(columns[0]);
      }
    }
  }

  return entries.map((entry) => ({
    language: normalizeText(entry.language),
    programName: normalizeText(entry.programName),
    provider: normalizeText(entry.provider),
  }));
}

function extractPageTitle(pageText) {
  const lines = pageText.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => normalizeText(line).startsWith("Asukoht"));
  if (headerIndex < 0) {
    return "";
  }

  for (let index = headerIndex - 1; index >= 0; index -= 1) {
    const candidate = normalizeText(lines[index]);
    if (candidate) {
      return candidate;
    }
  }

  return "";
}

function parseProgrammePages(pdfText, metadataLookup, pdfUrl) {
  const documentDate = parsePdfDateFromUrl(pdfUrl);
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();
  const rowPattern =
    /^(?<site>.+?)\s{2,}(?<county>[\p{Letter}\p{Mark}\-]+(?:\s+[\p{Letter}\p{Mark}\-]+)*\s+maakond)\s{2,}(?<freq>\d{2,3},\d)\s{2,}(?<pol>[VH](?:\/[VH])?)\s*$/u;

  for (const pageText of pdfText.split("\f")) {
    if (!pageText.includes("Asukoht") || !pageText.includes("MHz")) {
      continue;
    }

    const pageTitle = extractPageTitle(pageText);
    if (!pageTitle) {
      continue;
    }

    const metadata =
      findProgrammeMetadata(metadataLookup, pageTitle) ?? {
        language: "",
        programName: pageTitle,
        provider: "",
      };
    const canonicalProgramName = metadata.programName || pageTitle;

    for (const rawLine of pageText.split(/\r?\n/)) {
      const match = rawLine.match(rowPattern);
      if (!match?.groups) {
        continue;
      }

      const siteName = formatSiteOrCountyLabel(match.groups.site);
      const countyName = formatSiteOrCountyLabel(match.groups.county);
      const cityName = deriveCityName(siteName);
      const freqMhz = parseFreqMhz(match.groups.freq);
      const polarization = normalizeText(match.groups.pol).toUpperCase();

      if (!siteName || !cityName || !Number.isFinite(freqMhz)) {
        continue;
      }

      const dedupeKey = [
        normalizeKey(canonicalProgramName),
        normalizeKey(siteName),
        normalizeKey(cityName),
        freqMhz.toFixed(3),
      ].join("|");
      if (dedupe.has(dedupeKey)) {
        continue;
      }

      dedupe.set(dedupeKey, {
        cityName,
        countryCode: "EE",
        curated: false,
        description: buildDescription({
          cityName,
          countyName,
          documentDate,
          language: metadata.language,
          polarization,
          programName: canonicalProgramName,
          provider: metadata.provider,
          siteName,
        }),
        freqMhz,
        name: canonicalProgramName,
        source: "TTJA FM radio overview PDF",
        sourceUrl: pdfUrl,
        tags: [
          "fm",
          "official",
          "ttja",
          "estonia",
          toProgramTag(canonicalProgramName),
          toTag(cityName),
          toTag(countyName.replace(/\s+maakond$/u, "")),
          polarizationTag(polarization),
        ],
        timezone: "Europe/Tallinn",
        verifiedAt,
      });
    }
  }

  return [...dedupe.values()];
}

export async function loadTtjaEeStations({ signal } = {}) {
  if (signal?.aborted) {
    throw new Error("TTJA importer aborted before start");
  }

  const landingHtml = await curlText(TTJA_LANDING_PAGE_URL);
  const pdfUrl = extractCurrentPdfUrl(landingHtml);
  const pdfText = await downloadPdfText(pdfUrl);
  const metadataLookup = buildProgrammeLookup(parseProgrammeMetadata(pdfText));
  const stations = parseProgrammePages(pdfText, metadataLookup, pdfUrl);

  if (stations.length === 0) {
    throw new Error("TTJA FM parser returned no stations");
  }

  return stations.sort((left, right) => {
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
