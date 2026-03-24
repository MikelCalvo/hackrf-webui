import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { compareText, normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const execFileAsync = promisify(execFile);

const TELEOFF_ROOT_URL =
  "https://www.teleoff.gov.sk/urad/odbory-oddelenia/odbor-spravy-frekvencneho-spektra/zoznam-rozhodnuti-oblasti-spravy-frekvencneho-spektra/rozhlasova-televizna-sluzba/rozhlasove-analogove-pozemske-vysielanie/";

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseFreq(value) {
  const numeric = Number(normalizeText(value).replace(",", "."));
  return Number.isFinite(numeric) ? normalizeFreqMhz(numeric) : NaN;
}

function dmsToDecimal(dms) {
  const match = normalizeText(dms).match(/^(\d+)[°º]\s*(\d+)'?\s*(\d+)"?$/u);
  if (!match) {
    return NaN;
  }

  const [, degreesRaw, minutesRaw, secondsRaw] = match;
  const degrees = Number(degreesRaw);
  const minutes = Number(minutesRaw);
  const seconds = Number(secondsRaw);
  if (![degrees, minutes, seconds].every(Number.isFinite)) {
    return NaN;
  }

  return Number.parseFloat((degrees + minutes / 60 + seconds / 3600).toFixed(6));
}

function extractPdfLinks(html, pageUrl) {
  const pdfUrls = new Set();
  const dirUrls = new Set();
  const hrefPattern = /href="([^"]+)"/gi;

  for (const match of html.matchAll(hrefPattern)) {
    const href = match[1];
    if (!href) {
      continue;
    }

    const absoluteUrl = new URL(href, pageUrl).toString();
    if (absoluteUrl.startsWith(TELEOFF_ROOT_URL) && absoluteUrl.includes("actualDir=")) {
      dirUrls.add(absoluteUrl);
      continue;
    }

    if (
      absoluteUrl.startsWith("https://www.teleoff.gov.sk/files/") &&
      absoluteUrl.toLowerCase().endsWith(".pdf") &&
      absoluteUrl.includes("/rozhlasove-analogove-pozemske-vysielanie/")
    ) {
      pdfUrls.add(absoluteUrl);
    }
  }

  return {
    dirUrls: [...dirUrls],
    pdfUrls: [...pdfUrls],
  };
}

async function curlText(url) {
  const { stdout } = await execFileAsync("curl", [
    "-fsSLk",
    "--max-time",
    "90",
    url,
  ]);
  return stdout;
}

async function downloadPdfText(url) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hackrf-webui-sk-"));
  const pdfPath = path.join(tempDir, "source.pdf");

  try {
    await execFileAsync("curl", [
      "-fsSLk",
      "--max-time",
      "120",
      "-o",
      pdfPath,
      url,
    ]);
    const { stdout } = await execFileAsync("pdftotext", ["-layout", pdfPath, "-"]);
    return stdout;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function crawlTeleoffPdfUrls() {
  const queued = [TELEOFF_ROOT_URL];
  const seenPages = new Set();
  const pdfUrls = new Set();

  while (queued.length) {
    const pageUrl = queued.shift();
    if (!pageUrl || seenPages.has(pageUrl)) {
      continue;
    }

    seenPages.add(pageUrl);
    const html = await curlText(pageUrl);
    const discovered = extractPdfLinks(html, pageUrl);
    for (const pdfUrl of discovered.pdfUrls) {
      pdfUrls.add(pdfUrl);
    }
    for (const dirUrl of discovered.dirUrls) {
      if (!seenPages.has(dirUrl)) {
        queued.push(dirUrl);
      }
    }
  }

  return [...pdfUrls].sort(compareText);
}

function extractField(text, pattern) {
  return normalizeText(text.match(pattern)?.[1] ?? "");
}

function buildDescription({ cityName, operatorName, programmeName }) {
  return [
    `Slovak FM decision listed by Teleoff for ${cityName}.`,
    programmeName ? `Programme service: ${programmeName}.` : "",
    operatorName ? `Operator: ${operatorName}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function parseDecisionPdf(pdfText, pdfUrl) {
  const programmeName = extractField(
    pdfText,
    /Názov rozhlasovej programovej\s*\n\s*([^\n]+)\n\s*služby/isu,
  );
  const operatorName = extractField(
    pdfText,
    /Držiteľ povolenia[\s\S]*?\nNázov\s+([^\n]+)\n/isu,
  );
  const cityName = extractField(pdfText, /^Stanovište\s+([^\n]+)/imu);
  const frequencyLabel = extractField(
    pdfText,
    /Frekvencia(?: podľa .*?)?\s+(\d{2,3},\d)\s*MHz/isu,
  );
  const longitudeDms = extractField(
    pdfText,
    /^LON\s+[–-]\s*E \(WGS 84\)\s+([^\n]+)/imu,
  );
  const latitudeDms = extractField(
    pdfText,
    /^LAT\s+[–-]\s*N \(WGS 84\)\s+([^\n]+)/imu,
  );
  const freqMhz = parseFreq(frequencyLabel);
  const longitude = dmsToDecimal(longitudeDms);
  const latitude = dmsToDecimal(latitudeDms);

  if (!cityName || !programmeName || !Number.isFinite(freqMhz)) {
    return undefined;
  }

  return {
    cityName,
    countryCode: "SK",
    curated: false,
    description: buildDescription({
      cityName,
      operatorName,
      programmeName,
    }),
    freqMhz,
    latitude: Number.isFinite(latitude) ? latitude : undefined,
    longitude: Number.isFinite(longitude) ? longitude : undefined,
    name: programmeName,
    source: "Teleoff FM decision PDF",
    sourceUrl: pdfUrl,
    tags: [
      "fm",
      "official",
      "slovakia",
      "teleoff",
      toTag(programmeName),
    ],
    timezone: "Europe/Bratislava",
    verifiedAt: new Date().toISOString().slice(0, 10),
  };
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

export async function loadTeleoffSkStations() {
  const pdfUrls = await crawlTeleoffPdfUrls();
  const parsedRows = await mapPool(pdfUrls, 4, async (pdfUrl) => {
    const pdfText = await downloadPdfText(pdfUrl);
    return parseDecisionPdf(pdfText, pdfUrl);
  });

  const dedupe = new Map();
  for (const row of parsedRows.filter(Boolean)) {
    const key = `${row.cityName}|${row.name}|${row.freqMhz.toFixed(3)}`;
    if (!dedupe.has(key)) {
      dedupe.set(key, row);
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
