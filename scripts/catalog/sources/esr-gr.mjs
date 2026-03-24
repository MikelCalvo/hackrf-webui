import XLSX from "xlsx";

import { compareText, normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const ESR_WORKBOOK_URL = "https://www.esr.gr/wp-content/uploads/bnl.xlsx";
const USER_AGENT = "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)";

const LEADING_LOCALITY_PREFIXES = new Set([
  "ΑΓΙΑ",
  "ΑΓΙΟΙ",
  "ΑΓΙΟΣ",
  "ΑΝΩ",
  "ΑΡΧΑΙΑ",
  "ΚΑΤΩ",
  "ΝΕΑ",
  "ΝΕΟ",
  "ΠΑΛΑΙΑ",
  "ΠΑΛΑΙΟ",
  "ΠΑΛΑΙΟΣ",
]);

const GENERIC_LEADING_TOKENS = new Set([
  "1Ο",
  "1ος",
  "2Ο",
  "3Ο",
  "4Ο",
  "5Ο",
  "6Ο",
  "7Ο",
  "8Ο",
  "9Ο",
  "ΑΓΡ",
  "ΑΓΡ.",
  "ΒΙΠΕ",
  "ΒΙ.ΠΕ",
  "ΓΗΠΕΔΟ",
  "ΓΡΑΦΕΙΟ",
  "ΓΡΑΦΕΙΑ",
  "ΔΗΜΟΣ",
  "ΔΗΜΟΥ",
  "ΕΔΡΑ",
  "ΕΟ",
  "Ε.Ο",
  "Ε.Ο.",
  "ΕΠΑΡΧΙΑ",
  "ΚΕΝΤΡΙΚΑ",
  "ΛΕΩΦ",
  "ΛΕΩΦ.",
  "ΛΕΩΦΟΡΟΣ",
  "ΟΔΟΣ",
  "ΣΤΑΘΜΟΣ",
  "ΘΕΣΗ",
  "ΠΕ",
  "Π.Ε",
  "Π.Ε.",
  "ΤΚ",
  "Τ.Κ",
  "Τ.Κ.",
  "ΦΟΡΕΑΣ",
  "ΧΛΜ",
  "ΧΛΜ.",
  "ΧΩΡΙΟ",
]);

const GENERIC_CITY_CANDIDATES = new Set([
  "ΓΡΑΦΕΙΟ",
  "ΓΡΑΦΕΙΑ",
  "ΔΗΜΟΣ",
  "ΔΗΜΟΥ",
  "ΕΔΡΑ",
  "ΕΠΑΡΧΙΑ",
  "ΚΕΝΤΡΙΚΑ",
  "ΠΕΡΙΟΧΗ",
  "ΠΟΛΗ",
  "ΧΩΡΙΟ",
]);

const GENITIVE_TO_NOMINATIVE = new Map([
  ["ΑΘΗΝΑΣ", "ΑΘΗΝΑ"],
  ["ΑΛΕΞΑΔΡΟΥΠΟΛΗΣ", "ΑΛΕΞΑΝΔΡΟΥΠΟΛΗ"],
  ["ΑΛΕΞΑΝΔΡΟΥΠΟΛΗΣ", "ΑΛΕΞΑΝΔΡΟΥΠΟΛΗ"],
  ["ΑΓΡΙΝΙΟΥ", "ΑΓΡΙΝΙΟ"],
  ["ΑΛΙΒΕΡΙΟΥ", "ΑΛΙΒΕΡΙ"],
  ["ΑΡΤΑΣ", "ΑΡΤΑ"],
  ["ΒΟΛΟΥ", "ΒΟΛΟΣ"],
  ["ΔΡΑΜΑΣ", "ΔΡΑΜΑ"],
  ["ΓΡΕΒΕΝΩΝ", "ΓΡΕΒΕΝΑ"],
  ["ΗΡΑΚΛΕΙΟΥ", "ΗΡΑΚΛΕΙΟ"],
  ["ΚΟΖΑΝΗΣ", "ΚΟΖΑΝΗ"],
  ["ΘΕΣΣΑΛΟΝΙΚΗΣ", "ΘΕΣΣΑΛΟΝΙΚΗ"],
  ["ΚΑΛΑΜΑΡΙΑΣ", "ΚΑΛΑΜΑΡΙΑ"],
  ["ΜΟΙΡΩΝ", "ΜΟΙΡΕΣ"],
  ["ΝΑΥΠΛΙΟΥ", "ΝΑΥΠΛΙΟ"],
  ["ΟΡΕΣΤΙΑΔΑΣ", "ΟΡΕΣΤΙΑΔΑ"],
  ["ΠΑΤΡΩΝ", "ΠΑΤΡΑ"],
  ["ΡΕΘΥΜΝΟΥ", "ΡΕΘΥΜΝΟ"],
  ["ΡΟΔΟΥ", "ΡΟΔΟΣ"],
  ["ΣΕΡΒΙΩΝ", "ΣΕΡΒΙΑ"],
  ["ΣΕΡΡΩΝ", "ΣΕΡΡΕΣ"],
  ["ΧΙΟΥ", "ΧΙΟΣ"],
  ["ΧΑΛΚΙΔΑΣ", "ΧΑΛΚΙΔΑ"],
  ["ΧΑΝΙΩΝ", "ΧΑΝΙΑ"],
  ["ΖΑΚΥΝΘΟΥ", "ΖΑΚΥΝΘΟΣ"],
]);

const CITY_OVERRIDES = new Map([
  ["ΑΓ. ΑΝΑΡΓΥΡΟΙ", "ΑΓΙΟΙ ΑΝΑΡΓΥΡΟΙ"],
  ["ΑΘΗΝΑ", "Athens"],
  ["ΓΚΑΖΙ", "ΑΘΗΝΑ"],
  ["Ν. ΦΑΛΗΡΟ", "ΝΕΑ ΦΑΛΗΡΟ"],
  ["ΘΕΣΣΑΛΟΝΙΚΗ", "Thessaloniki"],
]);

const LATIN_TO_GREEK = new Map([
  ["A", "Α"],
  ["B", "Β"],
  ["E", "Ε"],
  ["H", "Η"],
  ["I", "Ι"],
  ["K", "Κ"],
  ["M", "Μ"],
  ["N", "Ν"],
  ["O", "Ο"],
  ["P", "Ρ"],
  ["T", "Τ"],
  ["X", "Χ"],
  ["Y", "Υ"],
  ["a", "α"],
  ["e", "ε"],
  ["i", "ι"],
  ["o", "ο"],
  ["p", "ρ"],
  ["x", "χ"],
  ["y", "υ"],
]);

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeGreekLike(value) {
  const normalized = normalizeText(value);
  if (!/[Α-Ωα-ω]/u.test(normalized)) {
    return normalized;
  }

  return [...normalized].map((char) => LATIN_TO_GREEK.get(char) ?? char).join("");
}

function findRowKey(row, pattern) {
  return Object.keys(row).find((key) => pattern.test(key));
}

function normalizeStatus(value) {
  return normalizeGreekLike(value);
}

function normalizeStationName(value) {
  return normalizeGreekLike(value).replace(/\s{2,}/g, " ");
}

function extractPrimaryOwner(value) {
  const lines = String(value ?? "")
    .split(/\r?\n/u)
    .map((line) => normalizeGreekLike(line))
    .filter(Boolean);

  for (const line of lines) {
    if (/^[[(]/u.test(line)) {
      continue;
    }
    if (/[Α-ΩA-ZΆ-Ώ]/u.test(line)) {
      return line;
    }
  }

  return normalizeGreekLike(value);
}

function parseFrequencyMhz(value) {
  const numeric = Number(normalizeText(value).replace(",", "."));
  return Number.isFinite(numeric) ? normalizeFreqMhz(numeric) : NaN;
}

function extractTransmissionDetails(value) {
  const firstLine = String(value ?? "")
    .replace(/\r/g, "\n")
    .split(/\n/u)
    .map((line) => normalizeGreekLike(line))
    .find(Boolean);
  if (!firstLine) {
    return {
      freqMhz: NaN,
      transmissionSite: "",
    };
  }

  const cleanedLine = normalizeText(
    firstLine
      .replace(/\[[^\]]*\]/gu, " ")
      .replace(/\([^)]*\)/gu, " "),
  );
  const match = cleanedLine.match(
    /^(\d{1,3}(?:,\d+)?)\s*(?:M(?:H|Η)Z|MHZ|ΜΗΖ)?\s*(.*)$/iu,
  );
  if (!match) {
    return {
      freqMhz: NaN,
      transmissionSite: "",
    };
  }

  return {
    freqMhz: parseFrequencyMhz(match[1]),
    transmissionSite: normalizeText(match[2]),
  };
}

function expandAbbreviations(tokens) {
  return tokens.map((token, index) => {
    const nextToken = tokens[index + 1] ?? "";
    if (token === "Ν." || token === "Ν") {
      return "ΝΕΑ";
    }
    if (token === "ΑΓ." || token === "ΑΓ") {
      return /(ΟΙ|ΕΣ)$/u.test(nextToken) ? "ΑΓΙΟΙ" : "ΑΓΙΟΣ";
    }
    if (token === "ΑΓΙΑΣ") {
      return "ΑΓΙΑ";
    }
    return token;
  });
}

function applyCityOverride(value) {
  const normalized = normalizeGreekLike(value);
  return CITY_OVERRIDES.get(normalized) ?? normalized;
}

function sanitizeLocalityToken(token) {
  return token
    .replace(/^[^\p{Letter}\p{Number}]+/gu, "")
    .replace(/[^\p{Letter}\p{Number}.\/-]+$/gu, "");
}

function tokenizeLocality(value) {
  const cleaned = normalizeGreekLike(value)
    .replace(/[@].*$/u, " ")
    .replace(/[()[\],;]+/g, " ")
    .replace(/(^|\s)(?:Ε\.?Ο\.?|Π\.?Ε\.?|Τ\.?Κ\.?|TK|T\.K\.?)\s*/giu, "$1")
    .replace(/\b(?:ΣΤΑΘΜΟΣ|ΦΟΡΕΑΣ)\b/gu, " ")
    .replace(/\b(?:E-?MAIL|EMAIL)\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return [];
  }

  const tokens = expandAbbreviations(
    cleaned
      .split(/\s+/u)
      .map((token) => sanitizeLocalityToken(token))
      .filter(Boolean),
  ).filter((token) => /[\p{Letter}]/u.test(token));

  while (
    tokens.length &&
    (GENERIC_LEADING_TOKENS.has(tokens[0]) || /^\p{Letter}\.$/u.test(tokens[0]))
  ) {
    tokens.shift();
  }

  return tokens;
}

function primaryLocalityFromTokens(tokens) {
  if (!tokens.length) {
    return "";
  }

  const hasMappedTail = GENITIVE_TO_NOMINATIVE.has(tokens.at(-1));
  const working = tokens.map((token) => GENITIVE_TO_NOMINATIVE.get(token) ?? token);

  if (working.length >= 3) {
    const prefixIndex = working.findIndex((token) => LEADING_LOCALITY_PREFIXES.has(token));
    if (prefixIndex > 0) {
      const prefixSpan = working.slice(prefixIndex, prefixIndex + 2);
      if (prefixSpan.length === 2) {
        return applyCityOverride(prefixSpan.join(" "));
      }
    }
  }

  if (LEADING_LOCALITY_PREFIXES.has(working[0]) && working.length >= 2) {
    return applyCityOverride(working.slice(0, 2).join(" "));
  }

  if (working.length >= 2 && hasMappedTail) {
    return applyCityOverride(working[0]);
  }

  return applyCityOverride(working[0]);
}

function isPlausibleCityCandidate(value) {
  const normalized = normalizeText(value).replace(/[.-]+$/g, "");
  if (!normalized) {
    return false;
  }

  const compact = normalized.replace(/[\s./-]+/g, "");
  if (!compact || compact.length < 3) {
    return false;
  }
  if (/\d/u.test(normalized)) {
    return false;
  }
  if (GENERIC_CITY_CANDIDATES.has(normalized)) {
    return false;
  }
  if (/^\p{Letter}\.?$/u.test(normalized)) {
    return false;
  }

  return /[\p{Letter}]{2,}/u.test(compact);
}

function localityCandidatesFromFragment(fragment) {
  const tokens = tokenizeLocality(fragment);
  if (!tokens.length) {
    return [];
  }

  const candidates = [];
  const primary = primaryLocalityFromTokens(tokens);
  if (primary) {
    candidates.push(primary);
  }

  const full = applyCityOverride(tokens.join(" "));
  if (full && !candidates.includes(full)) {
    candidates.push(full);
  }

  if (tokens.length >= 2) {
    const shortened = applyCityOverride(tokens.slice(0, -1).join(" "));
    if (shortened && !candidates.includes(shortened)) {
      candidates.push(shortened);
    }
  }

  const lastToken = GENITIVE_TO_NOMINATIVE.get(tokens.at(-1)) ?? tokens.at(-1);
  if (lastToken && !candidates.includes(lastToken)) {
    candidates.push(applyCityOverride(lastToken));
  }

  return candidates.filter((candidate) => isPlausibleCityCandidate(candidate));
}

function tailBeforePostalCode(value) {
  const fragment = normalizeGreekLike(value);
  const segment = fragment.split(/\s*,\s*/u).at(-1) ?? fragment;
  return normalizeText(segment.replace(/^.*\b\d+\s*/u, ""));
}

function extractFallbackLocalityFragment(value) {
  const normalized = normalizeGreekLike(value)
    .replace(/^(?:ΚΕΝΤΡΙΚΑ|ΓΡΑΦΕΙΟ|ΓΡΑΦΕΙΑ|ΕΔΡΑ)\s*:\s*/u, "")
    .trim();
  if (!normalized || /@/u.test(normalized)) {
    return "";
  }
  if (/[A-Za-z0-9-]+\.[A-Za-z]{2,}/u.test(normalized)) {
    return "";
  }
  if (/\d{5,}/u.test(normalized)) {
    return "";
  }

  const trailingLocalityMatch = normalized.match(/\b\d+\p{Letter}?\s+(.+)$/u);
  if (trailingLocalityMatch) {
    return normalizeText(trailingLocalityMatch[1]);
  }

  if (/\d/u.test(normalized)) {
    return "";
  }

  return normalizeText(normalized);
}

function extractContactCity(value) {
  const lines = String(value ?? "")
    .replace(/\r/g, "\n")
    .split(/\n/u)
    .map((line) => normalizeText(line))
    .filter(Boolean);
  for (const line of [...lines].reverse()) {
    const normalizedLine = normalizeGreekLike(line);
    const postalMatch = normalizedLine.match(
      /(.*?)(?:\b[ΤT][ΚK]\.?\s*)(\d{2,3}\s*\d{2,3})(?:\s+(.+))?$/u,
    );
    if (postalMatch) {
      const before = tailBeforePostalCode(postalMatch[1] ?? "");
      const after = normalizeText(postalMatch[3] ?? "");
      const afterCandidates = localityCandidatesFromFragment(after);
      if (afterCandidates[0]) {
        return afterCandidates[0];
      }
      if (!after) {
        const beforeCandidates = localityCandidatesFromFragment(before);
        if (beforeCandidates[0]) {
          return beforeCandidates[0];
        }
      }
    }
  }

  for (const line of [...lines].reverse()) {
    const normalizedLine = normalizeGreekLike(line);
    const fallbackFragment = extractFallbackLocalityFragment(normalizedLine);
    const fallbackCandidates = localityCandidatesFromFragment(fallbackFragment);
    if (fallbackCandidates[0]) {
      return fallbackCandidates[0];
    }
  }

  return "";
}

function buildDescription({
  cityName,
  ownerName,
  programmeType,
  sheetName,
  stationName,
  transmissionSite,
}) {
  return [
    `Greek radio register entry listed by ESR for ${cityName}.`,
    `Station: ${stationName}.`,
    ownerName ? `Licensee: ${ownerName}.` : "",
    transmissionSite ? `Transmission site: ${transmissionSite}.` : "",
    programmeType ? `Programme type: ${programmeType}.` : "",
    `Register sheet: ${sheetName}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

async function downloadWorkbook() {
  const response = await fetch(ESR_WORKBOOK_URL, {
    headers: {
      "user-agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download ESR workbook: HTTP ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function loadEsrGrStations() {
  const workbook = XLSX.read(await downloadWorkbook(), { type: "buffer" });
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Set();
  const stations = [];

  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
    for (const row of rows) {
      const statusKey = findRowKey(row, /^ΚΑΤΑΣΤΑΣΗ/u);
      const nameKey = findRowKey(row, /^ΤΡΕΧ(?:ΟΥΣΑ|ΩΝ).*(?:ΕΠΩΝΥΜΙΑ|ΔΙΑΚΡΙΤΙΚΟΣ)/u);
      const currentOwnerKey = findRowKey(row, /^ΤΡΕΧΩΝ ΙΔΙΟΚΤΗΣΙΑΚΟΣ ΦΟΡΕΑΣ/u);
      const ownerKey = findRowKey(row, /^ΙΔΙΟΚΤΗΣΙΑΚΟΣ ΦΟΡΕΑΣ/u);
      const contactKey = findRowKey(row, /^ΣΤΟΙΧΕΙΑ ΕΠΙΚΟΙΝΩΝΙΑΣ/u);
      const txKey = findRowKey(row, /^ΣΥΧΝΟΤΗΤΑ/u);
      const programmeTypeKey = findRowKey(row, /^ΦΥΣΙΟΓΝΩΜΙΑ ΠΡΟΓΡΑΜΜΑΤΟΣ/u);

      const status = normalizeStatus(row[statusKey] ?? "");
      if (status !== "Λ") {
        continue;
      }

      const stationName = normalizeStationName(row[nameKey] ?? "");
      const ownerName = extractPrimaryOwner(
        row[currentOwnerKey] || row[ownerKey] || "",
      );
      const cityName = applyCityOverride(extractContactCity(row[contactKey] ?? ""));
      const transmission = extractTransmissionDetails(row[txKey] ?? "");
      const programmeType = normalizeText(row[programmeTypeKey] ?? "");

      if (!stationName || !cityName || !Number.isFinite(transmission.freqMhz)) {
        continue;
      }
      if (transmission.freqMhz < 87.5 || transmission.freqMhz > 108.0) {
        continue;
      }

      const dedupeKey = `${sheetName}|${stationName}|${transmission.freqMhz.toFixed(3)}`;
      if (dedupe.has(dedupeKey)) {
        continue;
      }
      dedupe.add(dedupeKey);

      stations.push({
        cityName,
        countryCode: "GR",
        curated: false,
        description: buildDescription({
          cityName,
          ownerName,
          programmeType,
          sheetName,
          stationName,
          transmissionSite: transmission.transmissionSite,
        }),
        freqMhz: transmission.freqMhz,
        name: stationName,
        source: "ESR radio station register workbook",
        sourceUrl: ESR_WORKBOOK_URL,
        tags: [
          "fm",
          "official",
          "greece",
          "esr",
          "licensing-register",
          transmission.transmissionSite ? toTag(transmission.transmissionSite) : "",
          programmeType ? toTag(programmeType) : "",
        ].filter(Boolean),
        timezone: "Europe/Athens",
        verifiedAt,
      });
    }
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
