import { compareText, normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const TRAFICOM_BC_LICENSES_URL =
  "https://eservices.traficom.fi/Licensesservices/Forms/BCLicenses.aspx?langid=en";
const USER_AGENT = "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)";
const WINDOWS_1252_DECODER = new TextDecoder("windows-1252");

const REQUIRED_HEADERS = {
  municipality: "Municipality",
  stationName: "Station name",
  frequency: "Frequency (MHz)",
  erp: "Transmission power (ERP)",
  polarization: "Polarisation",
  pattern: "D/ND",
  longitude: "Longitude (EUREF-FIN)",
  latitude: "Latitude (EUREF-FIN)",
  licenseNumber: "License number",
  licenseOwner: "License owner",
  shortTermStart: "Start date of the short-term licence",
  endingDate: "Ending date",
  programmingLicense: "Programming licence",
};

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function extractHiddenField(html, fieldName) {
  const pattern = new RegExp(
    String.raw`name="${fieldName.replace(/\$/g, "\\$")}"[^>]*value="([^"]*)"`,
    "i",
  );
  return html.match(pattern)?.[1] ?? "";
}

function parseFrequency(value) {
  const normalized = normalizeText(value);
  if (!/^\d{1,3},\d+$/u.test(normalized)) {
    return NaN;
  }

  const numeric = Number(normalized.replace(",", "."));
  return Number.isFinite(numeric) ? normalizeFreqMhz(numeric) : NaN;
}

function parseCompactCoordinate(value) {
  const match = normalizeText(value).match(/^(\d+)([NSEW])(\d{2})(\d{2})$/u);
  if (!match) {
    return NaN;
  }

  const [, degreesRaw, hemisphere, minutesRaw, secondsRaw] = match;
  const degrees = Number(degreesRaw);
  const minutes = Number(minutesRaw);
  const seconds = Number(secondsRaw);
  if (![degrees, minutes, seconds].every(Number.isFinite)) {
    return NaN;
  }

  const sign = hemisphere === "S" || hemisphere === "W" ? -1 : 1;
  return Number.parseFloat(
    (sign * (degrees + minutes / 60 + seconds / 3600)).toFixed(6),
  );
}

function buildHeaderIndex(headers) {
  const index = new Map();
  headers.forEach((header, position) => {
    index.set(normalizeText(header), position);
  });
  return index;
}

function getIndexedValue(columns, headerIndex, headerName) {
  const index = headerIndex.get(headerName);
  return index == null ? "" : normalizeText(columns[index] ?? "");
}

function buildDescription(row) {
  return [
    `Finnish FM licence listed by Traficom for ${row.municipality}.`,
    `Licensee: ${row.licenseOwner}.`,
    row.erp ? `ERP: ${row.erp} W.` : "",
    row.polarization ? `Polarization: ${row.polarization}.` : "",
    row.pattern ? `Pattern: ${row.pattern}.` : "",
    row.programmingLicense ? `Programming licence: ${row.programmingLicense}.` : "",
    row.endingDate ? `Valid until: ${row.endingDate}.` : "",
    row.licenseNumber ? `License number: ${row.licenseNumber}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

async function fetchTraficomPage() {
  const response = await fetch(TRAFICOM_BC_LICENSES_URL, {
    headers: {
      "user-agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to load Traficom BCLicenses form: HTTP ${response.status}`);
  }

  return response.text();
}

async function downloadTraficomTsv(html) {
  const form = new URLSearchParams({
    MainScriptManager_HiddenField: extractHiddenField(html, "MainScriptManager_HiddenField"),
    __EVENTTARGET: extractHiddenField(html, "__EVENTTARGET"),
    __EVENTARGUMENT: extractHiddenField(html, "__EVENTARGUMENT"),
    __VIEWSTATE: extractHiddenField(html, "__VIEWSTATE"),
    __VIEWSTATEGENERATOR: extractHiddenField(html, "__VIEWSTATEGENERATOR"),
    TelerikColumnsComboBox_ClientState: extractHiddenField(
      html,
      "TelerikColumnsComboBox_ClientState",
    ),
    "SearchControl$SearchTextBox": "",
    ButtonDownload: "Download as text file",
  });

  const response = await fetch(TRAFICOM_BC_LICENSES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": USER_AGENT,
    },
    body: form.toString(),
  });

  if (!response.ok) {
    throw new Error(`Failed to download Traficom BCLicenses TSV: HTTP ${response.status}`);
  }

  return WINDOWS_1252_DECODER.decode(await response.arrayBuffer());
}

function parseTraficomRows(tsv) {
  const lines = String(tsv ?? "")
    .split(/\r?\n/u)
    .filter((line) => line.length > 0);
  if (lines.length < 2) {
    throw new Error("Traficom BCLicenses TSV did not contain any data rows");
  }

  const headerIndex = buildHeaderIndex(lines[0].split("\t"));
  for (const headerName of Object.values(REQUIRED_HEADERS)) {
    if (!headerIndex.has(headerName)) {
      throw new Error(`Missing expected Traficom column: ${headerName}`);
    }
  }

  const rows = [];
  for (const line of lines.slice(1)) {
    const columns = line.split("\t");
    const municipality = getIndexedValue(columns, headerIndex, REQUIRED_HEADERS.municipality);
    const stationName = getIndexedValue(columns, headerIndex, REQUIRED_HEADERS.stationName);
    const freqMhz = parseFrequency(
      getIndexedValue(columns, headerIndex, REQUIRED_HEADERS.frequency),
    );
    const shortTermStart = getIndexedValue(
      columns,
      headerIndex,
      REQUIRED_HEADERS.shortTermStart,
    );

    if (!municipality || !stationName || !Number.isFinite(freqMhz)) {
      continue;
    }
    if (freqMhz < 87.5 || freqMhz > 108.0) {
      continue;
    }
    if (shortTermStart) {
      continue;
    }

    rows.push({
      endingDate: getIndexedValue(columns, headerIndex, REQUIRED_HEADERS.endingDate),
      erp: getIndexedValue(columns, headerIndex, REQUIRED_HEADERS.erp),
      freqMhz,
      latitude: parseCompactCoordinate(
        getIndexedValue(columns, headerIndex, REQUIRED_HEADERS.latitude),
      ),
      licenseNumber: getIndexedValue(columns, headerIndex, REQUIRED_HEADERS.licenseNumber),
      licenseOwner: getIndexedValue(columns, headerIndex, REQUIRED_HEADERS.licenseOwner),
      longitude: parseCompactCoordinate(
        getIndexedValue(columns, headerIndex, REQUIRED_HEADERS.longitude),
      ),
      municipality,
      pattern: getIndexedValue(columns, headerIndex, REQUIRED_HEADERS.pattern),
      polarization: getIndexedValue(columns, headerIndex, REQUIRED_HEADERS.polarization),
      programmingLicense: getIndexedValue(
        columns,
        headerIndex,
        REQUIRED_HEADERS.programmingLicense,
      ),
      stationName,
    });
  }

  return rows;
}

export async function loadTraficomFiStations() {
  const html = await fetchTraficomPage();
  const tsv = await downloadTraficomTsv(html);
  const rows = parseTraficomRows(tsv);
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const row of rows) {
    const dedupeKey = `${row.municipality}|${row.stationName}|${row.freqMhz.toFixed(3)}`;
    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.set(dedupeKey, {
      cityName: row.municipality,
      countryCode: "FI",
      curated: false,
      description: buildDescription(row),
      freqMhz: row.freqMhz,
      latitude: Number.isFinite(row.latitude) ? row.latitude : undefined,
      longitude: Number.isFinite(row.longitude) ? row.longitude : undefined,
      name: row.stationName,
      source: "Traficom radio station register",
      sourceUrl: TRAFICOM_BC_LICENSES_URL,
      tags: [
        "fm",
        "official",
        "finland",
        "traficom",
        toTag(row.stationName),
        row.programmingLicense ? toTag(row.programmingLicense) : "",
        row.pattern ? toTag(row.pattern) : "",
      ].filter(Boolean),
      timezone: "Europe/Helsinki",
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
