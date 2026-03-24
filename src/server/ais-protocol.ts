type AisFrameEvent = {
  event: "frame";
  channel: string;
  phase: number;
  receivedAt: string;
  bitLength: number;
  payloadBits: string;
};

export type DecodedAisMessage = {
  receivedAt: string;
  channel: string;
  phase: number;
  messageType: number;
  messageTypeLabel: string;
  mmsi: string;
  latitude?: number | null;
  longitude?: number | null;
  speedKnots?: number | null;
  courseDeg?: number | null;
  headingDeg?: number | null;
  navStatus?: string;
  shipType?: string;
  name?: string;
  callsign?: string;
  destination?: string;
  imo?: string;
};

const NAV_STATUS_LABELS = [
  "Under way using engine",
  "At anchor",
  "Not under command",
  "Restricted manoeuverability",
  "Constrained by draught",
  "Moored",
  "Aground",
  "Engaged in fishing",
  "Under way sailing",
  "Reserved",
  "Reserved",
  "Power-driven vessel towing astern",
  "Power-driven vessel pushing ahead",
  "Reserved",
  "AIS-SART active",
  "Not defined",
];

const SHIP_TYPE_LABELS: Array<[number, string]> = [
  [30, "Fishing"],
  [31, "Towing"],
  [32, "Towing exceeds 200 m"],
  [33, "Dredging or underwater ops"],
  [34, "Diving ops"],
  [35, "Military ops"],
  [36, "Sailing"],
  [37, "Pleasure craft"],
  [40, "High-speed craft"],
  [50, "Pilot vessel"],
  [51, "Search and rescue"],
  [52, "Tug"],
  [53, "Port tender"],
  [54, "Anti-pollution"],
  [55, "Law enforcement"],
  [58, "Medical transport"],
  [60, "Passenger"],
  [70, "Cargo"],
  [80, "Tanker"],
];

function bitsToUnsigned(bits: string, start: number, length: number): number {
  let value = 0;

  for (let index = 0; index < length; index += 1) {
    value = (value * 2) + (bits[start + index] === "1" ? 1 : 0);
  }

  return value;
}

function bitsToSigned(bits: string, start: number, length: number): number {
  const unsigned = bitsToUnsigned(bits, start, length);
  const signBit = 1 << (length - 1);

  if ((unsigned & signBit) === 0) {
    return unsigned;
  }

  return unsigned - (2 ** length);
}

function decodeSixBitChar(value: number): string {
  const code = value < 32 ? value + 64 : value;
  return String.fromCharCode(code);
}

function decodeSixBitText(bits: string, start: number, charCount: number): string {
  let text = "";

  for (let index = 0; index < charCount; index += 1) {
    const value = bitsToUnsigned(bits, start + (index * 6), 6);
    text += decodeSixBitChar(value);
  }

  return text.replace(/@/g, " ").replace(/\s+/g, " ").trim();
}

function decodeLatitude(bits: string, start: number): number | null {
  const value = bitsToSigned(bits, start, 27) / 600000;
  return Math.abs(value) <= 90 ? value : null;
}

function decodeLongitude(bits: string, start: number): number | null {
  const value = bitsToSigned(bits, start, 28) / 600000;
  return Math.abs(value) <= 180 ? value : null;
}

function decodeSpeedTenths(raw: number): number | null {
  if (raw >= 1023) {
    return null;
  }

  return raw / 10;
}

function decodeCourseTenths(raw: number): number | null {
  if (raw >= 3600) {
    return null;
  }

  return raw / 10;
}

function decodeHeading(raw: number): number | null {
  if (raw >= 511) {
    return null;
  }

  return raw;
}

function decodeNavStatus(raw: number): string {
  return NAV_STATUS_LABELS[raw] ?? "";
}

function decodeShipType(raw: number): string {
  if (raw === 0) {
    return "";
  }

  for (const [prefix, label] of SHIP_TYPE_LABELS) {
    if (raw >= prefix && raw < prefix + 10) {
      return label;
    }
  }

  return `Type ${raw}`;
}

function parseFrameEvent(line: string): AisFrameEvent | null {
  try {
    const value = JSON.parse(line) as Partial<AisFrameEvent>;
    if (
      value.event !== "frame"
      || typeof value.channel !== "string"
      || typeof value.phase !== "number"
      || typeof value.receivedAt !== "string"
      || typeof value.bitLength !== "number"
      || typeof value.payloadBits !== "string"
    ) {
      return null;
    }

    return value as AisFrameEvent;
  } catch {
    return null;
  }
}

function parseClassAPosition(event: AisFrameEvent, messageType: number): DecodedAisMessage | null {
  const bits = event.payloadBits;
  const mmsi = bitsToUnsigned(bits, 8, 30);
  const latitude = decodeLatitude(bits, 89);
  const longitude = decodeLongitude(bits, 61);

  if (!mmsi || latitude === null || longitude === null) {
    return null;
  }

  return {
    receivedAt: event.receivedAt,
    channel: event.channel,
    phase: event.phase,
    messageType,
    messageTypeLabel: "Class A position",
    mmsi: String(mmsi),
    latitude,
    longitude,
    speedKnots: decodeSpeedTenths(bitsToUnsigned(bits, 50, 10)),
    courseDeg: decodeCourseTenths(bitsToUnsigned(bits, 116, 12)),
    headingDeg: decodeHeading(bitsToUnsigned(bits, 128, 9)),
    navStatus: decodeNavStatus(bitsToUnsigned(bits, 38, 4)),
  };
}

function parseClassBPosition(event: AisFrameEvent, messageType: number): DecodedAisMessage | null {
  const bits = event.payloadBits;
  const mmsi = bitsToUnsigned(bits, 8, 30);
  const latitude = decodeLatitude(bits, 85);
  const longitude = decodeLongitude(bits, 57);

  if (!mmsi || latitude === null || longitude === null) {
    return null;
  }

  return {
    receivedAt: event.receivedAt,
    channel: event.channel,
    phase: event.phase,
    messageType,
    messageTypeLabel: "Class B position",
    mmsi: String(mmsi),
    latitude,
    longitude,
    speedKnots: decodeSpeedTenths(bitsToUnsigned(bits, 46, 10)),
    courseDeg: decodeCourseTenths(bitsToUnsigned(bits, 112, 12)),
    headingDeg: decodeHeading(bitsToUnsigned(bits, 124, 9)),
  };
}

function parseClassBExtended(event: AisFrameEvent): DecodedAisMessage | null {
  const bits = event.payloadBits;
  const mmsi = bitsToUnsigned(bits, 8, 30);
  const latitude = decodeLatitude(bits, 85);
  const longitude = decodeLongitude(bits, 57);

  if (!mmsi || latitude === null || longitude === null) {
    return null;
  }

  return {
    receivedAt: event.receivedAt,
    channel: event.channel,
    phase: event.phase,
    messageType: 19,
    messageTypeLabel: "Class B extended position",
    mmsi: String(mmsi),
    latitude,
    longitude,
    speedKnots: decodeSpeedTenths(bitsToUnsigned(bits, 46, 10)),
    courseDeg: decodeCourseTenths(bitsToUnsigned(bits, 112, 12)),
    headingDeg: decodeHeading(bitsToUnsigned(bits, 124, 9)),
    name: decodeSixBitText(bits, 143, 20),
    shipType: decodeShipType(bitsToUnsigned(bits, 263, 8)),
  };
}

function parseStaticVoyage(event: AisFrameEvent): DecodedAisMessage | null {
  const bits = event.payloadBits;
  const mmsi = bitsToUnsigned(bits, 8, 30);

  if (!mmsi) {
    return null;
  }

  const imo = bitsToUnsigned(bits, 40, 30);

  return {
    receivedAt: event.receivedAt,
    channel: event.channel,
    phase: event.phase,
    messageType: 5,
    messageTypeLabel: "Static and voyage data",
    mmsi: String(mmsi),
    imo: imo > 0 ? String(imo) : "",
    callsign: decodeSixBitText(bits, 70, 7),
    name: decodeSixBitText(bits, 112, 20),
    shipType: decodeShipType(bitsToUnsigned(bits, 232, 8)),
    destination: decodeSixBitText(bits, 302, 20),
  };
}

function parseClassBStatic(event: AisFrameEvent): DecodedAisMessage | null {
  const bits = event.payloadBits;
  const mmsi = bitsToUnsigned(bits, 8, 30);
  const part = bitsToUnsigned(bits, 38, 2);

  if (!mmsi) {
    return null;
  }

  if (part === 0) {
    return {
      receivedAt: event.receivedAt,
      channel: event.channel,
      phase: event.phase,
      messageType: 24,
      messageTypeLabel: "Class B static data",
      mmsi: String(mmsi),
      name: decodeSixBitText(bits, 40, 20),
    };
  }

  if (part === 1) {
    return {
      receivedAt: event.receivedAt,
      channel: event.channel,
      phase: event.phase,
      messageType: 24,
      messageTypeLabel: "Class B static data",
      mmsi: String(mmsi),
      shipType: decodeShipType(bitsToUnsigned(bits, 40, 8)),
      callsign: decodeSixBitText(bits, 90, 7),
    };
  }

  return null;
}

export function parseAisFrameLine(line: string): DecodedAisMessage | null {
  const event = parseFrameEvent(line);

  if (!event || event.payloadBits.length !== event.bitLength) {
    return null;
  }

  if (event.bitLength < 38) {
    return null;
  }

  const messageType = bitsToUnsigned(event.payloadBits, 0, 6);
  switch (messageType) {
    case 1:
    case 2:
    case 3:
      if (event.bitLength < 168) {
        return null;
      }
      return parseClassAPosition(event, messageType);
    case 5:
      if (event.bitLength < 424) {
        return null;
      }
      return parseStaticVoyage(event);
    case 18:
      if (event.bitLength < 168) {
        return null;
      }
      return parseClassBPosition(event, 18);
    case 19:
      if (event.bitLength < 312) {
        return null;
      }
      return parseClassBExtended(event);
    case 24:
      if (event.bitLength < 160) {
        return null;
      }
      return parseClassBStatic(event);
    default:
      return null;
  }
}
