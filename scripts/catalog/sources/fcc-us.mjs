import AdmZip from "adm-zip";

import { normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const FCC_PAGE_URL =
  "https://enterpriseefiling.fcc.gov/dataentry/public/tv/lmsDatabase.html";
const TERRITORY_TO_COUNTRY = {
  AS: "AS",
  FM: "FM",
  GU: "GU",
  MH: "MH",
  MP: "MP",
  PR: "PR",
  PW: "PW",
  VI: "VI",
};
const EXCLUDED_STATE_CODES = new Set(["AA", "AE", "AP", "NA"]);
const INCLUDED_SERVICE_CODES = new Set(["FM", "FL", "FX", "FB"]);
const INCLUDED_FACILITY_STATUSES = new Set([
  "INTOP",
  "LICEN",
  "LICRP",
  "LICSL",
  "LICSU",
  "PTANF",
]);

async function downloadTextFromZip(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  }

  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  const [entry] = zip.getEntries();
  if (!entry) {
    throw new Error(`FCC zip file is empty: ${url}`);
  }

  return zip.readAsText(entry, "utf8");
}

async function resolveFccDatasetDate() {
  const res = await fetch(FCC_PAGE_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to open FCC LMS page: HTTP ${res.status}`);
  }

  const html = await res.text();
  const match = html.match(/download\/dbfile\/([^/]+)\/facility\.zip/i);
  if (!match) {
    throw new Error("Could not determine FCC LMS dataset date");
  }

  return match[1];
}

function parsePipeRows(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    return [];
  }

  const headers = lines.shift().split("|");
  return lines.map((line) => {
    const values = line.split("|");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function buildFacilityDescription(serviceCode, cityName, stateName, callsign) {
  const serviceLabel =
    serviceCode === "FL"
      ? "Low Power FM"
      : serviceCode === "FX"
        ? "FM translator"
        : serviceCode === "FB"
          ? "FM booster"
          : "Full Power FM";

  return `${serviceLabel} service listed by FCC for ${cityName}, ${stateName}. Callsign: ${callsign}.`;
}

export async function loadFccUsStations() {
  const datasetDate = await resolveFccDatasetDate();
  const baseUrl = `https://enterpriseefiling.fcc.gov/dataentry/api/download/dbfile/${datasetDate}`;
  const [facilityText, stateText] = await Promise.all([
    downloadTextFromZip(`${baseUrl}/facility.zip`),
    downloadTextFromZip(`${baseUrl}/lkp_state.zip`),
  ]);

  const stateRows = parsePipeRows(stateText);
  const stateMeta = new Map(
    stateRows.map((row) => [
      row.state_code,
      {
        countryCode: row.country_code,
        stateName: row.state_name,
      },
    ]),
  );

  const facilityRows = parsePipeRows(facilityText);
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const dedupe = new Map();

  for (const row of facilityRows) {
    const serviceCode = row.service_code;
    const facilityStatus = row.facility_status;
    const stateCode = row.community_served_state;
    const callsign = String(row.callsign || "").trim();
    const cityName = String(row.community_served_city || "").trim();
    const freqMhz = normalizeFreqMhz(row.frequency);
    const state = stateMeta.get(stateCode);
    const facilityId = Number.parseInt(row.facility_id, 10);

    if (!INCLUDED_SERVICE_CODES.has(serviceCode)) {
      continue;
    }
    if (!INCLUDED_FACILITY_STATUSES.has(facilityStatus)) {
      continue;
    }
    if (!state || state.countryCode !== "US" || EXCLUDED_STATE_CODES.has(stateCode)) {
      continue;
    }
    if (!callsign || callsign === "NEW" || !cityName) {
      continue;
    }
    if (!Number.isFinite(freqMhz) || freqMhz < 87 || freqMhz > 108.5) {
      continue;
    }
    if (!Number.isFinite(facilityId) || facilityId <= 0) {
      continue;
    }

    const countryCode = TERRITORY_TO_COUNTRY[stateCode] || "US";
    const key = `${countryCode}|${stateCode}|${cityName}|${callsign}|${freqMhz.toFixed(3)}`;
    if (!dedupe.has(key)) {
      dedupe.set(key, {
        admin1Code: countryCode === "US" ? stateCode : undefined,
        callsign,
        cityName,
        countryCode,
        freqMhz,
        serviceCode,
        stateCode,
        stateName: state.stateName,
      });
    }
  }

  return [...dedupe.values()].map((row) => ({
    admin1Code: row.admin1Code,
    cityName: row.cityName,
    countryCode: row.countryCode,
    curated: false,
    description: buildFacilityDescription(
      row.serviceCode,
      row.cityName,
      row.stateName,
      row.callsign,
    ),
    freqMhz: row.freqMhz,
    name: row.callsign,
    source: "FCC LMS Public Database",
    sourceUrl: FCC_PAGE_URL,
    tags: [
      "fm",
      "official",
      "fcc",
      toTag(row.stateName || row.stateCode),
      row.serviceCode === "FL"
        ? "low-power"
        : row.serviceCode === "FX"
          ? "translator"
          : row.serviceCode === "FB"
            ? "booster"
            : "full-power",
    ],
    verifiedAt,
  }));
}
