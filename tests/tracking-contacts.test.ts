import assert from "node:assert/strict";
import test from "node:test";

import {
  filterAdsbContacts,
  filterAisContacts,
  type AdsbContactFilters,
  type AisContactFilters,
} from "@/lib/tracking-contacts";
import type { AdsbAircraftContact, AisVesselContact } from "@/lib/types";

function vessel(overrides: Partial<AisVesselContact> = {}): AisVesselContact {
  return {
    mmsi: "111000111",
    name: "Northern Light",
    callsign: "ECHO1",
    imo: "",
    shipType: "Cargo",
    destination: "Bilbao",
    latitude: 43.3,
    longitude: -2.9,
    speedKnots: 12,
    courseDeg: 90,
    headingDeg: 90,
    navStatus: "Under way",
    lastSeenAt: "2026-08-11T10:00:00.000Z",
    lastPositionAt: "2026-08-11T10:00:00.000Z",
    lastStaticAt: null,
    messageType: "1",
    sourceLabel: "AIS",
    isMoving: true,
    ...overrides,
  };
}

function aircraft(overrides: Partial<AdsbAircraftContact> = {}): AdsbAircraftContact {
  return {
    hex: "abc123",
    flight: "IBE123",
    type: "A320",
    category: "A3",
    squawk: "7000",
    emergency: "",
    latitude: 43.2,
    longitude: -2.8,
    altitudeFeet: 18000,
    groundSpeedKnots: 320,
    trackDeg: 120,
    verticalRateFpm: 0,
    onGround: false,
    messageCount: 20,
    rssi: -18,
    seenAt: "2026-08-11T10:00:00.000Z",
    seenPosAt: "2026-08-11T10:00:00.000Z",
    sourceLabel: "dump1090",
    ...overrides,
  };
}

const aisDefaults: AisContactFilters = {
  query: "",
  scope: "all",
  motion: "all",
  sort: "recent",
};

const adsbDefaults: AdsbContactFilters = {
  query: "",
  scope: "all",
  state: "all",
  positionedOnly: false,
  sort: "recent",
};

test("AIS contacts can be searched across identity and destination", () => {
  const contacts = [vessel(), vessel({ mmsi: "222000222", name: "Harbour Star", callsign: "PORT2", destination: "Santander" })];
  assert.deepEqual(filterAisContacts(contacts, new Set(contacts.map((item) => item.mmsi)), { ...aisDefaults, query: "santander" }).map((item) => item.mmsi), ["222000222"]);
  assert.deepEqual(filterAisContacts(contacts, new Set(), { ...aisDefaults, query: "echo1" }).map((item) => item.mmsi), ["111000111"]);
});

test("AIS contacts support live/history scope, motion filters and speed sorting", () => {
  const contacts = [
    vessel({ mmsi: "live-fast", speedKnots: 18, isMoving: true }),
    vessel({ mmsi: "live-still", speedKnots: 0, isMoving: false }),
    vessel({ mmsi: "history", speedKnots: 8, isMoving: true }),
  ];
  const live = new Set(["live-fast", "live-still"]);
  assert.deepEqual(filterAisContacts(contacts, live, { ...aisDefaults, scope: "live", motion: "moving", sort: "speed" }).map((item) => item.mmsi), ["live-fast"]);
  assert.deepEqual(filterAisContacts(contacts, live, { ...aisDefaults, scope: "history" }).map((item) => item.mmsi), ["history"]);
});

test("ADS-B contacts support search, scope, operational state and positioned-only filtering", () => {
  const contacts = [
    aircraft({ hex: "live-air", flight: "IBE100", type: "A320" }),
    aircraft({ hex: "live-ground", flight: "VLG200", type: "B738", onGround: true, altitudeFeet: 0 }),
    aircraft({ hex: "live-emergency", flight: "RYR300", type: "B738", emergency: "general" }),
    aircraft({ hex: "history", flight: "BAW400", type: "B777", latitude: null, longitude: null, seenPosAt: null }),
  ];
  const live = new Set(["live-air", "live-ground", "live-emergency"]);
  assert.deepEqual(filterAdsbContacts(contacts, live, { ...adsbDefaults, query: "a320" }).map((item) => item.hex), ["live-air"]);
  assert.deepEqual(filterAdsbContacts(contacts, live, { ...adsbDefaults, state: "emergency" }).map((item) => item.hex), ["live-emergency"]);
  assert.deepEqual(filterAdsbContacts(contacts, live, { ...adsbDefaults, scope: "history", positionedOnly: true }).map((item) => item.hex), []);
});

test("ADS-B altitude sorting keeps unknown altitude at the end", () => {
  const contacts = [
    aircraft({ hex: "low", altitudeFeet: 3000 }),
    aircraft({ hex: "unknown", altitudeFeet: null }),
    aircraft({ hex: "high", altitudeFeet: 30000 }),
  ];
  assert.deepEqual(filterAdsbContacts(contacts, new Set(), { ...adsbDefaults, sort: "altitude" }).map((item) => item.hex), ["high", "low", "unknown"]);
});
