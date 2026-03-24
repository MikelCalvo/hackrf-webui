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

const MIB_PRIVATE_FM_URL =
  "https://mib.gov.in/sites/default/files/2026-02/391_operationalchannels_01022026.pdf";
const AKASHVANI_STATIONS_URL =
  "https://prasarbharati.gov.in/wp-content/uploads/2025/12/Akashvani_Stations.pdf";

const AIR_CATEGORY_LABELS = new Set([
  "GOLD",
  "LRS",
  "RAINBOW",
  "RELAY",
  "RSC",
  "VBS",
]);

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function capitalizeToken(token) {
  if (!token) {
    return "";
  }
  if (token === "&" || token === "/") {
    return token;
  }
  if (/^[()]+$/.test(token)) {
    return token;
  }
  if (/^[A-Z0-9]{1,3}$/.test(token) || /[&.+/-]/.test(token)) {
    return token.toUpperCase();
  }
  if (/^\d/.test(token)) {
    return token;
  }

  const lower = token.toLocaleLowerCase("en");
  return `${lower[0].toLocaleUpperCase("en")}${lower.slice(1)}`;
}

function formatDisplayName(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  return normalized
    .split(/(\s+|\/|-|\(|\)|&)/)
    .map((part) => {
      if (!part || /^(\s+|\/|-|\(|\)|&)$/.test(part)) {
        return part;
      }
      return capitalizeToken(part);
    })
    .join("")
    .replace(/\bUt\b/g, "UT")
    .replace(/\bFm\b/g, "FM")
    .replace(/\bMw\b/g, "MW")
    .replace(/\bDrm\b/g, "DRM")
    .replace(/\bRnu\b/g, "RNU");
}

function formatBrandName(value) {
  return normalizeText(value);
}

function normalizeAirCategory(value) {
  return normalizeText(value).toUpperCase();
}

function formatAirCategoryLabel(value) {
  const normalized = normalizeAirCategory(value);
  if (!normalized) {
    return "";
  }
  if (normalized === "RELAY") {
    return "Relay";
  }
  if (normalized === "RAINBOW") {
    return "Rainbow";
  }
  if (normalized === "GOLD") {
    return "Gold";
  }
  return normalized;
}

function formatTransmitterLabel(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  return normalized
    .replace(/\bMHZ\b/g, "MHz")
    .replace(/\bKHZ\b/g, "kHz")
    .replace(/\bKW\b/g, "kW")
    .replace(/\bDRM\b/g, "DRM");
}

function parseFrequencyToken(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(MHz|MHZ|kHz|KHz)?$/i);
  if (!match) {
    return null;
  }

  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return {
    unit: (match[2] || "").toUpperCase(),
    value: numeric,
  };
}

function parseFrequencyMhz(value) {
  const token = parseFrequencyToken(value);
  if (!token) {
    return NaN;
  }

  return normalizeFreqMhz(token.value);
}

function isSerialLine(line) {
  return /^\s*\d+\s+/.test(line);
}

function isMibHeaderLine(line) {
  return (
    line.includes("DETAILS OF OPERATIONAL PRIVATE FM RADIO CHANNELS") ||
    line.includes("S. NO.") ||
    normalizeText(line) === "MHz"
  );
}

function isAirStateHeader(line) {
  return /^[A-Z][A-Z\s&()./-]+\[\d+\]$/.test(normalizeText(line));
}

function splitPdfLine(line) {
  return String(line ?? "")
    .replace(/\f/g, "")
    .split(/\s{2,}/)
    .map((part) => normalizeText(part))
    .filter(Boolean);
}

function isTransmitterToken(value) {
  return /\b(?:\d+X?\d*\s*)?(?:kW|W)\s+(?:FM|MW)\b/i.test(normalizeText(value));
}

function isFmTransmitterToken(value) {
  return /\b(?:\d+X?\d*\s*)?(?:kW|W)\s+FM\b/i.test(normalizeText(value));
}

function parseAirContextParts(parts, hasSerial) {
  const remaining = hasSerial ? parts.slice(1) : parts.slice();
  const transmitterIndex = remaining.findIndex((part) => isTransmitterToken(part));
  const frequencyIndex = remaining.findIndex((part, index) => {
    if (index <= transmitterIndex) {
      return false;
    }
    return Boolean(parseFrequencyToken(part));
  });

  const prefix =
    transmitterIndex >= 0
      ? remaining.slice(0, transmitterIndex)
      : remaining.slice(0, frequencyIndex >= 0 ? frequencyIndex : remaining.length);
  const transmitter = transmitterIndex >= 0 ? remaining[transmitterIndex] : "";
  const frequency = frequencyIndex >= 0 ? remaining[frequencyIndex] : "";

  const suffixStart =
    frequencyIndex >= 0
      ? frequencyIndex + 1
      : transmitterIndex >= 0
        ? transmitterIndex + 1
        : remaining.length;

  if (hasSerial) {
    return {
      category: prefix.length > 1 ? prefix.slice(1).join(" ") : "",
      frequency,
      station: prefix[0] || "",
      studio: remaining.slice(suffixStart).join(" "),
      transmitter,
    };
  }

  return {
    category: prefix.join(" "),
    frequency,
    station: "",
    studio: remaining.slice(suffixStart).join(" "),
    transmitter,
  };
}

function buildMibDescription({
  category,
  channelName,
  cityName,
  freqMhz,
  holderName,
  regionName,
  stateName,
}) {
  return [
    `Private FM channel listed by MIB for ${cityName}, ${stateName}.`,
    `Frequency: ${freqMhz.toFixed(1)} MHz.`,
    category ? `City category: ${category}.` : "",
    regionName ? `Region: ${regionName}.` : "",
    channelName ? `Channel: ${channelName}.` : "",
    holderName ? `Permission holder: ${holderName}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildAirDescription({
  category,
  cityName,
  freqMhz,
  stateName,
  studio,
  transmitter,
}) {
  return [
    `Akashvani FM transmitter listed by Prasar Bharati for ${cityName}, ${stateName}.`,
    `Frequency: ${freqMhz.toFixed(1)} MHz.`,
    category ? `Service: ${formatAirCategoryLabel(category)}.` : "",
    transmitter ? `Transmitter: ${formatTransmitterLabel(transmitter)}.` : "",
    studio ? `Studio: ${normalizeText(studio)}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

async function downloadPdf(url, label) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download ${label}: HTTP ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

async function extractPdfText(buffer, baseName) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hackrf-webui-india-"));
  const pdfPath = path.join(tempDir, `${baseName}.pdf`);

  try {
    await fs.writeFile(pdfPath, buffer);
    const { stdout } = await execFileAsync("pdftotext", ["-layout", pdfPath, "-"], {
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("pdftotext is required to parse the official India FM PDFs");
    }
    throw error;
  } finally {
    await fs.rm(tempDir, { force: true, recursive: true });
  }
}

function buildMibStationRow({
  category,
  channelName,
  cityName,
  freqMhz,
  holderName,
  regionName,
  stateName,
  verifiedAt,
}) {
  const cityDisplay = formatDisplayName(cityName);
  const stateDisplay = formatDisplayName(stateName);
  const channelDisplay = formatBrandName(channelName);
  const holderDisplay = normalizeText(holderName);
  const regionDisplay = normalizeText(regionName);

  return {
    admin1Code: `IN-${toTag(stateDisplay).toUpperCase()}`,
    cityName: cityDisplay,
    countryCode: "IN",
    curated: false,
    description: buildMibDescription({
      category,
      channelName: channelDisplay,
      cityName: cityDisplay,
      freqMhz,
      holderName: holderDisplay,
      regionName: regionDisplay,
      stateName: stateDisplay,
    }),
    freqMhz,
    name: channelDisplay,
    source: "MIB operational private FM channels PDF",
    sourceUrl: MIB_PRIVATE_FM_URL,
    tags: [
      "fm",
      "official",
      "india",
      "mib",
      "private",
      toTag(stateDisplay),
      toTag(regionDisplay || "unknown-region"),
      toTag(category || "unknown-category"),
    ],
    verifiedAt,
  };
}

function buildAirStationRow({
  category,
  cityName,
  freqMhz,
  stateName,
  studio,
  transmitter,
  verifiedAt,
}) {
  const cityDisplay = formatDisplayName(cityName);
  const stateDisplay = formatDisplayName(stateName);
  const categoryDisplay = formatAirCategoryLabel(category);
  const name = categoryDisplay
    ? `Akashvani ${cityDisplay} ${categoryDisplay}`
    : `Akashvani ${cityDisplay}`;

  return {
    admin1Code: `IN-${toTag(stateDisplay).toUpperCase()}`,
    cityName: cityDisplay,
    countryCode: "IN",
    curated: false,
    description: buildAirDescription({
      category,
      cityName: cityDisplay,
      freqMhz,
      stateName: stateDisplay,
      studio,
      transmitter,
    }),
    freqMhz,
    name,
    source: "Prasar Bharati Akashvani stations PDF",
    sourceUrl: AKASHVANI_STATIONS_URL,
    tags: [
      "fm",
      "official",
      "india",
      "prasarbharati",
      "akashvani",
      toTag(stateDisplay),
      toTag(categoryDisplay || "general"),
    ],
    verifiedAt,
  };
}

function parseMibStations(text, verifiedAt) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\f/g, ""))
    .filter((line) => normalizeText(line) && !isMibHeaderLine(line));
  const stations = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isSerialLine(line)) {
      continue;
    }

    const parts = splitPdfLine(line);
    if (parts.length === 8) {
      const [, cityName, stateName, category, regionName, holderName, channelName, frequency] =
        parts;
      const freqMhz = parseFrequencyMhz(frequency);

      if (Number.isFinite(freqMhz)) {
        stations.push(
          buildMibStationRow({
            category,
            channelName,
            cityName,
            freqMhz,
            holderName,
            regionName,
            stateName,
            verifiedAt,
          }),
        );
      }

      continue;
    }

    if (parts.length === 7) {
      const previousParts = splitPdfLine(lines[index - 1] || "");
      const nextParts = splitPdfLine(lines[index + 1] || "");
      const [, cityName, stateName, category, regionName, channelName, frequency] = parts;
      const holderName = [previousParts[0], nextParts[0]]
        .filter(Boolean)
        .map((part) => normalizeText(part))
        .join(" ");
      const freqMhz = parseFrequencyMhz(frequency);

      if (holderName && Number.isFinite(freqMhz)) {
        stations.push(
          buildMibStationRow({
            category,
            channelName,
            cityName,
            freqMhz,
            holderName,
            regionName,
            stateName,
            verifiedAt,
          }),
        );
      }

      continue;
    }

    if (parts.length === 3) {
      const previousParts = splitPdfLine(lines[index - 1] || "");
      const nextParts = splitPdfLine(lines[index + 1] || "");

      if (previousParts.length !== 1 || nextParts.length !== 5) {
        continue;
      }

      const [, holderName, channelName] = parts;
      const [cityName, stateTail, category, regionName, frequency] = nextParts;
      const stateName = `${previousParts[0]} ${stateTail}`;
      const freqMhz = parseFrequencyMhz(frequency);

      if (Number.isFinite(freqMhz)) {
        stations.push(
          buildMibStationRow({
            category,
            channelName,
            cityName,
            freqMhz,
            holderName,
            regionName,
            stateName,
            verifiedAt,
          }),
        );
      }
    }
  }

  return stations;
}

function parseAkashvaniStations(text, verifiedAt) {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\f/g, ""));
  const stations = [];
  let currentState = "";
  let currentStation = "";
  let currentCategory = "";
  let pendingFm = null;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = normalizeText(rawLine);
    if (!line) {
      continue;
    }

    if (
      line.startsWith("EXISTING AIR STATIONS") ||
      line.includes("TOTAL STATIONS-") ||
      line.includes("TOTAL TRANSMITTERS-") ||
      line.includes("National Coverage") ||
      line.startsWith("Sl ") ||
      line === "No." ||
      line.startsWith("Trs")
    ) {
      continue;
    }

    if (isAirStateHeader(line)) {
      currentState = formatDisplayName(line.replace(/\s*\[\d+\]\s*$/, ""));
      currentStation = "";
      currentCategory = "";
      pendingFm = null;
      continue;
    }

    const parts = splitPdfLine(rawLine);
    if (!parts.length) {
      continue;
    }

    if (pendingFm && parts.length === 1 && parseFrequencyToken(parts[0])) {
      const freqMhz = parseFrequencyMhz(parts[0]);
      if (Number.isFinite(freqMhz)) {
        stations.push(
          buildAirStationRow({
            ...pendingFm,
            freqMhz,
            verifiedAt,
          }),
        );
      }
      pendingFm = null;
      continue;
    }

    if (parts.length === 1 && /^\(.+\)$/.test(parts[0]) && currentStation) {
      currentStation = normalizeText(`${currentStation} ${parts[0]}`);
      if (pendingFm) {
        pendingFm.cityName = currentStation;
      }
      continue;
    }

    if (
      parts.length >= 2 &&
      /shifted from$/i.test(parts[0]) &&
      parseFrequencyToken(parts[1]) &&
      currentStation &&
      currentState
    ) {
      let transmitter = normalizeText(parts[0]);
      if (!/\bFM\b/i.test(transmitter)) {
        transmitter = transmitter.replace(/^(\d+\s*W)\b/i, "$1 FM");
      }

      const nextParts = splitPdfLine(lines[index + 1] || "");
      if (nextParts.length === 1 && /\)$/.test(nextParts[0])) {
        transmitter = normalizeText(`${transmitter} ${nextParts[0]}`);
        index += 1;
      }

      const freqMhz = parseFrequencyMhz(parts[1]);
      if (Number.isFinite(freqMhz)) {
        stations.push(
          buildAirStationRow({
            category: currentCategory,
            cityName: currentStation,
            freqMhz,
            stateName: currentState,
            studio: "",
            transmitter,
            verifiedAt,
          }),
        );
      }

      pendingFm = null;
      continue;
    }

    const hasSerial = /^\d+$/.test(parts[0]);
    const parsed = parseAirContextParts(parts, hasSerial);

    if (hasSerial) {
      if (parsed.station) {
        currentStation = normalizeText(parsed.station);
      }
      if (parsed.category) {
        currentCategory = normalizeAirCategory(parsed.category);
      } else if (parsed.station && parsed.transmitter) {
        currentCategory = "";
      }
    } else if (parsed.category) {
      currentCategory = normalizeAirCategory(parsed.category);
    }

    if (parsed.transmitter) {
      if (!currentStation || !currentState) {
        pendingFm = null;
        continue;
      }

      if (isFmTransmitterToken(parsed.transmitter)) {
        if (parsed.frequency) {
          const freqMhz = parseFrequencyMhz(parsed.frequency);
          if (Number.isFinite(freqMhz)) {
            stations.push(
              buildAirStationRow({
                category: currentCategory,
                cityName: currentStation,
                freqMhz,
                stateName: currentState,
                studio: normalizeText(parsed.studio),
                transmitter: parsed.transmitter,
                verifiedAt,
              }),
            );
          }
          pendingFm = null;
        } else {
          pendingFm = {
            category: currentCategory,
            cityName: currentStation,
            stateName: currentState,
            studio: normalizeText(parsed.studio),
            transmitter: parsed.transmitter,
          };
        }
      }

      continue;
    }

    if (parts.length === 1) {
      const token = normalizeText(parts[0]);
      if (AIR_CATEGORY_LABELS.has(token.toUpperCase())) {
        currentCategory = normalizeAirCategory(token);
        continue;
      }

      if (pendingFm && parseFrequencyToken(token)) {
        const freqMhz = parseFrequencyMhz(token);
        if (Number.isFinite(freqMhz)) {
          stations.push(
            buildAirStationRow({
              ...pendingFm,
              freqMhz,
              verifiedAt,
            }),
          );
        }
        pendingFm = null;
      }
    }
  }

  return stations;
}

function sortStations(left, right) {
  const stateDiff = compareText(left.admin1Code || "", right.admin1Code || "");
  if (stateDiff !== 0) {
    return stateDiff;
  }

  const cityDiff = compareText(left.cityName || "", right.cityName || "");
  if (cityDiff !== 0) {
    return cityDiff;
  }

  if (left.freqMhz !== right.freqMhz) {
    return left.freqMhz - right.freqMhz;
  }

  return compareText(left.name || "", right.name || "");
}

export async function loadIndiaFmStations() {
  const [mibText, akashvaniText] = await Promise.all([
    extractPdfText(
      await downloadPdf(MIB_PRIVATE_FM_URL, "MIB private FM operational channels PDF"),
      "india-private-fm",
    ),
    extractPdfText(
      await downloadPdf(AKASHVANI_STATIONS_URL, "Prasar Bharati Akashvani stations PDF"),
      "india-akashvani",
    ),
  ]);

  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const station of [
    ...parseMibStations(mibText, verifiedAt),
    ...parseAkashvaniStations(akashvaniText, verifiedAt),
  ]) {
    const dedupeKey = [
      station.source,
      station.admin1Code,
      normalizeKey(station.cityName),
      normalizeKey(station.name),
      station.freqMhz.toFixed(3),
      normalizeKey(station.description),
    ].join("|");

    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.set(dedupeKey, station);
  }

  return [...dedupe.values()].sort(sortStations);
}
