import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveNarrowbandScannerState,
  formatRadioSessionAudioUrl,
  toRadioSessionChannels,
  uniqueChannelsByFrequency,
  uniqueChannelsByLabelFrequency,
} from "@/lib/narrowband";

const channels = [
  { id: "b", bandId: "saved", number: 9, freqMhz: 121.5, label: "Guard", notes: "second" },
  { id: "a", bandId: "guard", number: 4, freqMhz: 121.5, label: "Guard", notes: "first" },
  { id: "c", bandId: "common", number: 3, freqMhz: 122.75, label: "Advisory" },
];

test("deriveNarrowbandScannerState collapses radio session state into UI scanner state", () => {
  assert.equal(deriveNarrowbandScannerState("manual", "locked"), "idle");
  assert.equal(deriveNarrowbandScannerState("scan", "stopping"), "idle");
  assert.equal(deriveNarrowbandScannerState("scan", "locked"), "locked");
  assert.equal(deriveNarrowbandScannerState("scan", "monitoring"), "scanning");
});

test("formatRadioSessionAudioUrl builds the protected session audio endpoint", () => {
  assert.equal(
    formatRadioSessionAudioUrl("session/with space"),
    "/api/radio/sessions/session%2Fwith%20space/audio",
  );
});

test("toRadioSessionChannels strips local-only channel fields", () => {
  const result = toRadioSessionChannels([
    { ...channels[0], removable: true, countryIds: ["spain"] },
  ]);

  assert.deepEqual(result, [
    { id: "b", bandId: "saved", number: 9, freqMhz: 121.5, label: "Guard", notes: "second" },
  ]);
});

test("uniqueChannelsByLabelFrequency deduplicates, sorts, and renumbers display channels", () => {
  const result = uniqueChannelsByLabelFrequency(channels);

  assert.deepEqual(result.map((channel) => channel.id), ["b", "c"]);
  assert.deepEqual(result.map((channel) => channel.number), [1, 2]);
});

test("uniqueChannelsByFrequency keeps the first channel per rounded frequency", () => {
  const result = uniqueChannelsByFrequency(channels);

  assert.deepEqual(result.map((channel) => channel.id), ["b", "c"]);
});
