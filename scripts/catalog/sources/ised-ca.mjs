import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import AdmZip from "adm-zip";
import { DBFFile } from "dbffile";

import { toTag } from "../lib/utils.mjs";

const ISED_PAGE_URL =
  "https://ised-isde.canada.ca/site/spectrum-management-system/en/broadcasting-services/download-broadcasting-data-files";
const ISED_DB_URL = "https://www.ic.gc.ca/engineering/BC_DBF_FILES/baserad.zip";

function normalizeCallsign(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toDecimalDegrees(value, axis) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return NaN;
  }

  const absolute = Math.trunc(Math.abs(numeric));
  const degrees = Math.trunc(absolute / 10000);
  const minutes = Math.trunc((absolute - degrees * 10000) / 100);
  const seconds = absolute - degrees * 10000 - minutes * 100;
  const decimal = degrees + minutes / 60 + seconds / 3600;

  if (axis === "lon") {
    return -decimal;
  }

  return decimal;
}

async function extractDbfFiles() {
  let lastError;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetch(ISED_DB_URL, {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
        },
      });

      if (!res.ok) {
        throw new Error(`Failed to download ISED dataset: HTTP ${res.status}`);
      }

      const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hackrf-webui-ised-"));

      for (const entryName of ["fmstatio.dbf", "province.dbf"]) {
        const entry = zip.getEntry(entryName);
        if (!entry) {
          throw new Error(`ISED archive is missing ${entryName}`);
        }

        await fs.writeFile(path.join(tmpDir, entryName), zip.readFile(entry));
      }

      return tmpDir;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
      }
    }
  }

  throw lastError;
}

export async function loadIsedCaStations() {
  const tmpDir = await extractDbfFiles();
  const provinceFile = await DBFFile.open(path.join(tmpDir, "province.dbf"), {
    encoding: "latin1",
  });
  const fmFile = await DBFFile.open(path.join(tmpDir, "fmstatio.dbf"), {
    encoding: "latin1",
  });

  const provinces = await provinceFile.readRecords();
  const provinceMeta = new Map(
    provinces.map((row) => [
      String(row.PROVINCE || "").trim(),
      {
        countryCode: String(row.COUNTRY || "").trim(),
        provinceName: String(row.ENGDESC || "").trim(),
      },
    ]),
  );

  const rows = await fmFile.readRecords();
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const row of rows) {
    const provinceCode = String(row.PROVINCE || "").trim();
    const province = provinceMeta.get(provinceCode);
    if (!province || province.countryCode !== "CA") {
      continue;
    }

    const cityName = String(row.CITY || "").trim();
    const callsign = normalizeCallsign(row.CALL_SIGN);
    const freqMhz = Number(row.FREQUENCY);
    if (!cityName || !callsign || !Number.isFinite(freqMhz)) {
      continue;
    }

    const key = `${provinceCode}|${cityName}|${callsign}|${freqMhz.toFixed(1)}`;
    if (!dedupe.has(key)) {
      dedupe.set(key, { provinceCode, provinceName: province.provinceName, row });
    }
  }

  return [...dedupe.values()].map(({ provinceCode, provinceName, row }) => {
    const cityName = String(row.CITY || "").trim();
    const callsign = normalizeCallsign(row.CALL_SIGN);
    const freqMhz = Number(row.FREQUENCY);
    const licenseClass = String(row.CLASS || "").trim();
    const latitude = toDecimalDegrees(row.LATITUDE, "lat");
    const longitude = toDecimalDegrees(row.LONGITUDE, "lon");

    const description = [
      `FM service listed by ISED for ${cityName}, ${provinceName || provinceCode}.`,
      licenseClass ? `Class ${licenseClass}.` : "",
      `Callsign: ${callsign}.`,
    ]
      .filter(Boolean)
      .join(" ");

    return {
      cityName,
      countryCode: "CA",
      curated: false,
      description,
      freqMhz,
      latitude,
      longitude,
      name: callsign,
      source: "ISED Broadcasting Data",
      sourceUrl: ISED_PAGE_URL,
      tags: ["fm", "official", "canada", toTag(provinceName || provinceCode)],
      timezone: "UTC",
      verifiedAt,
    };
  });
}
