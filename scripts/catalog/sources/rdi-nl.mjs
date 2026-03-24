import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { compareText, normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const execFileAsync = promisify(execFile);

const RDI_LCO_URL = "https://www.rdi.nl/documenten/2023/08/28/vergunningen-lco";
const RDI_NLCO_URL =
  "https://www.rdi.nl/documenten/vergunningen/2025/07/04/vergunningen-pakketten-nlco";
const NLCO_FALLBACK_TECHNICAL_URL =
  "https://zoek.officielebekendmakingen.nl/stcrt-2024-36945.pdf";

function normalizeText(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#xEB;/gi, "ë")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function cleanHtmlText(value) {
  return normalizeText(
    String(value ?? "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function parseDutchNumber(value) {
  const numeric = Number(normalizeText(value).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(numeric) ? numeric : NaN;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Dutch source page ${url}: HTTP ${response.status}`);
  }

  return response.text();
}

async function downloadPdfText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download Dutch FM PDF ${url}: HTTP ${response.status}`);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hackrf-webui-nl-"));
  const pdfPath = path.join(tempDir, "source.pdf");

  try {
    await fs.writeFile(pdfPath, Buffer.from(await response.arrayBuffer()));
    const { stdout } = await execFileAsync("pdftotext", ["-layout", pdfPath, "-"]);
    return stdout;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function parsePackageEntriesFromHtml(html, series) {
  const entriesByPackageId = new Map();
  const linkPattern = /<a[^>]+href="([^"]+\.pdf[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(linkPattern)) {
    const pdfUrl = new URL(match[1], "https://www.rdi.nl").toString();
    const label = cleanHtmlText(match[2]);
    const packageMatch = label.match(/\b([AB]\d{2})\b/u);
    if (!packageMatch) {
      continue;
    }

    const packageId = packageMatch[1];
    let holderName = "";

    if (series === "LCO") {
      holderName = normalizeText(
        label.match(/Vergunning LCO\s+(.+?)\s+kavel\s+[AB]\d{2}\b/iu)?.[1] ?? "",
      );
    } else {
      holderName = normalizeText(
        label.match(/Download:\s*(.+?)\s+FM vergunning\s+[AB]\d{2}\b/iu)?.[1] ?? "",
      );
    }

    if (!holderName) {
      continue;
    }

    entriesByPackageId.set(packageId, {
      holderName,
      packageId,
      pdfUrl,
      series,
    });
  }

  return [...entriesByPackageId.values()].sort((left, right) =>
    compareText(left.packageId, right.packageId),
  );
}

function parseSummaryRows(pdfText, packageId) {
  const blockPattern = new RegExp(
    String.raw`Samenstelling Kavel\s+${packageId}[\s\S]*?Opstelplaats\s+Frequentie\s+Vermogen \(ERP\)\s*([\s\S]*?)Toelichting bij punt 5:`,
    "u",
  );
  const blockMatch = pdfText.match(blockPattern);
  if (!blockMatch) {
    return [];
  }

  const rows = [];
  for (const line of blockMatch[1].split(/\r?\n/)) {
    const rowMatch = line.match(
      /^(.+?)\s+(\d{2,3},\d)\s+MHz\s+([\d.,]+)\s+kW$/u,
    );
    if (!rowMatch) {
      continue;
    }

    const siteName = normalizeText(rowMatch[1]);
    const freqMhz = normalizeFreqMhz(parseDutchNumber(rowMatch[2]));
    const erpKw = parseDutchNumber(rowMatch[3]);
    if (!siteName || !Number.isFinite(freqMhz)) {
      continue;
    }

    rows.push({
      erpKw,
      freqMhz,
      siteName,
    });
  }

  return rows;
}

function buildDescription({ cityName, erpKw, holderName, packageId, series }) {
  return [
    `Dutch ${series} FM licence entry listed by RDI for ${cityName}.`,
    `Licence holder: ${holderName}.`,
    `Package: ${packageId}.`,
    Number.isFinite(erpKw) ? `ERP: ${erpKw.toFixed(3)} kW.` : "",
  ]
    .filter(Boolean)
    .join(" ");
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
  return results.flat();
}

export async function loadRdiNlStations() {
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const [lcoHtml, nlcoHtml, nlcoFallbackText] = await Promise.all([
    fetchHtml(RDI_LCO_URL),
    fetchHtml(RDI_NLCO_URL),
    downloadPdfText(NLCO_FALLBACK_TECHNICAL_URL),
  ]);

  const packageEntries = [
    ...parsePackageEntriesFromHtml(lcoHtml, "LCO"),
    ...parsePackageEntriesFromHtml(nlcoHtml, "NLCO"),
  ];

  const dedupe = new Map();
  const stationRows = await mapPool(packageEntries, 4, async (entry) => {
    const pdfText = await downloadPdfText(entry.pdfUrl);
    const rows = parseSummaryRows(pdfText, entry.packageId);
    if (rows.length) {
      return rows.map((row) => ({ ...row, ...entry }));
    }

    if (entry.series === "NLCO") {
      return parseSummaryRows(nlcoFallbackText, entry.packageId).map((row) => ({
        ...row,
        ...entry,
      }));
    }

    return [];
  });

  for (const station of stationRows) {
    const dedupeKey = `${station.packageId}|${station.siteName}|${station.freqMhz.toFixed(3)}`;
    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.set(dedupeKey, {
      cityName: station.siteName,
      countryCode: "NL",
      curated: false,
      description: buildDescription({
        cityName: station.siteName,
        erpKw: station.erpKw,
        holderName: station.holderName,
        packageId: station.packageId,
        series: station.series,
      }),
      freqMhz: station.freqMhz,
      name: station.holderName,
      source: "RDI FM licence PDF",
      sourceUrl: station.pdfUrl,
      tags: [
        "fm",
        "official",
        "netherlands",
        "rdi",
        toTag(station.packageId),
        toTag(station.series.toLowerCase()),
        toTag(station.holderName),
      ],
      timezone: "Europe/Amsterdam",
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
