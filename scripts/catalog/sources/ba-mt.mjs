import { compareText, normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const BA_STATIONS_URL = "https://ba.org.mt/stations-licenced";

const CITY_ALIASES = new Map([
  ["blata-l-bajda", "Hamrun"],
  ["g-mangia", "Pieta"],
  ["gmangia", "Pieta"],
  ["san-pawl-tat-targa", "Naxxar"],
]);

function normalizeText(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value) {
  return normalizeText(
    String(value ?? "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/address>/gi, "\n")
      .replace(/<address[^>]*>/gi, "")
      .replace(/<[^>]+>/g, " "),
  );
}

function normalizePlaceName(value) {
  return normalizeText(value)
    .replace(/\bGozo\b/giu, "")
    .replace(/\b[A-Z]{3}\s*\d{3,4}\b/gu, "")
    .replace(/\b[A-Z]{3}\d{3,4}\b/gu, "")
    .replace(/[()]/g, " ")
    .replace(/[.;]+$/g, "")
    .trim();
}

function extractSectionTable(html, sectionTitle) {
  const titlePattern = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(
    new RegExp(
      `<h4[^>]*>[\\s\\S]*?${titlePattern}[\\s\\S]*?<\\/h4>[\\s\\S]*?<table[^>]*>([\\s\\S]*?)<\\/table>`,
      "iu",
    ),
  );
  return match?.[1] ?? "";
}

function parseTableRows(tableHtml) {
  const rowHtmls = tableHtml.match(/<tr[\s\S]*?<\/tr>/giu) ?? [];
  return rowHtmls.map((rowHtml) =>
    [...rowHtml.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/giu)].map((match) => match[1]),
  );
}

function extractCellLines(cellHtml) {
  return String(cellHtml ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/address>/gi, "\n")
    .replace(/<address[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .split(/\r?\n/u)
    .map((line) => normalizeText(line))
    .filter(Boolean);
}

function parseFrequencyValues(lines) {
  const freqs = [];
  for (const line of lines) {
    const matches = line.match(/\d{2,3}(?:\.\d+)?\s*(?:Mhz|MHz)/giu) ?? [];
    for (const match of matches) {
      const freqMhz = normalizeFreqMhz(match.replace(/mhz/iu, "").trim());
      if (Number.isFinite(freqMhz)) {
        freqs.push(freqMhz);
      }
    }
  }
  return freqs;
}

function extractCityFromAddress(addressText) {
  const cleaned = normalizeText(addressText)
    .replace(/\bTel:.*$/iu, "")
    .replace(/\bEmail:.*$/iu, "")
    .trim();
  const parts = cleaned
    .split(",")
    .map((part) => normalizePlaceName(part))
    .filter(Boolean);

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const candidate = parts[index];
    if (!candidate || !/\p{Letter}/u.test(candidate)) {
      continue;
    }

    const alias = CITY_ALIASES.get(toTag(candidate));
    return alias ?? candidate;
  }

  const postcodeMatch = cleaned.match(/([A-Za-zÀ-ÿ' -]+)\s+[A-Z]{3}\s*\d{3,4}\b/u);
  if (postcodeMatch) {
    const candidate = normalizePlaceName(postcodeMatch[1]);
    if (candidate && /\p{Letter}/u.test(candidate)) {
      const alias = CITY_ALIASES.get(toTag(candidate));
      return alias ?? candidate;
    }
  }

  return "";
}

function buildDescription({ address, cityName, company, frequencyLabel, sourceLabel, stationName }) {
  return [
    `Maltese ${sourceLabel} listed by the Broadcasting Authority for ${cityName}.`,
    `Station: ${stationName}.`,
    company ? `Licensee: ${company}.` : "",
    frequencyLabel ? `Frequency: ${frequencyLabel}.` : "",
    address ? `Address: ${address}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildStation({
  address,
  cityName,
  company,
  freqMhz,
  frequencyLabel,
  sourceLabel,
  stationName,
  verifiedAt,
}) {
  return {
    cityName,
    countryCode: "MT",
    curated: false,
    description: buildDescription({
      address,
      cityName,
      company,
      frequencyLabel,
      sourceLabel,
      stationName,
    }),
    freqMhz,
    name: stationName,
    source: `Broadcasting Authority ${sourceLabel} table`,
    sourceUrl: BA_STATIONS_URL,
    tags: [
      "fm",
      "official",
      "malta",
      "broadcasting-authority",
      toTag(sourceLabel),
      toTag(stationName),
    ],
    timezone: "Europe/Malta",
    verifiedAt,
  };
}

function parseNationwideRows(rows, verifiedAt) {
  const stations = [];
  for (const row of rows.slice(1)) {
    if (row.length < 4) {
      continue;
    }

    const stationNames = extractCellLines(row[0]);
    const frequencies = parseFrequencyValues(extractCellLines(row[1]));
    const company = stripHtml(row[2]);
    const address = stripHtml(row[3]);
    const cityName = extractCityFromAddress(address);

    if (!cityName || !stationNames.length || !frequencies.length) {
      continue;
    }

    const limit = Math.min(stationNames.length, frequencies.length);
    for (let index = 0; index < limit; index += 1) {
      stations.push(
        buildStation({
          address,
          cityName,
          company,
          freqMhz: frequencies[index],
          frequencyLabel: `${frequencies[index].toFixed(1)} MHz`,
          sourceLabel: "nationwide radio",
          stationName: stationNames[index],
          verifiedAt,
        }),
      );
    }
  }

  return stations;
}

function parseCommunityRows(rows, verifiedAt) {
  const stations = [];
  for (const row of rows.slice(1)) {
    if (row.length < 3) {
      continue;
    }

    const stationName = stripHtml(row[0]);
    const frequencyLabel = stripHtml(row[1]);
    const address = stripHtml(row[2]);
    const freqMatch = frequencyLabel.match(/\d{2,3}(?:\.\d+)?/u);
    const freqMhz = normalizeFreqMhz(freqMatch?.[0]);
    const cityName = extractCityFromAddress(address);

    if (!stationName || !cityName || !Number.isFinite(freqMhz)) {
      continue;
    }

    stations.push(
      buildStation({
        address,
        cityName,
        company: "",
        freqMhz,
        frequencyLabel,
        sourceLabel: "community radio",
        stationName,
        verifiedAt,
      }),
    );
  }

  return stations;
}

export async function loadBaMtStations() {
  const response = await fetch(BA_STATIONS_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download Broadcasting Authority stations page: HTTP ${response.status}`);
  }

  const html = await response.text();
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const nationwideTable = extractSectionTable(html, "Nationwide Radio Stations");
  const communityTable = extractSectionTable(html, "Long Term Community Radio Stations");

  const dedupe = new Map();
  for (const station of [
    ...parseNationwideRows(parseTableRows(nationwideTable), verifiedAt),
    ...parseCommunityRows(parseTableRows(communityTable), verifiedAt),
  ]) {
    const key = `${station.cityName}|${station.name}|${station.freqMhz.toFixed(3)}`;
    if (!dedupe.has(key)) {
      dedupe.set(key, station);
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
