import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const execFileAsync = promisify(execFile);

const IMDA_HANDBOOK_URL =
  "https://www.imda.gov.sg/~/media/imda/files/regulation%20licensing%20and%20consultations/frameworks%20and%20policies/spectrum%20management%20and%20coordination/spectrummgmthb.pdf";

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

async function extractPdfText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download IMDA spectrum handbook: HTTP ${res.status}`);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hackrf-webui-sg-"));
  const pdfPath = path.join(tempDir, "source.pdf");

  try {
    await fs.writeFile(pdfPath, Buffer.from(await res.arrayBuffer()));
    const { stdout } = await execFileAsync("pdftotext", ["-layout", pdfPath, "-"]);
    return stdout;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function parseTableRows(text) {
  const startIndex = text.indexOf("FM Radio");
  if (startIndex < 0) {
    return [];
  }

  const section = text.slice(startIndex).split("Digital TV – DVB-T2")[0];
  const lines = section.split(/\r?\n/).filter(Boolean);
  const rows = [];

  for (const line of lines) {
    const normalizedLine = normalizeText(line);
    if (normalizedLine === "FM Radio" || normalizedLine.startsWith("Frequency (MHz)")) {
      continue;
    }

    const leftFreq = normalizeFreqMhz(normalizeText(line.slice(0, 20)));
    const leftName = normalizeText(line.slice(20, 50));
    const rightFreq = normalizeFreqMhz(normalizeText(line.slice(50, 72)));
    const rightName = normalizeText(line.slice(72));

    if (Number.isFinite(leftFreq) && leftName) {
      rows.push({ freqMhz: leftFreq, name: leftName });
    }

    if (Number.isFinite(rightFreq) && rightName) {
      rows.push({ freqMhz: rightFreq, name: rightName });
    }
  }

  return rows.filter((row) => row.name && Number.isFinite(row.freqMhz));
}

function buildDescription(row) {
  return [
    `Singapore FM service listed by IMDA in the Spectrum Management Handbook.`,
    `Frequency: ${row.freqMhz.toFixed(1)} MHz.`,
    `Station: ${row.name}.`,
  ].join(" ");
}

export async function loadImdaSgStations() {
  const text = await extractPdfText(IMDA_HANDBOOK_URL);
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const row of parseTableRows(text)) {
    const dedupeKey = `${row.name}|${row.freqMhz.toFixed(3)}`;
    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.set(dedupeKey, {
      cityName: "Singapore",
      countryCode: "SG",
      curated: false,
      description: buildDescription(row),
      freqMhz: row.freqMhz,
      name: row.name,
      source: "IMDA Spectrum Management Handbook",
      sourceUrl: IMDA_HANDBOOK_URL,
      tags: ["fm", "official", "singapore", "imda", toTag(row.name)],
      timezone: "Asia/Singapore",
      verifiedAt,
    });
  }

  return [...dedupe.values()];
}
