import http from "node:http";
import https from "node:https";

import { normalizeFreqMhz, toTag } from "../lib/utils.mjs";

const RATEL_PAGE_URL = "https://registar.ratel.rs/en/reg204";
const RATEL_QUERY_PARAMS = {
  action: "table",
  vazece: "2100",
  vrstaStanice: "BC",
  freqOd: "87.5",
  freqOdJedinica: "6",
  freqDo: "108",
  freqDoJedinica: "6",
};
const USER_AGENT = "Mozilla/5.0 (compatible; hackrf-webui-catalog-builder/0.1)";

const HTML_ENTITY_MAP = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function buildSearchUrl(pageNumber = 1) {
  const params = new URLSearchParams(RATEL_QUERY_PARAMS);
  if (pageNumber > 1) {
    params.set("page", String(pageNumber));
  }
  return `${RATEL_PAGE_URL}?${params.toString()}`;
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

function normalizeText(value) {
  return decodeHtmlEntities(
    String(value ?? "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value) {
  return String(value).replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&");
}

function extractAttribute(html, name) {
  const pattern = new RegExp(`\\b${escapeRegex(name)}="([\\s\\S]*?)"`, "i");
  return decodeHtmlEntities(html.match(pattern)?.[1] || "");
}

function stripOuterElement(block, tagName) {
  const openEnd = block.indexOf(">");
  const closeStart = block.lastIndexOf(`</${tagName}>`);
  if (openEnd === -1 || closeStart === -1) {
    return "";
  }
  return block.slice(openEnd + 1, closeStart);
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

function extractElementByClass(html, tagName, className) {
  const openPattern = new RegExp(
    `<${tagName}\\b[^>]*\\bclass="[^"]*\\b${escapeRegex(className)}\\b[^"]*"[^>]*>`,
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

function extractTopLevelCellBlocks(rowHtml) {
  return extractTopLevelBlocks(stripOuterElement(rowHtml, "tr"), "td");
}

function stripOuterCell(cellHtml) {
  return stripOuterElement(cellHtml, "td");
}

function parseFrequencyMhz(raw) {
  const value = normalizeText(raw)
    .replace(/mhz/i, "")
    .trim();
  return normalizeFreqMhz(value);
}

function decodeCompactCoordinate(raw, axis) {
  const value = normalizeText(raw);
  const match =
    axis === "lon"
      ? value.match(/^(\d{2,3})(\d{2})(\d{2})$/)
      : value.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (!match) {
    return NaN;
  }

  const degrees = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  const seconds = Number.parseInt(match[3], 10);
  return degrees + minutes / 60 + seconds / 3600;
}

function titleCaseLocation(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  return normalized
    .toLocaleLowerCase("sr")
    .split(/(\s+|,|-|\/|\(|\))/)
    .map((part) => {
      if (!part || /^[\s,\/() -]+$/u.test(part)) {
        return part;
      }
      return `${part[0].toLocaleUpperCase("sr")}${part.slice(1)}`;
    })
    .join("");
}

function primaryLocationTag(locationName) {
  const primary = normalizeText(locationName)
    .split(",")[0]
    ?.split(/\s*-\s*/)[0]
    ?.trim();
  return primary ? toTag(primary) : "serbia";
}

function buildDescription(row) {
  const parts = [
    `Serbian FM broadcasting permit listed by RATEL for ${row.locationName}.`,
    row.holderName ? `Rights holder: ${row.holderName}.` : "",
    row.holderAddress ? `Address: ${row.holderAddress}.` : "",
    row.identificationSign ? `Identification sign: ${row.identificationSign}.` : "",
    row.licenseReference ? `License reference: ${row.licenseReference}.` : "",
    row.validUntil ? `Valid until: ${row.validUntil}.` : "",
    Number.isFinite(row.latitude) && Number.isFinite(row.longitude)
      ? `Coordinates: ${row.latitude.toFixed(4)}, ${row.longitude.toFixed(4)}.`
      : "",
  ];

  return parts.filter(Boolean).join(" ");
}

function parseRow(cellBlocks) {
  const holderCell = cellBlocks[2];
  const locationCell = cellBlocks[9];
  const longitudeRaw = locationCell.match(/map\((\d+),\s*(\d+),\s*'[\s\S]*?'\)/i)?.[1] || "";
  const latitudeRaw = locationCell.match(/map\((\d+),\s*(\d+),\s*'[\s\S]*?'\)/i)?.[2] || "";
  const locationName = titleCaseLocation(stripOuterCell(locationCell));

  return {
    holderAddress: normalizeText(extractAttribute(holderCell, "title")),
    holderName: normalizeText(stripOuterCell(holderCell)),
    identificationSign: normalizeText(stripOuterCell(cellBlocks[7])),
    licenseReference: normalizeText(stripOuterCell(cellBlocks[1])),
    locationName,
    freqMhz: parseFrequencyMhz(stripOuterCell(cellBlocks[3])),
    latitude: decodeCompactCoordinate(latitudeRaw, "lat"),
    longitude: decodeCompactCoordinate(longitudeRaw, "lon"),
    validUntil: normalizeText(stripOuterCell(cellBlocks[6])),
  };
}

function parsePage(html, sourceUrl, verifiedAt) {
  const tableHtml = extractElementByClass(html, "table", "result-table");
  if (!tableHtml) {
    throw new Error("RATEL result table not found");
  }

  const tbodyHtml = tableHtml.match(/<tbody>([\s\S]*?)<\/tbody>/i)?.[1] || "";
  const rowBlocks = extractTopLevelBlocks(tbodyHtml, "tr");
  const stations = [];

  for (const rowHtml of rowBlocks) {
    if (/class="hidden additional-data/i.test(rowHtml)) {
      continue;
    }

    const cellBlocks = extractTopLevelCellBlocks(rowHtml);
    if (cellBlocks.length !== 11) {
      continue;
    }

    const row = parseRow(cellBlocks);
    if (!row.holderName || !row.locationName || !Number.isFinite(row.freqMhz)) {
      continue;
    }

    stations.push({
      cityName: row.locationName,
      countryCode: "RS",
      curated: false,
      description: buildDescription(row),
      freqMhz: row.freqMhz,
      latitude: row.latitude,
      longitude: row.longitude,
      name: row.holderName,
      source: "RATEL broadcasting spectrum register",
      sourceUrl,
      tags: [
        "fm",
        "official",
        "ratel",
        "serbia",
        "valid",
        primaryLocationTag(row.locationName),
      ],
      timezone: "Europe/Belgrade",
      verifiedAt,
    });
  }

  return stations;
}

async function requestBuffer(url, redirects = 0) {
  if (redirects > 5) {
    throw new Error(`Too many redirects while requesting ${url}`);
  }

  const target = new URL(url);
  const transport = target.protocol === "https:" ? https : http;
  const options = {
    headers: {
      "user-agent": USER_AGENT,
    },
    hostname: target.hostname,
    method: "GET",
    path: `${target.pathname}${target.search}`,
    port: target.port || undefined,
    // RATEL serves this host with an incomplete certificate chain from this environment.
    ...(target.protocol === "https:" ? { rejectUnauthorized: false } : {}),
  };

  return new Promise((resolve, reject) => {
    const req = transport.request(options, (res) => {
      const statusCode = res.statusCode || 0;
      if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(requestBuffer(new URL(res.headers.location, target).toString(), redirects + 1));
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        reject(new Error(`Failed to fetch RATEL page: HTTP ${statusCode} for ${url}`));
        res.resume();
        return;
      }

      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });

    req.on("error", reject);
    req.end();
  });
}

async function fetchHtml(url) {
  return (await requestBuffer(url)).toString("utf8");
}

export async function loadRatelRsStations() {
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const sourceUrl = buildSearchUrl();
  const firstPageHtml = await fetchHtml(sourceUrl);
  const totalCount = Number.parseInt(
    firstPageHtml.match(/<strong>(\d+)<\/strong>\s+records/i)?.[1] || "",
    10,
  );
  const pageCount = Number.parseInt(
    firstPageHtml.match(/page=(\d+)" class="last-page-link"/i)?.[1] || "1",
    10,
  );

  if (!Number.isFinite(totalCount) || totalCount <= 0) {
    throw new Error("RATEL valid FM query returned no count");
  }

  const remainingPages = await Promise.all(
    Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
      fetchHtml(buildSearchUrl(index + 2)),
    ),
  );

  const stations = [
    ...parsePage(firstPageHtml, sourceUrl, verifiedAt),
    ...remainingPages.flatMap((html) => parsePage(html, sourceUrl, verifiedAt)),
  ];

  const deduped = new Map();
  for (const station of stations) {
    const key = `${station.name}|${station.cityName}|${station.freqMhz.toFixed(3)}|${station.description}`;
    if (!deduped.has(key)) {
      deduped.set(key, station);
    }
  }

  if (deduped.size !== totalCount) {
    throw new Error(
      `RATEL parser mismatch: expected ${totalCount} rows, parsed ${deduped.size}`,
    );
  }

  return [...deduped.values()];
}

export { RATEL_PAGE_URL };
