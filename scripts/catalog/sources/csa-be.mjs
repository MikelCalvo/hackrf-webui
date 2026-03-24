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

const CSA_ROOT_URL = "https://www.csa.be";
const CSA_RADIO_CATEGORY_URL = "https://www.csa.be/categorie-service/radio/";
const CSA_RADIO_PROVINCE_PDF_URL =
  "https://www.csa.be/wp-content/uploads/2025/06/liste_radiosinde-provinces-2025.pdf";
const USER_AGENT = "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)";
const REQUEST_TIMEOUT_MS = 15000;
const CATEGORY_FETCH_CONCURRENCY = 4;
const SERVICE_FETCH_CONCURRENCY = 6;
const MAX_FETCH_RETRIES = 2;
const LOWERCASE_SITE_WORDS = new Set([
  "a",
  "au",
  "aux",
  "d",
  "de",
  "des",
  "du",
  "en",
  "et",
  "l",
  "la",
  "le",
  "les",
  "sous",
  "sur",
]);

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&rsquo;/gi, "'")
    .replace(/&lsquo;/gi, "'")
    .replace(/&ldquo;/gi, '"')
    .replace(/&rdquo;/gi, '"')
    .replace(/&hellip;/gi, "...")
    .replace(/&eacute;/gi, "e")
    .replace(/&egrave;/gi, "e")
    .replace(/&ecirc;/gi, "e")
    .replace(/&agrave;/gi, "a")
    .replace(/&ccedil;/gi, "c")
    .replace(/&ocirc;/gi, "o")
    .replace(/&ucirc;/gi, "u")
    .replace(/&uuml;/gi, "u")
    .replace(/&iuml;/gi, "i")
    .replace(/&ouml;/gi, "o")
    .replace(/&auml;/gi, "a");
}

function stripTags(value) {
  return decodeHtmlEntities(String(value ?? "").replace(/<[^>]+>/g, " "));
}

function cleanText(value) {
  return normalizeText(stripTags(value));
}

function parseFreqMhz(value) {
  const raw = normalizeText(value).replace(/mhz$/i, "").replace(",", ".");
  return normalizeFreqMhz(raw);
}

function formatSiteName(value) {
  const text = normalizeText(value);
  if (!text || text !== text.toUpperCase()) {
    return text;
  }

  const parts = text.toLowerCase().split(/([ '\-/])/);

  return parts
    .map((part, index) => {
      if (!part || /^[ '\-/]$/.test(part)) {
        return part;
      }

      if (index > 0 && LOWERCASE_SITE_WORDS.has(part)) {
        return part;
      }

      return `${part[0].toUpperCase()}${part.slice(1)}`;
    })
    .join("");
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractXmlServiceUrls(xmlText) {
  const urls = new Set();

  for (const match of String(xmlText).matchAll(/href="(https:\/\/www\.csa\.be\/service\/[^"]+)"/gi)) {
    urls.add(match[1]);
  }

  return [...urls];
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildFetchSignal(signal) {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function logSourceWarning(message) {
  console.warn(`[csa-be] ${message}`);
}

async function fetchText(url, { retries = MAX_FETCH_RETRIES, signal } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        signal: buildFetchSignal(signal),
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "fr-BE,fr;q=0.9,en;q=0.8",
          "user-agent": USER_AGENT,
        },
      });

      if (res.ok) {
        return res.text();
      }

      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(400 * 2 ** attempt);
        continue;
      }

      throw new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
      if (signal?.aborted) {
        throw error;
      }
      if (attempt < retries) {
        await sleep(400 * 2 ** attempt);
        continue;
      }
    }
  }

  throw new Error(`Failed to download CSA page for ${url}: ${lastError?.message ?? "unknown error"}`);
}

async function fetchBinary(url, { retries = MAX_FETCH_RETRIES, signal } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        signal: buildFetchSignal(signal),
        headers: {
          accept: "application/pdf,*/*;q=0.8",
          "accept-language": "fr-BE,fr;q=0.9,en;q=0.8",
          "user-agent": USER_AGENT,
        },
      });

      if (res.ok) {
        return Buffer.from(await res.arrayBuffer());
      }

      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(400 * 2 ** attempt);
        continue;
      }

      throw new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
      if (signal?.aborted) {
        throw error;
      }
      if (attempt < retries) {
        await sleep(400 * 2 ** attempt);
        continue;
      }
    }
  }

  throw new Error(`Failed to download CSA PDF for ${url}: ${lastError?.message ?? "unknown error"}`);
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function extractArchiveServiceUrls(pageHtml) {
  return uniq(
    [
      ...String(pageHtml).matchAll(
        /<h2[^>]*class=["'][^"']*entry-title[^"']*fusion-post-title[^"']*["'][^>]*>\s*<a href=(["'])(\/service\/[^"'#?]+\/?|https:\/\/www\.csa\.be\/service\/[^"'#?]+\/?)\1/gi,
      ),
    ].map((match) => new URL(match[2], CSA_ROOT_URL).href),
  );
}

function extractArchivePageCount(pageHtml) {
  const dataPagesMatch = String(pageHtml).match(/fusion-posts-container[^>]*data-pages=["'](\d+)["']/i);
  if (dataPagesMatch) {
    return Number.parseInt(dataPagesMatch[1], 10);
  }

  const pageNumbers = [...String(pageHtml).matchAll(/\/categorie-service\/radio\/page\/(\d+)\/?/g)].map(
    (match) => Number.parseInt(match[1], 10),
  );

  return Math.max(1, ...pageNumbers);
}

async function discoverServiceUrlsFromPdf({ signal } = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hackrf-webui-csa-be-"));
  const pdfPath = path.join(tempDir, "source.pdf");
  const xmlBasePath = path.join(tempDir, "source");

  try {
    const pdfBuffer = await fetchBinary(CSA_RADIO_PROVINCE_PDF_URL, { signal });
    await fs.writeFile(pdfPath, pdfBuffer);
    await execFileAsync("pdftohtml", ["-xml", "-i", "-q", pdfPath, xmlBasePath]);
    const xmlText = await fs.readFile(`${xmlBasePath}.xml`, "utf8");
    return extractXmlServiceUrls(xmlText);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function discoverServiceUrls({ signal } = {}) {
  try {
    const pdfServiceUrls = await discoverServiceUrlsFromPdf({ signal });
    if (pdfServiceUrls.length > 0) {
      return [...new Set(pdfServiceUrls)].sort(compareText);
    }

    logSourceWarning("CSA province PDF discovery returned no radio service links.");
  } catch (error) {
    logSourceWarning(`CSA province PDF discovery failed: ${error.message}`);
  }

  const serviceUrls = new Set();

  try {
    const firstPageHtml = await fetchText(CSA_RADIO_CATEGORY_URL, { signal });
    const totalPages = extractArchivePageCount(firstPageHtml);
    const pageUrls = [CSA_RADIO_CATEGORY_URL];

    for (let pageNumber = 2; pageNumber <= totalPages; pageNumber += 1) {
      pageUrls.push(`${CSA_RADIO_CATEGORY_URL}page/${pageNumber}/`);
    }

    const pageHtmls = [
      firstPageHtml,
      ...(await mapLimit(pageUrls.slice(1), CATEGORY_FETCH_CONCURRENCY, (pageUrl) =>
        fetchText(pageUrl, { signal }),
      )),
    ];

    for (const pageHtml of pageHtmls) {
      for (const serviceUrl of extractArchiveServiceUrls(pageHtml)) {
        serviceUrls.add(serviceUrl);
      }
    }
  } catch (error) {
    logSourceWarning(`Failed to discover CSA radio services from archive: ${error.message}`);
  }

  return [...serviceUrls].sort(compareText);
}

function extractInfoMap(serviceHtml) {
  const infoMap = new Map();
  const pattern =
    /<li>\s*<span[^>]*class=['"][^'"]*info-name[^'"]*['"][^>]*>([\s\S]*?)<\/span>\s*<span[^>]*class=['"][^'"]*info-value[^'"]*['"][^>]*>([\s\S]*?)<\/span>\s*<\/li>/gi;

  for (const match of String(serviceHtml).matchAll(pattern)) {
    const label = cleanText(match[1]);
    const value = cleanText(match[2]);
    const key = normalizeKey(label);

    if (!key || !value || infoMap.has(key)) {
      continue;
    }

    infoMap.set(key, value);
  }

  return infoMap;
}

function extractAnalogRows(serviceHtml) {
  const analogMatch = String(serviceHtml).match(/En mode analogique<\/h4>([\s\S]*?)<\/ul>/i);
  if (!analogMatch) {
    return [];
  }

  const rows = [];
  for (const match of analogMatch[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const rowText = cleanText(match[1]);
    const rowMatch = rowText.match(/^(.+?)\s*:\s*(\d{1,3}(?:[.,]\d+)?)\s*MHz\b/i);
    if (!rowMatch) {
      continue;
    }

    const cityName = formatSiteName(rowMatch[1]);
    const freqMhz = parseFreqMhz(rowMatch[2]);
    if (!cityName || !Number.isFinite(freqMhz)) {
      continue;
    }

    rows.push({
      cityName,
      freqMhz,
    });
  }

  return rows;
}

function buildDescription({ category, cityName, editorName, profile, stationName }) {
  return [
    `Belgian FM transmitter listed by CSA for ${cityName}.`,
    stationName ? `Service: ${stationName}.` : "",
    editorName ? `Licensee: ${editorName}.` : "",
    category ? `Category: ${category}.` : "",
    profile ? `Profile: ${profile}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function parseServicePage(serviceHtml, serviceUrl, verifiedAt) {
  const infoMap = extractInfoMap(serviceHtml);
  const stationName = infoMap.get("nom du service") ?? "";
  const editorName = infoMap.get("editeur") ?? "";
  const authority = infoMap.get("autorite de regulation") ?? "";
  const sector = infoMap.get("secteur") ?? "";
  const category = infoMap.get("categorie") ?? "";
  const profile = infoMap.get("profil") ?? "";
  const analogRows = extractAnalogRows(serviceHtml);

  if (normalizeKey(authority) !== "csa" || normalizeKey(sector) !== "radio" || analogRows.length === 0) {
    return [];
  }

  return analogRows.map(({ cityName, freqMhz }) => ({
    cityName,
    countryCode: "BE",
    curated: false,
    description: buildDescription({
      category,
      cityName,
      editorName,
      profile,
      stationName,
    }),
    freqMhz,
    name: stationName,
    source: "CSA service registry",
    sourceUrl: serviceUrl,
    tags: uniq([
      "fm",
      "official",
      "csa",
      "belgium",
      "wallonia-brussels",
      toTag(stationName),
      toTag(cityName),
      toTag(category),
      toTag(profile),
    ]),
    timezone: "Europe/Brussels",
    verifiedAt,
  }));
}

export async function loadCsaBeStations({ signal } = {}) {
  let serviceUrls;

  try {
    serviceUrls = await discoverServiceUrls({ signal });
  } catch (error) {
    logSourceWarning(`Failed to discover CSA radio services: ${error.message}`);
    return [];
  }

  if (serviceUrls.length === 0) {
    logSourceWarning("CSA discovery returned no radio service pages.");
    return [];
  }

  const verifiedAt = new Date().toISOString().slice(0, 10);
  const pageResults = await mapLimit(serviceUrls, SERVICE_FETCH_CONCURRENCY, async (serviceUrl) => {
    try {
      const serviceHtml = await fetchText(serviceUrl, { signal });
      return {
        rows: parseServicePage(serviceHtml, serviceUrl, verifiedAt),
        serviceUrl,
      };
    } catch (error) {
      return {
        error: error.message,
        rows: [],
        serviceUrl,
      };
    }
  });
  const dedupe = new Map();
  let failedServicePages = 0;

  for (const result of pageResults) {
    if (result.error) {
      failedServicePages += 1;
    }

    for (const row of result.rows) {
      if (!row.name || !row.cityName || !Number.isFinite(row.freqMhz)) {
        continue;
      }

      const dedupeKey = [
        normalizeKey(row.name),
        normalizeKey(row.cityName),
        row.freqMhz.toFixed(3),
      ].join("|");

      if (!dedupe.has(dedupeKey)) {
        dedupe.set(dedupeKey, row);
      }
    }
  }

  if (failedServicePages > 0) {
    logSourceWarning(`Skipped ${failedServicePages} CSA service pages due to fetch failures.`);
  }

  if (dedupe.size === 0) {
    const error = new Error(
      "CSA importer produced zero FM rows; source may be unstable or page structure may have changed.",
    );
    logSourceWarning(error.message);
    throw error;
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
