import { normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const SDFI_PAGE_URL = "https://frekvensregister.sdfi.dk/Search/Search.aspx";
const SDFI_RESULT_URL = "https://frekvensregister.sdfi.dk/Search/Result.aspx";
const USER_AGENT = "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)";
const PAGE_SIZE = 50;

const DEFAULT_QUERY = {
  MMSI: "",
  SFE: "108",
  SFS: "87,5",
  CuNo: "",
  FPt: "",
  FPf: "",
  Lno1: "",
  Lno2: "",
  CuAdd: "",
  CuAdd2: "",
  Fadd: "",
  FCity: "",
  CuCity: "",
  CS: "",
  CuName: "",
  CuCVR: "",
  CPCF: "",
  CPCt: "",
  UDF: "",
  UDT: "",
  IntHa: "false",
  IntSu: "false",
  PA: "",
  LG: "6",
  UdMet: "",
  GA: "",
};

const SOURCE_CONFIGS = [
  {
    listTag: "local-fm",
    typeId: "19",
  },
  {
    listTag: "national-fm",
    typeId: "29",
  },
];

const HTML_ENTITY_MAP = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
  AElig: "\u00c6",
  aelig: "\u00e6",
  Aring: "\u00c5",
  aring: "\u00e5",
  Oslash: "\u00d8",
  oslash: "\u00f8",
};

function normalizeText(value) {
  return decodeHtmlEntities(
    String(value ?? "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, rawCode) => {
      const code = Number.parseInt(rawCode, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, rawCode) => {
      const code = Number.parseInt(rawCode, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&([a-z][a-z0-9]+);/gi, (match, name) => HTML_ENTITY_MAP[name] || match);
}

function escapeRegex(value) {
  return String(value).replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&");
}

function buildResultUrl(typeId) {
  const params = new URLSearchParams({
    ...DEFAULT_QUERY,
    Type: String(typeId),
  });
  return `${SDFI_RESULT_URL}?${params.toString()}`;
}

async function fetchHtml(url, options = {}) {
  const headers = {
    "user-agent": USER_AGENT,
    ...(options.headers || {}),
  };
  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch SDFI page: HTTP ${res.status} for ${url}`);
  }

  return res.text();
}

function extractHiddenInput(html, name) {
  const pattern = new RegExp(
    `<input[^>]+name="${escapeRegex(name)}"[^>]+value="([\\s\\S]*?)"`,
    "i",
  );
  return decodeHtmlEntities(html.match(pattern)?.[1] || "");
}

function extractCount(html, id) {
  const pattern = new RegExp(`id="${escapeRegex(id)}">(\\d+)<`, "i");
  const value = Number.parseInt(html.match(pattern)?.[1] || "", 10);
  return Number.isFinite(value) ? value : 0;
}

async function postBack(url, currentHtml, fields) {
  const body = new URLSearchParams({
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __VIEWSTATE: extractHiddenInput(currentHtml, "__VIEWSTATE"),
    __VIEWSTATEGENERATOR: extractHiddenInput(currentHtml, "__VIEWSTATEGENERATOR"),
    ...fields,
  });

  return fetchHtml(url, {
    body,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
}

function stripOuterElement(block, tagName) {
  const openEnd = block.indexOf(">");
  const closeStart = block.lastIndexOf(`</${tagName}>`);
  if (openEnd === -1 || closeStart === -1) {
    return "";
  }
  return block.slice(openEnd + 1, closeStart);
}

function extractElementById(html, tagName, id) {
  const openPattern = new RegExp(
    `<${tagName}\\b[^>]*\\bid="${escapeRegex(id)}"[^>]*>`,
    "i",
  );
  const openMatch = openPattern.exec(html);
  if (!openMatch) {
    return "";
  }

  const tokenPattern = new RegExp(`</?${tagName}\\b[^>]*>`, "gi");
  tokenPattern.lastIndex = openMatch.index;

  let depth = 0;
  let tokenMatch;
  while ((tokenMatch = tokenPattern.exec(html))) {
    if (tokenMatch[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) {
        return html.slice(openMatch.index, tokenPattern.lastIndex);
      }
      continue;
    }

    depth += 1;
  }

  return "";
}

function extractTopLevelBlocks(markup, tagName) {
  const tokenPattern = new RegExp(`</?${tagName}\\b[^>]*>`, "gi");
  const blocks = [];
  let depth = 0;
  let blockStart = -1;
  let tokenMatch;

  while ((tokenMatch = tokenPattern.exec(markup))) {
    if (tokenMatch[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0 && blockStart !== -1) {
        blocks.push(markup.slice(blockStart, tokenPattern.lastIndex));
        blockStart = -1;
      }
      continue;
    }

    if (depth === 0) {
      blockStart = tokenMatch.index;
    }
    depth += 1;
  }

  return blocks;
}

function extractTopLevelCellBlocks(rowHtml) {
  return extractTopLevelBlocks(stripOuterElement(rowHtml, "tr"), "td");
}

function stripOuterCell(cellHtml) {
  return stripOuterElement(cellHtml, "td");
}

function decodeDmsCoordinate(raw, axis) {
  const value = normalizeText(raw);
  if (!value) {
    return NaN;
  }

  if (axis === "lon") {
    const match = value.match(/^(\d{3})([EW])(\d{2})(\d{2})$/);
    if (!match) {
      return NaN;
    }

    const degrees = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[3], 10);
    const seconds = Number.parseInt(match[4], 10);
    const sign = match[2] === "W" ? -1 : 1;
    return sign * (degrees + minutes / 60 + seconds / 3600);
  }

  const match = value.match(/^(\d{2})([NS])(\d{2})(\d{2})$/);
  if (!match) {
    return NaN;
  }

  const degrees = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[3], 10);
  const seconds = Number.parseInt(match[4], 10);
  const sign = match[2] === "S" ? -1 : 1;
  return sign * (degrees + minutes / 60 + seconds / 3600);
}

function parseCoordinatePair(raw) {
  const value = normalizeText(raw);
  const match = value.match(/(\d{2}[NS]\d{4})\s+(\d{3}[EW]\d{4})/i);
  if (!match) {
    return {
      latitude: NaN,
      longitude: NaN,
    };
  }

  return {
    latitude: decodeDmsCoordinate(match[1], "lat"),
    longitude: decodeDmsCoordinate(match[2], "lon"),
  };
}

function parseFreqMhz(raw) {
  const normalized = normalizeText(raw)
    .replace(",", ".")
    .match(/-?\d+(?:\.\d+)?/);
  return normalizeFreqMhz(normalized?.[0]);
}

function parseKmlCoordinates(cellHtml) {
  const rawPayload = cellHtml.match(/ShowOnMap\(&#39;([\s\S]*?)&#39;\)/i)?.[1];
  if (!rawPayload) {
    return {
      latitude: NaN,
      longitude: NaN,
    };
  }

  try {
    const decodedPayload = decodeURIComponent(decodeHtmlEntities(rawPayload).replace(/\+/g, "%20"));
    const match = decodedPayload.match(
      /<coordinates>\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*<\/coordinates>/i,
    );

    return {
      latitude: Number.parseFloat(match?.[2] || ""),
      longitude: Number.parseFloat(match?.[1] || ""),
    };
  } catch {
    return {
      latitude: NaN,
      longitude: NaN,
    };
  }
}

function extractSpanTextBySuffix(html, suffix) {
  const pattern = new RegExp(
    `<span[^>]+id="[^"]*_${escapeRegex(suffix)}"[^>]*>([\\s\\S]*?)</span>`,
    "i",
  );
  return normalizeText(html.match(pattern)?.[1] || "");
}

function parseSummaryRow(cellBlocks) {
  const permitId = normalizeText(stripOuterCell(cellBlocks[1]));
  return {
    cityName: normalizeText(stripOuterCell(cellBlocks[6])),
    fallbackCoords: parseKmlCoordinates(cellBlocks[7]),
    freqMhz: parseFreqMhz(stripOuterCell(cellBlocks[2])),
    name: normalizeText(stripOuterCell(cellBlocks[4])),
    permitId,
    permitType: normalizeText(stripOuterCell(cellBlocks[5])),
  };
}

function parseDetailRow(detailCellHtml) {
  return {
    bandwidthMhz: normalizeText(extractSpanTextBySuffix(detailCellHtml, "Label8")),
    coordinates: normalizeText(extractSpanTextBySuffix(detailCellHtml, "Label6")),
    geographicUsage: normalizeText(extractSpanTextBySuffix(detailCellHtml, "Label20")),
    holderAddress: normalizeText(extractSpanTextBySuffix(detailCellHtml, "LabelBrugerAdresse1")),
    holderAddress2: normalizeText(extractSpanTextBySuffix(detailCellHtml, "LabelBrugerAdresse21")),
    holderCity: normalizeText(extractSpanTextBySuffix(detailCellHtml, "LabelBrugerByNavn1")),
    holderNumber: normalizeText(extractSpanTextBySuffix(detailCellHtml, "LabelBrugernummer1")),
    holderPostCode: normalizeText(extractSpanTextBySuffix(detailCellHtml, "LabelBrugerPostnummer1")),
    issueMethod: normalizeText(extractSpanTextBySuffix(detailCellHtml, "Label19")),
    power: normalizeText(extractSpanTextBySuffix(detailCellHtml, "Label7")),
    siteAddress: normalizeText(extractSpanTextBySuffix(detailCellHtml, "LabelAddress1")),
    siteCity: normalizeText(extractSpanTextBySuffix(detailCellHtml, "LabelByNavn1")),
    sitePostCode: normalizeText(extractSpanTextBySuffix(detailCellHtml, "LabelPostNummer1")),
    validUntil: normalizeText(extractSpanTextBySuffix(detailCellHtml, "Label17")),
  };
}

function formatSiteLocation(detail) {
  const postalLocation = [detail.sitePostCode, detail.siteCity].filter(Boolean).join(" ");
  return [detail.siteAddress, postalLocation].filter(Boolean).join(", ");
}

function deriveCityName(summary, detail) {
  if (detail.siteCity) {
    return detail.siteCity;
  }
  if (summary.cityName) {
    return summary.cityName;
  }
  if (detail.siteAddress && /\d/.test(detail.siteAddress) === false) {
    return detail.siteAddress;
  }
  if (detail.holderCity) {
    return detail.holderCity;
  }
  return summary.name;
}

function buildDescription(summary, detail, latitude, longitude) {
  const siteLocation = formatSiteLocation(detail);
  const cityName = deriveCityName(summary, detail);
  const parts = [
    `Danish FM transmitter permit listed by SDFI for ${cityName}.`,
    summary.name ? `Licensee: ${summary.name}.` : "",
    summary.permitId ? `Permit: ${summary.permitId}.` : "",
    summary.permitType ? `Type: ${summary.permitType}.` : "",
    siteLocation ? `Site: ${siteLocation}.` : "",
    detail.geographicUsage ? `Usage: ${detail.geographicUsage}.` : "",
    detail.power ? `Power: ${detail.power}.` : "",
    detail.bandwidthMhz ? `Bandwidth: ${detail.bandwidthMhz} MHz.` : "",
    detail.issueMethod ? `Issue method: ${detail.issueMethod}.` : "",
    detail.validUntil ? `Expiry: ${detail.validUntil}.` : "",
    Number.isFinite(latitude) && Number.isFinite(longitude)
      ? `Coordinates: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}.`
      : "",
  ];

  return parts.filter(Boolean).join(" ");
}

function buildStation(summary, detail, sourceUrl, listTag, verifiedAt) {
  const coords = parseCoordinatePair(detail.coordinates);
  const latitude = Number.isFinite(coords.latitude) ? coords.latitude : summary.fallbackCoords.latitude;
  const longitude = Number.isFinite(coords.longitude)
    ? coords.longitude
    : summary.fallbackCoords.longitude;
  const cityName = deriveCityName(summary, detail);

  return {
    cityName,
    countryCode: "DK",
    curated: false,
    description: buildDescription(summary, detail, latitude, longitude),
    freqMhz: summary.freqMhz,
    latitude,
    longitude,
    name: summary.name,
    source: "SDFI Frekvensregistret",
    sourceUrl,
    tags: [
      "fm",
      "official",
      "sdfi",
      "denmark",
      listTag,
      cityName ? toTag(cityName) : "denmark",
    ],
    timezone: "Europe/Copenhagen",
    verifiedAt,
  };
}

function parseResultPageStations(html, sourceUrl, listTag, verifiedAt) {
  const tableHtml = extractElementById(html, "table", "ctl00__cph__cGridView");
  if (!tableHtml) {
    throw new Error("SDFI result table not found");
  }

  const rows = extractTopLevelBlocks(stripOuterElement(tableHtml, "table"), "tr");
  const stations = [];
  let currentSummary = null;

  for (const rowHtml of rows) {
    const cellBlocks = extractTopLevelCellBlocks(rowHtml);
    if (cellBlocks.length === 8) {
      const summary = parseSummaryRow(cellBlocks);
      if (!summary.permitId || !Number.isFinite(summary.freqMhz) || !summary.name) {
        currentSummary = null;
        continue;
      }

      currentSummary = summary;
      continue;
    }

    if (
      currentSummary &&
      cellBlocks.length === 1 &&
      /detailPanel/i.test(rowHtml)
    ) {
      stations.push(
        buildStation(
          currentSummary,
          parseDetailRow(stripOuterCell(cellBlocks[0])),
          sourceUrl,
          listTag,
          verifiedAt,
        ),
      );
      currentSummary = null;
    }
  }

  return stations;
}

async function loadStationsForType(config, verifiedAt) {
  const sourceUrl = buildResultUrl(config.typeId);
  let html = await fetchHtml(sourceUrl);
  const totalCount = extractCount(html, "ctl00__cph__lblTotal");

  html = await postBack(sourceUrl, html, {
    __EVENTTARGET: "ctl00$_cph$_rbViewList$2",
    __EVENTARGUMENT: "",
    "ctl00$_cph$_rbViewList": String(PAGE_SIZE),
  });

  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const stations = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    if (pageNumber > 1) {
      html = await postBack(sourceUrl, html, {
        __EVENTTARGET: "ctl00$_cph$_cGridView",
        __EVENTARGUMENT: `Page$${pageNumber}`,
        "ctl00$_cph$_rbViewList": String(PAGE_SIZE),
      });
    }

    stations.push(...parseResultPageStations(html, sourceUrl, config.listTag, verifiedAt));
  }

  const deduped = new Map();
  for (const station of stations) {
    const key = `${station.name}|${station.cityName}|${station.freqMhz.toFixed(3)}|${station.sourceUrl}`;
    if (!deduped.has(key)) {
      deduped.set(key, station);
    }
  }

  if (deduped.size !== totalCount) {
    throw new Error(
      `SDFI parser mismatch for Type=${config.typeId}: expected ${totalCount} rows, parsed ${deduped.size}`,
    );
  }

  return [...deduped.values()];
}

export async function loadSdfiDkStations() {
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const allStations = await Promise.all(
    SOURCE_CONFIGS.map((config) => loadStationsForType(config, verifiedAt)),
  );

  return allStations.flat();
}

export { SDFI_PAGE_URL };
