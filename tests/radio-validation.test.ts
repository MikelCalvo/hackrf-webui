import test from "node:test";
import assert from "node:assert/strict";

import {
  validateCreateRadioSessionRequest,
  validateUpdateRadioSessionRequest,
} from "@/server/radio/validation";

const controls = { lna: 24, vga: 20, audioGain: 1 };
const channel = {
  id: "airband-guard-121500",
  bandId: "guard",
  number: 1,
  freqMhz: 121.5,
  label: "Guard 121.500",
  notes: "International civil emergency frequency",
};

test("validateCreateRadioSessionRequest accepts a bounded narrowband deck", () => {
  const result = validateCreateRadioSessionRequest({
    kind: "narrowband",
    module: "airband",
    mode: "scan",
    controls,
    bandId: "guard",
    channels: [channel],
    scanMode: "sequential",
    squelch: 0.012,
    dwellTime: 4,
    holdTime: 3,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.module, "airband");
    assert.equal(result.value.channels[0].freqMhz, 121.5);
  }
});

test("validateCreateRadioSessionRequest rejects out-of-band narrowband frequencies", () => {
  const result = validateCreateRadioSessionRequest({
    kind: "narrowband",
    module: "airband",
    mode: "scan",
    controls,
    bandId: "guard",
    channels: [{ ...channel, freqMhz: 446.00625 }],
    scanMode: "sequential",
    squelch: 0.012,
    dwellTime: 4,
    holdTime: 3,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /frequency/i);
  }
});

test("validateCreateRadioSessionRequest rejects oversized decks and invalid gain controls", () => {
  const tooManyChannels = Array.from({ length: 513 }, (_, index) => ({
    ...channel,
    id: `airband-${index}`,
    number: index + 1,
  }));

  assert.equal(
    validateCreateRadioSessionRequest({
      kind: "narrowband",
      module: "airband",
      mode: "scan",
      controls,
      bandId: "guard",
      channels: tooManyChannels,
      scanMode: "sequential",
      squelch: 0.012,
      dwellTime: 4,
      holdTime: 3,
    }).ok,
    false,
  );

  assert.equal(
    validateCreateRadioSessionRequest({
      kind: "fm",
      module: "fm",
      controls: { lna: 99, vga: 20, audioGain: 1 },
      station: { id: "fm", name: "FM", freqMhz: 99.1 },
    }).ok,
    false,
  );
});

test("validateUpdateRadioSessionRequest rejects malformed narrowband patches", () => {
  const invalid = validateUpdateRadioSessionRequest({
    channels: [{ ...channel, label: "" }],
    dwellTime: 0,
    holdTime: 99,
  });

  assert.equal(invalid.ok, false);

  const valid = validateUpdateRadioSessionRequest({
    controls,
    squelch: 0.01,
    dwellTime: 5,
    holdTime: 2,
    scanMode: "random",
  });
  assert.equal(valid.ok, true);
});
