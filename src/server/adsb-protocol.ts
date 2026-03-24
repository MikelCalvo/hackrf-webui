import type {
  AdsbAircraftContact,
  AdsbDecoderStats,
  AdsbReceiverInfo,
} from "@/lib/types";

type Dump1090AircraftEntry = {
  hex?: string;
  flight?: string;
  type?: string;
  category?: string;
  squawk?: string;
  emergency?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | "ground";
  alt_geom?: number;
  gs?: number;
  track?: number;
  baro_rate?: number;
  geom_rate?: number;
  messages?: number;
  seen?: number;
  seen_pos?: number;
  rssi?: number;
};

type Dump1090AircraftJson = {
  now?: number;
  aircraft?: Dump1090AircraftEntry[];
};

type Dump1090ReceiverJson = {
  version?: string;
  refresh?: number;
  lat?: number;
  lon?: number;
};

type Dump1090StatsPeriod = {
  messages?: number;
  local?: {
    samples_processed?: number;
    samples_dropped?: number;
    modes?: number;
    bad?: number;
    signal?: number;
    noise?: number;
    peak_signal?: number;
    gain_db?: number;
    strong_signals?: number;
  };
};

type Dump1090StatsJson = {
  latest?: Dump1090StatsPeriod;
};

function parseJson<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function normalizeTimestampSeconds(value: number | undefined): string | null {
  const timestamp = value;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp * 1000).toISOString();
}

function timestampSecondsAgo(nowSeconds: number, agoSeconds: number | undefined): string | null {
  const now = nowSeconds;
  const ago = agoSeconds;
  if (
    typeof now !== "number" ||
    !Number.isFinite(now) ||
    typeof ago !== "number" ||
    !Number.isFinite(ago)
  ) {
    return null;
  }

  return new Date((now - ago) * 1000).toISOString();
}

function normalizeText(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSourceLabel(value: string | undefined): string {
  const raw = normalizeText(value);
  if (!raw) {
    return "ADS-B";
  }

  return raw.replace(/_/g, " ").toUpperCase();
}

export function parseDump1090ReceiverInfo(content: string): AdsbReceiverInfo | null {
  const parsed = parseJson<Dump1090ReceiverJson>(content);
  if (!parsed) {
    return null;
  }

  return {
    latitude: Number.isFinite(parsed.lat) ? parsed.lat! : null,
    longitude: Number.isFinite(parsed.lon) ? parsed.lon! : null,
    refreshMs: Number.isFinite(parsed.refresh) ? parsed.refresh! : null,
    version: normalizeText(parsed.version),
  };
}

export function parseDump1090Stats(content: string): AdsbDecoderStats | null {
  const parsed = parseJson<Dump1090StatsJson>(content);
  const latest = parsed?.latest;
  const local = latest?.local;
  if (!latest || !local) {
    return null;
  }

  return {
    messages: Number.isFinite(latest.messages) ? latest.messages! : 0,
    modes: Number.isFinite(local.modes) ? local.modes! : 0,
    bad: Number.isFinite(local.bad) ? local.bad! : 0,
    signalDbfs: Number.isFinite(local.signal) ? local.signal! : null,
    noiseDbfs: Number.isFinite(local.noise) ? local.noise! : null,
    peakSignalDbfs: Number.isFinite(local.peak_signal) ? local.peak_signal! : null,
    gainDb: Number.isFinite(local.gain_db) ? local.gain_db! : null,
    strongSignals: Number.isFinite(local.strong_signals) ? local.strong_signals! : 0,
    samplesProcessed: Number.isFinite(local.samples_processed) ? local.samples_processed! : 0,
    samplesDropped: Number.isFinite(local.samples_dropped) ? local.samples_dropped! : 0,
  };
}

export function parseDump1090Aircraft(content: string): {
  generatedAt: string | null;
  aircraft: AdsbAircraftContact[];
} | null {
  const parsed = parseJson<Dump1090AircraftJson>(content);
  const nowSeconds = parsed?.now;
  const rawAircraft = Array.isArray(parsed?.aircraft) ? parsed.aircraft : null;
  if (!rawAircraft || typeof nowSeconds !== "number" || !Number.isFinite(nowSeconds)) {
    return null;
  }

  const generatedAt = normalizeTimestampSeconds(nowSeconds);
  const aircraft = rawAircraft
    .map<AdsbAircraftContact | null>((entry) => {
      const hex = normalizeText(entry.hex).toUpperCase();
      if (!hex) {
        return null;
      }

      const altitudeFeet =
        entry.alt_baro === "ground"
          ? 0
          : Number.isFinite(entry.alt_baro)
            ? entry.alt_baro!
            : Number.isFinite(entry.alt_geom)
              ? entry.alt_geom!
              : null;

      return {
        hex,
        flight: normalizeText(entry.flight),
        type: normalizeText(entry.type),
        category: normalizeText(entry.category),
        squawk: normalizeText(entry.squawk),
        emergency: normalizeText(entry.emergency),
        latitude: Number.isFinite(entry.lat) ? entry.lat! : null,
        longitude: Number.isFinite(entry.lon) ? entry.lon! : null,
        altitudeFeet,
        groundSpeedKnots: Number.isFinite(entry.gs) ? entry.gs! : null,
        trackDeg: Number.isFinite(entry.track) ? entry.track! : null,
        verticalRateFpm: Number.isFinite(entry.baro_rate)
          ? entry.baro_rate!
          : Number.isFinite(entry.geom_rate)
            ? entry.geom_rate!
            : null,
        onGround: entry.alt_baro === "ground",
        messageCount: Number.isFinite(entry.messages) ? entry.messages! : 0,
        rssi: Number.isFinite(entry.rssi) ? entry.rssi! : null,
        seenAt: timestampSecondsAgo(nowSeconds, entry.seen) ?? new Date().toISOString(),
        seenPosAt: timestampSecondsAgo(nowSeconds, entry.seen_pos),
        sourceLabel: normalizeSourceLabel(entry.type),
      };
    })
    .filter((entry): entry is AdsbAircraftContact => Boolean(entry))
    .sort((left, right) => Date.parse(right.seenAt) - Date.parse(left.seenAt));

  return {
    generatedAt,
    aircraft,
  };
}
