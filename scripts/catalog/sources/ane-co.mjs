import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { compareText, normalizeKey, toTag } from "../lib/utils.mjs";

const execFileAsync = promisify(execFile);

const ANE_FM_URL =
  "https://www.ane.gov.co/Sliders/archivos/GestionTecnica/Radiodifusi%C3%B3n%20sonora/Planes%20t%C3%A9cnicos%20de%20Radiodifusi%C3%B3n%20Sonora/Actualizaciones%20del%20PTNRS%20en%20AM%20y%20FM%20a%C3%B1o%202021/Plan%20T%C3%A9cnico/Apendice%20A%20del%20PTNRS%20en%20FM%20actualizado%20Resolucion%20284%20del%2018%20de%20junio%20de%202021.pdf";

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseLocaleNumber(value) {
  let raw = normalizeText(value);
  if (!raw) {
    return NaN;
  }

  if (raw.includes(",") && raw.includes(".")) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  } else if (raw.includes(",")) {
    raw = raw.replace(",", ".");
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function titleCase(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  return normalized
    .toLocaleLowerCase("es")
    .split(/(\s+|-)/)
    .map((part) => {
      if (part === "-" || /^\s+$/.test(part) || !part) {
        return part;
      }
      return `${part[0].toLocaleUpperCase("es")}${part.slice(1)}`;
    })
    .join("");
}

function translateDivisionType(value) {
  const normalized = normalizeText(value).toUpperCase();
  if (!normalized) {
    return "";
  }

  if (normalized === "MUNICIPIO") {
    return "Municipality";
  }
  if (normalized === "ÁREA NO MUNICIPALIZADA") {
    return "Non-municipal area";
  }
  if (normalized === "CENTRO POBLADO") {
    return "Population center";
  }

  return titleCase(normalized);
}

function translateStatus(value) {
  const normalized = normalizeText(value).toUpperCase();
  if (!normalized) {
    return "";
  }

  if (normalized === "ASIGNADO") {
    return "assigned";
  }
  if (normalized === "PROYECTADO") {
    return "projected";
  }

  return titleCase(normalized);
}

function parsePdfLine(line) {
  const cells = line
    .trim()
    .split(/\s{2,}/)
    .map((cell) => normalizeText(cell))
    .filter(Boolean);

  if (cells.length < 9) {
    return null;
  }

  const stationClass = normalizeText(cells[0]).toUpperCase();
  const departmentName = titleCase(cells[1]);
  const cityName = titleCase(cells[2]);
  const divisionType = translateDivisionType(cells[3]);
  const territorialCode = normalizeText(cells[4]).padStart(5, "0");
  const freqMhz = parseLocaleNumber(cells[5]);
  const powerKw = parseLocaleNumber(cells[6]);
  const channelStatus = translateStatus(cells[7]);
  const tail = cells.slice(8);

  let linkFreqMhz = NaN;
  let callsign = "";

  if (tail.length === 1) {
    callsign = tail[0];
  } else if (tail.length >= 2) {
    const possibleLinkFreq = parseLocaleNumber(tail[0]);
    if (Number.isFinite(possibleLinkFreq)) {
      linkFreqMhz = possibleLinkFreq;
    }

    for (let index = tail.length - 1; index >= 0; index -= 1) {
      const candidate = normalizeText(tail[index]);
      if (/^[A-Z0-9]{3,}$/i.test(candidate)) {
        callsign = candidate;
        break;
      }
    }

    if (!callsign && tail.length > 0) {
      callsign = tail[tail.length - 1];
    }
  }

  if (!stationClass || !departmentName || !cityName || !territorialCode || !Number.isFinite(freqMhz) || !callsign) {
    return null;
  }

  const admin1Code = territorialCode.slice(0, 2);

  return {
    admin1Code,
    channelStatus,
    cityName,
    callsign,
    departmentName,
    divisionType,
    freqMhz: Number.parseFloat(freqMhz.toFixed(3)),
    linkFreqMhz: Number.isFinite(linkFreqMhz) ? Number.parseFloat(linkFreqMhz.toFixed(3)) : NaN,
    powerKw: Number.isFinite(powerKw) ? Number.parseFloat(powerKw.toFixed(3)) : NaN,
    stationClass,
    territorialCode,
  };
}

function buildDescription(row) {
  const parts = [
    `FM station listed in ANE's national technical plan for ${row.cityName}, ${row.departmentName}.`,
    `Class ${row.stationClass}.`,
    row.divisionType ? `Territorial division type: ${row.divisionType}.` : "",
    row.channelStatus ? `Channel status: ${row.channelStatus}.` : "",
    Number.isFinite(row.powerKw) ? `Authorized power: ${row.powerKw.toFixed(3).replace(/\.?0+$/, "")} kW.` : "",
    Number.isFinite(row.linkFreqMhz)
      ? `Link frequency: ${row.linkFreqMhz.toFixed(3).replace(/\.?0+$/, "")} MHz.`
      : "",
  ];

  return parts.filter(Boolean).join(" ");
}

async function downloadPdf() {
  const res = await fetch(ANE_FM_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download ANE FM appendix: HTTP ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

async function extractPdfText(buffer) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hackrf-webui-ane-"));
  const pdfPath = path.join(tempDir, "ane-co-fm.pdf");

  try {
    await fs.writeFile(pdfPath, buffer);
    const { stdout } = await execFileAsync("pdftotext", ["-layout", pdfPath, "-"], {
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("pdftotext is required to parse the official ANE FM appendix");
    }
    throw error;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function loadAneCoStations() {
  const text = await extractPdfText(await downloadPdf());
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const rawLine of text.split(/\r?\n/)) {
    if (!/^\s*[ABCD]\s{2,}/.test(rawLine)) {
      continue;
    }

    const row = parsePdfLine(rawLine);
    if (!row || !Number.isFinite(row.freqMhz)) {
      continue;
    }

    const uniqueKey = [
      row.stationClass,
      row.admin1Code,
      normalizeKey(row.departmentName),
      normalizeKey(row.cityName),
      row.territorialCode,
      row.freqMhz.toFixed(3),
      normalizeKey(row.callsign),
      normalizeKey(row.channelStatus),
    ].join("|");

    if (dedupe.has(uniqueKey)) {
      continue;
    }

    dedupe.set(uniqueKey, {
      admin1Code: row.admin1Code,
      cityName: row.cityName,
      countryCode: "CO",
      curated: false,
      description: buildDescription(row),
      freqMhz: row.freqMhz,
      name: row.callsign,
      source: "ANE national FM technical plan appendix",
      sourceUrl: ANE_FM_URL,
      tags: [
        "fm",
        "official",
        "ane",
        "colombia",
        toTag(row.departmentName),
        toTag(row.stationClass),
        toTag(row.channelStatus || "unknown"),
      ],
      verifiedAt,
    });
  }

  return [...dedupe.values()].sort((left, right) => {
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
