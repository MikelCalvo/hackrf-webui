import assert from "node:assert/strict";
import test from "node:test";

import type { CreateRadioSessionRequest } from "@/lib/radio-session";
import { validateCreateRadioSessionRequest } from "@/server/radio/validation";

const channel = {
  id: "morse:ncdxf-14100",
  bandId: "morse-catalog",
  number: 1,
  freqMhz: 14.1,
  label: "NCDXF/IARU beacon 14.100 MHz",
  notes: "expectedIdentifier=4U1UN",
};

const controls = { lna: 16, vga: 24, audioGain: 1 };

test("validates an explicit CW MORSE scan session without acquiring hardware", () => {
  const result = validateCreateRadioSessionRequest({
    kind: "morse",
    module: "morse",
    mode: "scan",
    frontEnd: "cw_carrier",
    controls,
    bandId: "morse-recommended",
    channels: [channel],
    scanMode: "sequential",
    squelch: 0.006,
    dwellTime: 5,
    holdTime: 4,
    location: null,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.kind, "morse");
  assert.equal(result.value.module, "morse");
  assert.equal(result.value.frontEnd, "cw_carrier");
});

test("validates an AM-tone navigation identifier session", () => {
  const result = validateCreateRadioSessionRequest({
    kind: "morse",
    module: "morse",
    mode: "manual",
    frontEnd: "am_tone",
    controls,
    bandId: "morse-navigation",
    channels: [{ ...channel, id: "morse:mad", freqMhz: 113.95, label: "MAD VOR/DME" }],
    manualChannelId: "morse:mad",
    squelch: 0.006,
    dwellTime: 5,
    holdTime: 4,
    location: null,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.kind, "morse");
  if (result.value.kind !== "morse") return;
  assert.equal(result.value.frontEnd, "am_tone");
});

test("rejects MORSE frequencies outside HackRF One range and invalid front ends", () => {
  const lowFrequency = validateCreateRadioSessionRequest({
    kind: "morse",
    module: "morse",
    mode: "manual",
    frontEnd: "cw_carrier",
    controls,
    bandId: "morse-manual",
    channels: [{ ...channel, id: "morse:ndb", freqMhz: 0.384 }],
    manualChannelId: "morse:ndb",
    squelch: 0.006,
    dwellTime: 5,
    holdTime: 4,
  });
  assert.equal(lowFrequency.ok, false);
  if (!lowFrequency.ok) assert.match(lowFrequency.message, /between 1 and 6000|HackRF/i);

  const badFrontEnd = validateCreateRadioSessionRequest({
    kind: "morse",
    module: "morse",
    mode: "manual",
    frontEnd: "speech",
    controls,
    bandId: "morse-manual",
    channels: [channel],
    manualChannelId: channel.id,
    squelch: 0.006,
    dwellTime: 5,
    holdTime: 4,
  });
  assert.equal(badFrontEnd.ok, false);
  if (!badFrontEnd.ok) assert.match(badFrontEnd.message, /front.?end/i);
});

test("the public create request union includes a typed MORSE request", () => {
  const request: CreateRadioSessionRequest = {
    kind: "morse",
    module: "morse",
    mode: "manual",
    frontEnd: "cw_carrier",
    controls,
    bandId: "morse-manual",
    channels: [channel],
    manualChannelId: channel.id,
    squelch: 0.006,
    dwellTime: 5,
    holdTime: 4,
    location: null,
  };

  assert.equal(request.kind, "morse");
});

test("validates catalog identifier and provenance metadata for MORSE channels", () => {
  const result = validateCreateRadioSessionRequest({
    kind: "morse",
    module: "morse",
    mode: "manual",
    frontEnd: "am_tone",
    controls,
    bandId: "morse-navigation",
    channels: [{ ...channel, expectedIdentifier: "bcn", catalogSource: "OurAirports", catalogRecordId: "123", catalogVersion: "2026-08-11" }],
    manualChannelId: channel.id,
    squelch: 0.006,
    dwellTime: 5,
    holdTime: 4,
  });
  assert.equal(result.ok, true);
  if (result.ok && result.value.kind === "morse") {
    assert.equal(result.value.channels[0].expectedIdentifier, "BCN");
    assert.equal(result.value.channels[0].catalogRecordId, "123");
  }
});
