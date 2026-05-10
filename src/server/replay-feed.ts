import type {
  AdsbAircraftContact,
  AdsbDecoderStats,
  AdsbFeedSnapshot,
  AdsbReceiverInfo,
  AdsbRuntimeStatus,
  AdsbTrackHistoryResponse,
  AdsbTrackPoint,
  AisChannelStatus,
  AisFeedSnapshot,
  AisRuntimeStatus,
  AisTrackHistoryResponse,
  AisTrackPoint,
  AisVesselContact,
  GeoBounds,
  GeoPoint,
  SpectrumFrame,
} from "@/lib/types";
import { buildOfflineMapSummary } from "@/server/maps";

const AIS_CENTER_FREQ_HZ = 162_000_000;
const AIS_SAMPLE_RATE = 1_536_000;
const ADSB_CENTER_FREQ_HZ = 1_090_000_000;
const ADSB_SAMPLE_RATE = 2_400_000;
const REPLAY_RECEIVER: GeoPoint = { latitude: 43.263, longitude: -2.935 };

type ReplayEnv = Record<string, string | undefined>;

type ReplayAisVesselFixture = {
  mmsi: string;
  name: string;
  callsign: string;
  imo: string;
  shipType: string;
  destination: string;
  navStatus: string;
  messageType: string;
  channelId: "ais-a" | "ais-b";
  sourceLabel: string;
  speedKnots: number | null;
  courseDeg: number | null;
  headingDeg: number | null;
  path: Array<{ minutesAgo: number; latitude: number; longitude: number }>;
};

type ReplayAdsbAircraftFixture = {
  hex: string;
  flight: string;
  type: string;
  category: string;
  squawk: string;
  emergency: string;
  altitudeFeet: number | null;
  groundSpeedKnots: number | null;
  trackDeg: number | null;
  verticalRateFpm: number | null;
  onGround: boolean;
  rssi: number | null;
  path: Array<{ secondsAgo: number; latitude: number; longitude: number }>;
};

const AIS_FIXTURES: ReplayAisVesselFixture[] = [
  {
    mmsi: "224123450",
    name: "BILBAO EXPRESS",
    callsign: "EABC",
    imo: "9876543",
    shipType: "Cargo",
    destination: "Bilbao",
    navStatus: "Under way using engine",
    messageType: "Position report",
    channelId: "ais-a",
    sourceLabel: "Replay AIS A",
    speedKnots: 12.4,
    courseDeg: 126,
    headingDeg: 128,
    path: [
      { minutesAgo: 8, latitude: 43.3719, longitude: -3.0934 },
      { minutesAgo: 5, latitude: 43.3597, longitude: -3.0632 },
      { minutesAgo: 2, latitude: 43.3471, longitude: -3.0315 },
    ],
  },
  {
    mmsi: "224987650",
    name: "GETXO PILOT",
    callsign: "EATP",
    imo: "",
    shipType: "Pilot vessel",
    destination: "Port service",
    navStatus: "Restricted manoeuverability",
    messageType: "Class B position report",
    channelId: "ais-b",
    sourceLabel: "Replay AIS B",
    speedKnots: 5.8,
    courseDeg: 88,
    headingDeg: 91,
    path: [
      { minutesAgo: 9, latitude: 43.3381, longitude: -3.0335 },
      { minutesAgo: 4, latitude: 43.3397, longitude: -3.0033 },
      { minutesAgo: 1, latitude: 43.3402, longitude: -2.9812 },
    ],
  },
  {
    mmsi: "224555120",
    name: "SANTURTZI TUG",
    callsign: "EAST",
    imo: "",
    shipType: "Tug",
    destination: "Santurtzi",
    navStatus: "Moored",
    messageType: "Static and voyage data",
    channelId: "ais-a",
    sourceLabel: "Replay AIS A",
    speedKnots: 0,
    courseDeg: null,
    headingDeg: 212,
    path: [
      { minutesAgo: 12, latitude: 43.3332, longitude: -3.0442 },
      { minutesAgo: 6, latitude: 43.3332, longitude: -3.0442 },
      { minutesAgo: 2, latitude: 43.3332, longitude: -3.0442 },
    ],
  },
];

const ADSB_FIXTURES: ReplayAdsbAircraftFixture[] = [
  {
    hex: "3444D1",
    flight: "IBE042L",
    type: "A320",
    category: "A3",
    squawk: "2264",
    emergency: "",
    altitudeFeet: 13250,
    groundSpeedKnots: 318,
    trackDeg: 96,
    verticalRateFpm: -640,
    onGround: false,
    rssi: -18.7,
    path: [
      { secondsAgo: 55, latitude: 43.3651, longitude: -3.0632 },
      { secondsAgo: 31, latitude: 43.3528, longitude: -2.9914 },
      { secondsAgo: 8, latitude: 43.3364, longitude: -2.9198 },
    ],
  },
  {
    hex: "3451A8",
    flight: "VLG8752",
    type: "A21N",
    category: "A3",
    squawk: "5432",
    emergency: "",
    altitudeFeet: 24100,
    groundSpeedKnots: 426,
    trackDeg: 285,
    verticalRateFpm: 960,
    onGround: false,
    rssi: -21.3,
    path: [
      { secondsAgo: 70, latitude: 43.2199, longitude: -2.7241 },
      { secondsAgo: 36, latitude: 43.2572, longitude: -2.8425 },
      { secondsAgo: 12, latitude: 43.2894, longitude: -2.9561 },
    ],
  },
  {
    hex: "344109",
    flight: "EIN73K",
    type: "B738",
    category: "A3",
    squawk: "1000",
    emergency: "",
    altitudeFeet: 0,
    groundSpeedKnots: 18,
    trackDeg: 304,
    verticalRateFpm: 0,
    onGround: true,
    rssi: -13.5,
    path: [
      { secondsAgo: 66, latitude: 43.3037, longitude: -2.9135 },
      { secondsAgo: 34, latitude: 43.3041, longitude: -2.9119 },
      { secondsAgo: 10, latitude: 43.3044, longitude: -2.9107 },
    ],
  },
];

function isoAtOffset(now: Date, offsetMs: number): string {
  return new Date(now.getTime() - offsetMs).toISOString();
}

function boundedLimit(limit: number): number {
  return Math.max(1, Math.min(Number.isFinite(limit) ? Math.trunc(limit) : 2000, 10_000));
}

function computeBounds(points: Array<{ latitude: number; longitude: number }>): GeoBounds | null {
  if (points.length === 0) {
    return null;
  }

  let west = points[0].longitude;
  let east = points[0].longitude;
  let south = points[0].latitude;
  let north = points[0].latitude;
  for (const point of points) {
    west = Math.min(west, point.longitude);
    east = Math.max(east, point.longitude);
    south = Math.min(south, point.latitude);
    north = Math.max(north, point.latitude);
  }
  return { west, south, east, north };
}

function boundsCenter(bounds: GeoBounds | null): GeoPoint | null {
  if (!bounds) {
    return null;
  }
  return {
    latitude: (bounds.south + bounds.north) / 2,
    longitude: (bounds.west + bounds.east) / 2,
  };
}

function latestPoint<TPoint extends { minutesAgo?: number; secondsAgo?: number }>(
  points: TPoint[],
): TPoint {
  return points.reduce((latest, point) => {
    const latestAge = latest.minutesAgo ?? latest.secondsAgo ?? Number.POSITIVE_INFINITY;
    const pointAge = point.minutesAgo ?? point.secondsAgo ?? Number.POSITIVE_INFINITY;
    return pointAge < latestAge ? point : latest;
  });
}

function buildAisStatus(now: Date): AisRuntimeStatus {
  const generatedAt = now.toISOString();
  return {
    state: "running",
    message: "AIS replay feed is serving deterministic vessel fixtures.",
    binaryAvailable: true,
    binaryPath: "replay://ais",
    startedAt: generatedAt,
    lastFrameAt: generatedAt,
    centerFreqHz: AIS_CENTER_FREQ_HZ,
    sampleRate: AIS_SAMPLE_RATE,
  };
}

function buildAdsbStatus(now: Date): AdsbRuntimeStatus {
  const generatedAt = now.toISOString();
  return {
    state: "running",
    message: "ADS-B replay feed is serving deterministic aircraft fixtures.",
    binaryAvailable: true,
    binaryPath: "replay://adsb",
    startedAt: generatedAt,
    lastJsonAt: generatedAt,
    centerFreqHz: ADSB_CENTER_FREQ_HZ,
    sampleRate: ADSB_SAMPLE_RATE,
    jsonDir: "replay://adsb-json",
    receiverLatitude: REPLAY_RECEIVER.latitude,
    receiverLongitude: REPLAY_RECEIVER.longitude,
  };
}

function buildAisContact(fixture: ReplayAisVesselFixture, now: Date): AisVesselContact {
  const latest = latestPoint(fixture.path);
  const lastSeenAt = isoAtOffset(now, (latest.minutesAgo * 60 - 3) * 1000);
  const lastPositionAt = isoAtOffset(now, latest.minutesAgo * 60 * 1000);
  const lastStaticAt = isoAtOffset(now, Math.max(latest.minutesAgo + 5, 5) * 60 * 1000);
  return {
    mmsi: fixture.mmsi,
    name: fixture.name,
    callsign: fixture.callsign,
    imo: fixture.imo,
    shipType: fixture.shipType,
    destination: fixture.destination,
    latitude: latest.latitude,
    longitude: latest.longitude,
    speedKnots: fixture.speedKnots,
    courseDeg: fixture.courseDeg,
    headingDeg: fixture.headingDeg,
    navStatus: fixture.navStatus,
    lastSeenAt,
    lastPositionAt,
    lastStaticAt,
    messageType: fixture.messageType,
    sourceLabel: fixture.sourceLabel,
    isMoving: (fixture.speedKnots ?? 0) > 0.5,
  };
}

function buildAdsbContact(fixture: ReplayAdsbAircraftFixture, now: Date): AdsbAircraftContact {
  const latest = latestPoint(fixture.path);
  const seenAt = isoAtOffset(now, Math.max(latest.secondsAgo - 2, 0) * 1000);
  const seenPosAt = isoAtOffset(now, latest.secondsAgo * 1000);
  return {
    hex: fixture.hex,
    flight: fixture.flight,
    type: fixture.type,
    category: fixture.category,
    squawk: fixture.squawk,
    emergency: fixture.emergency,
    latitude: latest.latitude,
    longitude: latest.longitude,
    altitudeFeet: fixture.altitudeFeet,
    groundSpeedKnots: fixture.groundSpeedKnots,
    trackDeg: fixture.trackDeg,
    verticalRateFpm: fixture.verticalRateFpm,
    onGround: fixture.onGround,
    messageCount: 80 + fixture.path.length * 12,
    rssi: fixture.rssi,
    seenAt,
    seenPosAt,
    sourceLabel: "Replay ADS-B",
  };
}

function buildAisChannels(now: Date): AisChannelStatus[] {
  return [
    {
      id: "ais-a",
      label: "AIS A",
      freqHz: 161_975_000,
      frameCount: 96,
      messageCount: AIS_FIXTURES.filter((fixture) => fixture.channelId === "ais-a").length * 12,
      lastSeenAt: isoAtOffset(now, 2_000),
      lastMessageType: "Position report",
      lastPhase: 0.36,
    },
    {
      id: "ais-b",
      label: "AIS B",
      freqHz: 162_025_000,
      frameCount: 84,
      messageCount: AIS_FIXTURES.filter((fixture) => fixture.channelId === "ais-b").length * 12,
      lastSeenAt: isoAtOffset(now, 3_000),
      lastMessageType: "Class B position report",
      lastPhase: -0.18,
    },
  ];
}

function buildAdsbStats(): AdsbDecoderStats {
  return {
    messages: 1842,
    modes: 1799,
    bad: 3,
    signalDbfs: -18.9,
    noiseDbfs: -42.7,
    peakSignalDbfs: -12.5,
    gainDb: 32,
    strongSignals: 2,
    samplesProcessed: 4_800_000,
    samplesDropped: 0,
  };
}

function buildAisSpectrumFrame(now: Date): SpectrumFrame {
  const bins = Array.from({ length: 96 }, (_, index) => {
    const distanceA = Math.abs(index - 37);
    const distanceB = Math.abs(index - 59);
    const signalA = Math.max(0, 1 - distanceA / 12) * 0.62;
    const signalB = Math.max(0, 1 - distanceB / 10) * 0.48;
    const noise = 0.11 + 0.04 * Math.sin(index * 0.47 + now.getTime() / 10_000);
    return Number(Math.min(1, noise + signalA + signalB).toFixed(4));
  });
  let peakIndex = 0;
  for (let index = 1; index < bins.length; index += 1) {
    if (bins[index] > bins[peakIndex]) {
      peakIndex = index;
    }
  }
  return {
    bins,
    centerFreqHz: AIS_CENTER_FREQ_HZ,
    spanHz: AIS_SAMPLE_RATE,
    peakIndex,
    updatedAt: now.toISOString(),
  };
}

export function isReplayModeEnabled(env: ReplayEnv = process.env): boolean {
  const raw = env.HACKRF_WEBUI_REPLAY?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "y" || raw === "on";
}

export function buildReplayAisSnapshot(now = new Date()): AisFeedSnapshot {
  const warnings = ["Using replay AIS fixture data; no live SDR receiver is required."];
  const maps = buildOfflineMapSummary(warnings);
  const vessels = AIS_FIXTURES.map((fixture) => buildAisContact(fixture, now))
    .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt));
  const bounds = computeBounds(vessels);
  const latestPositionAt = vessels.reduce<string | null>((latest, vessel) => {
    if (!latest) {
      return vessel.lastPositionAt;
    }
    return Date.parse(vessel.lastPositionAt) > Date.parse(latest) ? vessel.lastPositionAt : latest;
  }, null);

  return {
    generatedAt: now.toISOString(),
    vesselCount: vessels.length,
    movingCount: vessels.filter((vessel) => vessel.isMoving).length,
    latestPositionAt,
    center: boundsCenter(bounds),
    bounds,
    vessels,
    recentVessels: vessels,
    channels: buildAisChannels(now),
    warnings,
    maps,
    runtime: buildAisStatus(now),
  };
}

export function buildReplayAdsbSnapshot(now = new Date()): AdsbFeedSnapshot {
  const warnings = ["Using replay ADS-B fixture data; no live SDR receiver is required."];
  const maps = buildOfflineMapSummary(warnings);
  const aircraft = ADSB_FIXTURES.map((fixture) => buildAdsbContact(fixture, now))
    .sort((left, right) => Date.parse(right.seenAt) - Date.parse(left.seenAt));
  const bounds = computeBounds(
    aircraft.filter(
      (entry): entry is AdsbAircraftContact & { latitude: number; longitude: number } =>
        entry.latitude !== null && entry.longitude !== null,
    ),
  );
  const latestMessageAt = aircraft.reduce<string | null>((latest, entry) => {
    if (!latest) {
      return entry.seenAt;
    }
    return Date.parse(entry.seenAt) > Date.parse(latest) ? entry.seenAt : latest;
  }, null);
  const receiver: AdsbReceiverInfo = {
    latitude: REPLAY_RECEIVER.latitude,
    longitude: REPLAY_RECEIVER.longitude,
    refreshMs: 1000,
    version: "hackrf-webui replay",
  };

  return {
    generatedAt: now.toISOString(),
    aircraftCount: aircraft.length,
    positionCount: aircraft.filter((entry) => entry.latitude !== null && entry.longitude !== null).length,
    airborneCount: aircraft.filter((entry) => !entry.onGround).length,
    latestMessageAt,
    center: boundsCenter(bounds),
    bounds,
    aircraft,
    recentAircraft: aircraft,
    warnings,
    maps,
    runtime: buildAdsbStatus(now),
    receiver,
    stats: buildAdsbStats(),
  };
}

export function getReplayAisHistory(
  mmsi: string,
  limit = 2000,
  now = new Date(),
): AisTrackHistoryResponse {
  const safeMmsi = mmsi.trim();
  const fixture = AIS_FIXTURES.find((entry) => entry.mmsi === safeMmsi);
  if (!fixture) {
    return {
      mmsi: safeMmsi,
      pointCount: 0,
      firstPositionAt: null,
      lastPositionAt: null,
      points: [],
    };
  }

  const points = fixture.path
    .slice(-boundedLimit(limit))
    .sort((left, right) => right.minutesAgo - left.minutesAgo)
    .map<AisTrackPoint>((point, index) => {
      const lastPositionAt = isoAtOffset(now, point.minutesAgo * 60 * 1000);
      const lastSeenAt = isoAtOffset(now, (point.minutesAgo * 60 - 3) * 1000);
      return {
        id: `replay-ais-${fixture.mmsi}-${index}`,
        observationKey: `replay-ais-${fixture.mmsi}-${lastPositionAt}`,
        mmsi: fixture.mmsi,
        name: fixture.name,
        callsign: fixture.callsign,
        imo: fixture.imo,
        shipType: fixture.shipType,
        destination: fixture.destination,
        navStatus: fixture.navStatus,
        messageType: fixture.messageType,
        messageTypeCode: null,
        sourceLabel: fixture.sourceLabel,
        channelId: fixture.channelId,
        phase: fixture.channelId === "ais-a" ? 0.36 : -0.18,
        latitude: point.latitude,
        longitude: point.longitude,
        speedKnots: fixture.speedKnots,
        courseDeg: fixture.courseDeg,
        headingDeg: fixture.headingDeg,
        isMoving: (fixture.speedKnots ?? 0) > 0.5,
        lastSeenAt,
        lastPositionAt,
        lastStaticAt: isoAtOffset(now, Math.max(point.minutesAgo + 5, 5) * 60 * 1000),
        metadata: { replay: true },
      };
    });

  return {
    mmsi: fixture.mmsi,
    pointCount: points.length,
    firstPositionAt: points[0]?.lastPositionAt ?? null,
    lastPositionAt: points.at(-1)?.lastPositionAt ?? null,
    points,
  };
}

export function getReplayAdsbHistory(
  hex: string,
  limit = 2000,
  now = new Date(),
): AdsbTrackHistoryResponse {
  const safeHex = hex.trim().toUpperCase();
  const fixture = ADSB_FIXTURES.find((entry) => entry.hex === safeHex);
  if (!fixture) {
    return {
      hex: safeHex,
      pointCount: 0,
      firstSeenAt: null,
      lastSeenAt: null,
      points: [],
    };
  }

  const points = fixture.path
    .slice(-boundedLimit(limit))
    .sort((left, right) => right.secondsAgo - left.secondsAgo)
    .map<AdsbTrackPoint>((point, index) => {
      const seenAt = isoAtOffset(now, Math.max(point.secondsAgo - 2, 0) * 1000);
      const seenPosAt = isoAtOffset(now, point.secondsAgo * 1000);
      return {
        id: `replay-adsb-${fixture.hex}-${index}`,
        observationKey: `replay-adsb-${fixture.hex}-${seenPosAt}`,
        hex: fixture.hex,
        flight: fixture.flight,
        type: fixture.type,
        category: fixture.category,
        squawk: fixture.squawk,
        emergency: fixture.emergency,
        sourceLabel: "Replay ADS-B",
        latitude: point.latitude,
        longitude: point.longitude,
        altitudeFeet: fixture.altitudeFeet,
        groundSpeedKnots: fixture.groundSpeedKnots,
        trackDeg: fixture.trackDeg,
        verticalRateFpm: fixture.verticalRateFpm,
        onGround: fixture.onGround,
        messageCount: 80 + index,
        rssi: fixture.rssi,
        seenAt,
        seenPosAt,
        generatedAt: now.toISOString(),
        receiverLatitude: REPLAY_RECEIVER.latitude,
        receiverLongitude: REPLAY_RECEIVER.longitude,
        metadata: { replay: true },
      };
    });

  return {
    hex: fixture.hex,
    pointCount: points.length,
    firstSeenAt: points[0]?.seenAt ?? null,
    lastSeenAt: points.at(-1)?.seenAt ?? null,
    points,
  };
}

class ReplayAisService {
  async start(): Promise<AisRuntimeStatus> {
    return this.getStatus();
  }

  async stop(): Promise<AisRuntimeStatus> {
    return this.getStatus();
  }

  getStatus(): AisRuntimeStatus {
    return buildReplayAisSnapshot().runtime;
  }

  getSpectrumFrame(): SpectrumFrame | null {
    return buildAisSpectrumFrame(new Date());
  }

  getSnapshot(): AisFeedSnapshot {
    return buildReplayAisSnapshot();
  }
}

class ReplayAdsbService {
  async start(): Promise<AdsbRuntimeStatus> {
    return this.getStatus();
  }

  async stop(): Promise<AdsbRuntimeStatus> {
    return this.getStatus();
  }

  getStatus(): AdsbRuntimeStatus {
    return buildReplayAdsbSnapshot().runtime;
  }

  getSnapshot(): AdsbFeedSnapshot {
    return buildReplayAdsbSnapshot();
  }
}

export const replayAisService = new ReplayAisService();
export const replayAdsbService = new ReplayAdsbService();
