import assert from "node:assert/strict";
import test from "node:test";

import { deriveRuntimeSummary } from "@/lib/runtime-diagnostics";

test("deriveRuntimeSummary prioritizes runtime service errors over warnings", () => {
  assert.deepEqual(
    deriveRuntimeSummary({
      warnings: ["Capture storage is missing or not writable."],
      services: { ais: { state: "error" }, adsb: { state: "running" } },
    }),
    { label: "Error", tone: "error" },
  );
});

test("deriveRuntimeSummary distinguishes warnings from a healthy runtime", () => {
  assert.deepEqual(
    deriveRuntimeSummary({
      warnings: ["Capture storage is missing or not writable."],
      services: { ais: { state: "running" }, adsb: { state: "running" } },
    }),
    { label: "Warnings", tone: "warnings" },
  );

  assert.deepEqual(
    deriveRuntimeSummary({
      warnings: [],
      services: { ais: { state: "stopped" }, adsb: { state: "starting" } },
    }),
    { label: "Healthy", tone: "healthy" },
  );
});
