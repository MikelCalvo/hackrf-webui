import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  compareText,
  normalizeFreqMhz,
  normalizeKey,
  toTag,
} from "../lib/utils.mjs";

const execFileAsync = promisify(execFile);

const CNA_INDEX_URL =
  "https://cna.ro/a-situatii-privind-licentele-audiovizuale-avizele-de-furnizare-a-serviciilor-media-audiovizuale-la-cerere-avizele-de-retransmisie-si-autorizatiile-de-re-fl7wut28fqxu5c0y94sohaf7/";
const CNA_RADIO_PDF_PREFIX =
  "Licente_audiovizuale_pentru_difuzarea_serviciilor_de_programe_Radio_SITE";
const CNA_SRR_PDF_PREFIX =
  "Frecventele_serviciilor_de_programe_Radio_ale_SRR_SITE";
const USER_AGENT = "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)";
const PDF_CHAR_REPLACEMENTS = {
  "[": "ș",
  "\\": "ă",
  "]": "ț",
  "{": "Ș",
  "|": "Ă",
  "}": "Ț",
  "~": "Î",
  "`": "î",
};
const LICENSE_TOKEN_PATTERN = /^(?:R(?:-CI)?\s*\d+|S-R\s*\d+)$/u;
const TAIL_PATTERN =
  /^(?<license>(?:R(?:-CI)?\s*\d+|S-R\s*\d+))\s+(?<dateLic>\d{2}-[A-Za-z]{3}-\d{2})\s+(?<rest>.+)$/u;
const DECISION_AND_COVERAGE_PATTERN =
  /^(?<authorizationDate>\d{2}-[A-Za-z]{3}-\d{2}|-\s+-)\s*(?<coverage>.*)$/u;
const COMPANY_PREFIX_PATTERN =
  /^(?:SC|ASOCIAȚIA|ARHIEPISCOPIA|PATRIARHIA|SOCIETATEA|FUNDAȚIA|BISERICA|EPARHIA|UNIUNEA|UNIVERSITATEA|ADMINISTRAȚIA)\b/u;

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function decodeRomanianPdfText(value) {
  return String(value ?? "").replace(/[|\\{}\[\]~`]/gu, (char) => PDF_CHAR_REPLACEMENTS[char] || char);
}

function splitColumns(line) {
  return String(line ?? "")
    .replace(/\f/gu, "")
    .trim()
    .split(/\s{2,}/u)
    .map((part) => normalizeText(part))
    .filter(Boolean);
}

function appendText(base, next) {
  const left = normalizeText(base);
  const right = normalizeText(next);
  if (!right) {
    return left;
  }
  if (!left) {
    return right;
  }
  return `${left} ${right}`;
}

function isLicenseToken(value) {
  return LICENSE_TOKEN_PATTERN.test(normalizeText(value));
}

function looksLikeCompany(value) {
  return COMPANY_PREFIX_PATTERN.test(normalizeText(value));
}

function isMainHeaderOrFooter(line) {
  const normalized = normalizeText(line);
  if (!normalized) {
    return true;
  }

  return (
    normalized.startsWith("LICENȚE AUDIOVIZUALE") ||
    normalized.startsWith("a serviciilor de programe de radiodifuziune") ||
    normalized.startsWith("LOCALITATE JUDET FRECV.") ||
    normalized.startsWith("LOCALITATE JUDEȚ FRECV.") ||
    normalized.startsWith("Serviciul Licențe Autorizări") ||
    /^\d{2}\.\d{2}\.\d{4}$/u.test(normalized) ||
    /^Pag\.\s*\d+$/u.test(normalized)
  );
}

function isSrrHeaderOrFooter(line) {
  const normalized = normalizeText(line);
  if (!normalized) {
    return true;
  }

  return (
    normalized.startsWith("Licențe audiovizuale pentru difuzarea terestră") ||
    normalized.startsWith("ale Societății Române de Radiodifuziune") ||
    normalized.startsWith("NUME PROGRAM AMPLASAMENT JUDEȚ FRECVENȚA") ||
    normalized.startsWith("Serviciul Licențe Autorizări") ||
    /^\d{2}\.\d{2}\.\d{4}$/u.test(normalized) ||
    /^Pag\.\s*\d+$/u.test(normalized)
  );
}

function parseFrequencyLabel(value) {
  const label = normalizeText(value);
  if (!label) {
    return { kind: "blank" };
  }

  const upper = label.toUpperCase();
  if (upper.startsWith("SATELIT")) {
    return { kind: "satellite" };
  }
  if (upper.startsWith("INTERNET")) {
    return { kind: "internet" };
  }
  if (/KHZ$/iu.test(label)) {
    return { kind: "am" };
  }

  const numeric = Number(label.replace(",", "."));
  if (!Number.isFinite(numeric)) {
    return { kind: "unknown" };
  }
  if (numeric < 3) {
    return { kind: "am" };
  }
  if (numeric < 87 || numeric > 108.5) {
    return { kind: "other" };
  }

  return {
    kind: "fm",
    freqMhz: normalizeFreqMhz(numeric),
  };
}

function extractCoverageTags(coverage) {
  const normalized = normalizeKey(coverage);
  const tags = [];
  if (/(?:^|\s)local(?:$|\s)/u.test(normalized)) {
    tags.push("local");
  }
  if (/(?:^|\s)regional(?:$|\s)/u.test(normalized)) {
    tags.push("regional");
  }
  if (/(?:^|\s)national(?:$|\s)/u.test(normalized)) {
    tags.push("national");
  }
  if (/(?:^|\s)international(?:$|\s)/u.test(normalized)) {
    tags.push("international");
  }
  return tags;
}

function isSrrCompany(value) {
  const normalized = normalizeKey(value);
  return normalized.includes("societatea romana de") || normalized.includes("radiodifuziune");
}

function buildMainDescription({
  cityName,
  company,
  county,
  coverage,
  freqMhz,
  licenseId,
  licenseDate,
  name,
  theme,
}) {
  return [
    `Romanian CNA FM licence entry for ${name}.`,
    `Locality: ${cityName}${county ? `, ${county}` : ""}.`,
    `Frequency: ${freqMhz.toFixed(1)} MHz.`,
    company ? `Operator: ${company}.` : "",
    theme ? `Format: ${theme}.` : "",
    coverage ? `Coverage: ${coverage}.` : "",
    licenseId ? `Licence: ${licenseId}${licenseDate ? ` (${licenseDate})` : ""}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildSupplementDescription({
  cityName,
  company,
  county,
  coverage,
  freqMhz,
  licenseId,
  name,
  siteName,
}) {
  return [
    `Romanian public-radio FM frequency supplemented from the CNA SRR list for ${name}.`,
    `Locality: ${cityName}${county ? `, ${county}` : ""}.`,
    `Frequency: ${freqMhz.toFixed(1)} MHz.`,
    siteName ? `SRR transmitter listing: ${siteName}.` : "",
    company ? `Operator: ${company}.` : "",
    coverage ? `Coverage: ${coverage}.` : "",
    licenseId ? `Licence: ${licenseId}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildTags({ company, county, coverage, supplemental, theme }) {
  const tags = new Set(["fm", "official", "romania", "cna"]);
  if (county) {
    tags.add(toTag(county));
  }
  if (theme) {
    tags.add(toTag(theme));
  }
  if (isSrrCompany(company)) {
    tags.add("srr");
    tags.add("public-radio");
  }
  if (supplemental) {
    tags.add("supplemented");
  }
  for (const coverageTag of extractCoverageTags(coverage)) {
    tags.add(coverageTag);
  }
  return [...tags].filter(Boolean);
}

function stationDedupKey(station) {
  return [
    normalizeKey(station.cityName),
    normalizeKey(station.name),
    station.freqMhz.toFixed(3),
  ].join("|");
}

function parseTailText(tailText) {
  const tailMatch = normalizeText(tailText).match(TAIL_PATTERN);
  if (!tailMatch?.groups) {
    return undefined;
  }

  const coverageMatch = normalizeText(tailMatch.groups.rest).match(
    DECISION_AND_COVERAGE_PATTERN,
  );
  if (!coverageMatch?.groups) {
    return undefined;
  }

  return {
    authorizationDate: normalizeText(coverageMatch.groups.authorizationDate),
    coverage: normalizeText(coverageMatch.groups.coverage),
    licenseDate: normalizeText(tailMatch.groups.dateLic),
    licenseId: normalizeText(tailMatch.groups.license),
  };
}

function splitThemeAndCompany(value) {
  const text = normalizeText(value);
  if (!text) {
    return {
      company: "",
      theme: "",
    };
  }

  const companyMatch = text.match(COMPANY_PREFIX_PATTERN);
  if (!companyMatch) {
    return {
      company: "",
      theme: text,
    };
  }
  if ((companyMatch.index ?? 0) === 0) {
    return {
      company: text,
      theme: "",
    };
  }

  return {
    company: normalizeText(text.slice(companyMatch.index)),
    theme: normalizeText(text.slice(0, companyMatch.index)),
  };
}

function isLikelyCompanyContinuation(value) {
  return /\b(?:SRL|SA|ADVENTIST|PATRIARHALĂ|ROMÂNIA|INTERNATIONAL|CENTER|STUDIO|MEDIA|GROUP|RADIODIFUZIUNE)\b/u.test(
    normalizeText(value),
  );
}

function needsInstitutionContinuation(company) {
  return /^(?:ARHIEPISCOPIA|PATRIARHIA|FUNDAȚIA|BISERICA|EPARHIA|UNIUNEA|UNIVERSITATEA|SOCIETATEA)\b/u.test(
    normalizeText(company),
  );
}

function isLikelyCoverageContinuation(value, existingCoverage) {
  const normalizedValue = normalizeText(value);
  const normalizedCoverage = normalizeText(existingCoverage);
  return Boolean(
    normalizedCoverage &&
      (normalizedCoverage.includes("(") ||
        normalizedValue.endsWith(")") ||
        /\bjude/u.test(normalizedValue.toLocaleLowerCase("ro-RO")) ||
        normalizedValue.includes("Balcani")),
  );
}

function parseMainNumericRow(parts, licenseIndex) {
  const lead = parts.slice(0, licenseIndex);
  const tailData = parseTailText(parts.slice(licenseIndex).join(" "));
  if (!tailData || lead.length < 4) {
    return undefined;
  }

  const locality = normalizeText(lead[0]);
  const county = normalizeText(lead[1]);
  const frequencyLabel = normalizeText(lead[2]);
  const programName = normalizeText(lead[3]);
  const remainder = lead.slice(4);
  let theme = "";
  let company = "";

  if (remainder.length === 1) {
    const splitValue = splitThemeAndCompany(remainder[0]);
    theme = splitValue.theme;
    company = splitValue.company;
  } else if (remainder.length >= 2) {
    theme = normalizeText(remainder[0]);
    company = normalizeText(remainder.slice(1).join(" "));
  }

  return {
    company,
    county,
    coverage: tailData.coverage,
    frequencyLabel,
    kind: "main",
    licenseDate: tailData.licenseDate,
    licenseId: tailData.licenseId,
    locality,
    name: programName,
    theme,
  };
}

function appendMainContinuation(row, parts) {
  if (!parts.length) {
    return;
  }

  if (parts.length === 1) {
    if (isLikelyCoverageContinuation(parts[0], row.coverage)) {
      row.coverage = appendText(row.coverage, parts[0]);
      return;
    }
    if (
      isLikelyCompanyContinuation(parts[0]) ||
      (needsInstitutionContinuation(row.company) && row.theme)
    ) {
      row.company = appendText(row.company, parts[0]);
      return;
    }
    row.theme = appendText(row.theme, parts[0]);
    return;
  }

  row.theme = appendText(row.theme, parts[0]);
  row.company = appendText(row.company, parts[1]);
  if (parts.length > 2) {
    row.coverage = appendText(row.coverage, parts.slice(2).join(" "));
  }
}

function parseBlankSrrCandidate(parts, licenseIndex) {
  const lead = parts.slice(0, licenseIndex);
  if (lead.length < 3) {
    return undefined;
  }

  const locality = normalizeText(lead[0]);
  const county = normalizeText(lead[1]);
  const remaining = lead.slice(2);
  const name = normalizeText(remaining[0]);
  if (!locality || !county || !name) {
    return undefined;
  }

  let theme = "";
  let company = "";
  if (remaining.length === 2) {
    if (looksLikeCompany(remaining[1])) {
      company = normalizeText(remaining[1]);
    } else {
      theme = normalizeText(remaining[1]);
    }
  } else if (remaining.length >= 3) {
    theme = normalizeText(remaining.slice(1, -1).join(" "));
    company = normalizeText(remaining.at(-1));
  }

  if (!isSrrCompany(company)) {
    return undefined;
  }

  const tailData = parseTailText(parts.slice(licenseIndex).join(" "));
  if (!tailData) {
    return undefined;
  }

  return {
    company,
    county,
    coverage: tailData.coverage,
    licenseDate: tailData.licenseDate,
    licenseId: tailData.licenseId,
    locality,
    name,
    theme,
  };
}

function parseMainPdf(pdfText) {
  const decodedLines = decodeRomanianPdfText(pdfText).split(/\r?\n/u);
  const stations = [];
  const blankSrrCandidates = [];
  let currentRow;

  for (const line of decodedLines) {
    if (isMainHeaderOrFooter(line)) {
      continue;
    }

    const parts = splitColumns(line);
    const licenseIndex = parts.findIndex((part) => isLicenseToken(part));
    if (licenseIndex >= 0) {
      if (currentRow) {
        stations.push(currentRow);
        currentRow = undefined;
      }

      if (parts.length < 3) {
        continue;
      }

      const thirdColumn = parts[2];
      if (/^(?:SATELIT|INTERNET)\b/iu.test(thirdColumn)) {
        continue;
      }

      if (/^\d{1,3}[.,]\d{1,3}$/u.test(thirdColumn)) {
        const parsedRow = parseMainNumericRow(parts, licenseIndex);
        if (parsedRow) {
          currentRow = parsedRow;
        }
        continue;
      }

      const blankCandidate = parseBlankSrrCandidate(parts, licenseIndex);
      if (blankCandidate) {
        blankSrrCandidates.push(blankCandidate);
      }
      continue;
    }

    if (!currentRow) {
      continue;
    }
    appendMainContinuation(currentRow, parts);
  }

  if (currentRow) {
    stations.push(currentRow);
  }

  return { blankSrrCandidates, stations };
}

function parseSrrPdf(pdfText) {
  const stations = [];
  const decodedLines = decodeRomanianPdfText(pdfText).split(/\r?\n/u);

  for (const line of decodedLines) {
    if (isSrrHeaderOrFooter(line)) {
      continue;
    }

    const parts = splitColumns(line);
    if (parts.length < 6) {
      continue;
    }

    const [name, siteName, county, frequencyLabel, licenseId, licenseDate] = parts;
    const frequency = parseFrequencyLabel(frequencyLabel);
    if (frequency.kind !== "fm") {
      continue;
    }

    stations.push({
      county: normalizeText(county),
      freqMhz: frequency.freqMhz,
      licenseDate: normalizeText(licenseDate),
      licenseId: normalizeText(licenseId),
      name: normalizeText(name),
      siteName: normalizeText(siteName),
    });
  }

  return stations;
}

function buildMainStation(rawRow, pdfUrl, verifiedAt) {
  const frequency = parseFrequencyLabel(rawRow.frequencyLabel);
  if (frequency.kind !== "fm") {
    return undefined;
  }

  return {
    cityName: rawRow.locality,
    countryCode: "RO",
    curated: false,
    description: buildMainDescription({
      cityName: rawRow.locality,
      company: rawRow.company,
      county: rawRow.county,
      coverage: rawRow.coverage,
      freqMhz: frequency.freqMhz,
      licenseDate: rawRow.licenseDate,
      licenseId: rawRow.licenseId,
      name: rawRow.name,
      theme: rawRow.theme,
    }),
    freqMhz: frequency.freqMhz,
    name: rawRow.name,
    source: "CNA radio licence list PDF",
    sourceUrl: pdfUrl,
    tags: buildTags({
      company: rawRow.company,
      county: rawRow.county,
      coverage: rawRow.coverage,
      supplemental: false,
      theme: rawRow.theme,
    }),
    timezone: "Europe/Bucharest",
    verifiedAt,
  };
}

function siteMatchScore(siteName, locality) {
  const siteKey = normalizeKey(siteName);
  const localityKey = normalizeKey(locality);
  if (!siteKey || !localityKey) {
    return 0;
  }
  if (siteKey === localityKey) {
    return 3;
  }

  const parts = siteName
    .split(/\s+-\s+/u)
    .map((part) => normalizeKey(part))
    .filter(Boolean);
  if (parts[0] === localityKey || parts.at(-1) === localityKey) {
    return 2;
  }
  if (parts.includes(localityKey)) {
    return 1;
  }
  return 0;
}

function buildSupplementStation(candidate, supplementRow, pdfUrl, verifiedAt) {
  return {
    cityName: candidate.locality,
    countryCode: "RO",
    curated: false,
    description: buildSupplementDescription({
      cityName: candidate.locality,
      company: candidate.company,
      county: candidate.county,
      coverage: candidate.coverage,
      freqMhz: supplementRow.freqMhz,
      licenseId: candidate.licenseId,
      name: candidate.name,
      siteName: supplementRow.siteName,
    }),
    freqMhz: supplementRow.freqMhz,
    name: candidate.name,
    source: "CNA SRR radio frequencies PDF",
    sourceUrl: pdfUrl,
    tags: buildTags({
      company: candidate.company,
      county: candidate.county,
      coverage: candidate.coverage,
      supplemental: true,
      theme: candidate.theme,
    }),
    timezone: "Europe/Bucharest",
    verifiedAt,
  };
}

function supplementBlankSrrRows(blankSrrCandidates, srrStations, srrPdfUrl, verifiedAt) {
  const stationsByProgram = new Map();
  for (const row of srrStations) {
    const programKey = normalizeKey(row.name);
    const rows = stationsByProgram.get(programKey) ?? [];
    rows.push(row);
    stationsByProgram.set(programKey, rows);
  }

  const supplementedStations = [];
  for (const candidate of blankSrrCandidates) {
    const matchingRows = stationsByProgram.get(normalizeKey(candidate.name)) ?? [];
    if (!matchingRows.length) {
      continue;
    }

    const ranked = matchingRows
      .map((row) => ({
        row,
        score: siteMatchScore(row.siteName, candidate.locality),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (left.score !== right.score) {
          return right.score - left.score;
        }
        if (left.row.freqMhz !== right.row.freqMhz) {
          return left.row.freqMhz - right.row.freqMhz;
        }
        return compareText(left.row.siteName, right.row.siteName);
      });

    if (!ranked.length) {
      continue;
    }

    supplementedStations.push(
      buildSupplementStation(candidate, ranked[0].row, srrPdfUrl, verifiedAt),
    );
  }

  return supplementedStations;
}

async function fetchText(url, signal) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch CNA source ${url}: HTTP ${response.status}`);
  }

  return response.text();
}

async function downloadPdfText(url, signal) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to download CNA PDF ${url}: HTTP ${response.status}`);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hackrf-webui-cna-ro-"));
  const pdfPath = path.join(tempDir, "source.pdf");

  try {
    await fs.writeFile(pdfPath, Buffer.from(await response.arrayBuffer()));
    const { stdout } = await execFileAsync("pdftotext", [
      "-layout",
      "-enc",
      "UTF-8",
      pdfPath,
      "-",
    ]);
    return stdout;
  } finally {
    await fs.rm(tempDir, { force: true, recursive: true });
  }
}

function discoverCnaPdfUrls(indexHtml) {
  const pdfUrls = new Set();
  for (const match of indexHtml.matchAll(/https:\/\/media\.cna\.ro\/[^"'\\\s]+\.pdf/giu)) {
    pdfUrls.add(match[0]);
  }

  const urls = [...pdfUrls];
  const radioPdfUrl = urls.find((url) =>
    new URL(url).pathname.slice(1).startsWith(CNA_RADIO_PDF_PREFIX),
  );
  if (!radioPdfUrl) {
    throw new Error("Failed to discover the current CNA radio licence PDF URL");
  }

  const srrPdfUrl = urls.find((url) =>
    new URL(url).pathname.slice(1).startsWith(CNA_SRR_PDF_PREFIX),
  );

  return {
    radioPdfUrl,
    srrPdfUrl,
  };
}

export async function loadCnaRoStations({ signal } = {}) {
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const indexHtml = await fetchText(CNA_INDEX_URL, signal);
  const { radioPdfUrl, srrPdfUrl } = discoverCnaPdfUrls(indexHtml);
  const mainPdfText = await downloadPdfText(radioPdfUrl, signal);
  const parsedMain = parseMainPdf(mainPdfText);

  const dedupe = new Map();
  for (const rawRow of parsedMain.stations) {
    const station = buildMainStation(rawRow, radioPdfUrl, verifiedAt);
    if (!station) {
      continue;
    }
    const dedupeKey = stationDedupKey(station);
    if (!dedupe.has(dedupeKey)) {
      dedupe.set(dedupeKey, station);
    }
  }

  if (parsedMain.blankSrrCandidates.length && srrPdfUrl) {
    const srrPdfText = await downloadPdfText(srrPdfUrl, signal);
    const srrStations = parseSrrPdf(srrPdfText);
    for (const station of supplementBlankSrrRows(
      parsedMain.blankSrrCandidates,
      srrStations,
      srrPdfUrl,
      verifiedAt,
    )) {
      const dedupeKey = stationDedupKey(station);
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
