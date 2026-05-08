import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRadioRetuneUrl,
  buildRadioStreamUrl,
} from "@/components/radio-shared";

const channel = {
  id: "station-1",
  bandId: "catalog",
  number: 3,
  freqMhz: 99.9,
  label: "Station One",
};

const controls = { lna: 16, vga: 20, audioGain: 1.5 };
const activity = {
  module: "pmr" as const,
  mode: "manual" as const,
  activityEventId: "event-1",
  countryId: "spain",
  cityName: "Bilbao",
  resolvedLatitude: 43.263,
  resolvedLongitude: -2.935,
};

test("buildRadioStreamUrl and buildRadioRetuneUrl share station metadata query params", () => {
  const stream = new URL(buildRadioStreamUrl("/api/stream", channel, controls, activity), "http://local");
  const retune = new URL(buildRadioRetuneUrl("/api/stream", channel, activity, "stream-1"), "http://local");

  for (const url of [stream, retune]) {
    assert.equal(url.searchParams.get("label"), "Station One");
    assert.equal(url.searchParams.get("freqMHz"), "99.9");
    assert.equal(url.searchParams.get("module"), "pmr");
    assert.equal(url.searchParams.get("activityMode"), "manual");
    assert.equal(url.searchParams.get("activityEventId"), "event-1");
    assert.equal(url.searchParams.get("bandId"), "catalog");
    assert.equal(url.searchParams.get("channelId"), "station-1");
    assert.equal(url.searchParams.get("channelNumber"), "3");
    assert.equal(url.searchParams.get("countryId"), "spain");
    assert.equal(url.searchParams.get("cityName"), "Bilbao");
    assert.equal(url.searchParams.get("resolvedLatitude"), "43.263");
    assert.equal(url.searchParams.get("resolvedLongitude"), "-2.935");
  }

  assert.equal(stream.searchParams.get("lna"), "16");
  assert.equal(stream.searchParams.get("vga"), "20");
  assert.equal(stream.searchParams.get("audioGain"), "1.5");
  assert.equal(retune.searchParams.get("streamId"), "stream-1");
});
