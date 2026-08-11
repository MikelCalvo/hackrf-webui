import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { priorityForReviewStatus } from "@/lib/sigint-review";

test("discarded reviews always drop high priority", () => {
  assert.equal(priorityForReviewStatus("discarded", "high"), "normal");
  assert.equal(priorityForReviewStatus("discarded", "normal"), "normal");
});

test("actionable review states preserve the selected priority", () => {
  assert.equal(priorityForReviewStatus("pending", "high"), "high");
  assert.equal(priorityForReviewStatus("kept", "high"), "high");
  assert.equal(priorityForReviewStatus("flagged", "high"), "high");
});

test("review decisions render over the capture queue and do not expose a save button", async () => {
  const source = await readFile(new URL("../src/components/sigint.tsx", import.meta.url), "utf8");
  const queueBar = source.indexOf('data-testid="sigint-capture-queue-review-bar"');
  const evidenceDetail = source.indexOf('data-testid="sigint-evidence-detail"');

  assert.ok(queueBar > 0);
  assert.ok(evidenceDetail > queueBar);
  assert.doesNotMatch(source, /Save review/);
  assert.match(source, /Choose priority to save/);
  assert.match(source, /Discarded saves immediately with no priority/);
});

test("capture filters do not duplicate the app module navigation", async () => {
  const source = await readFile(new URL("../src/components/sigint.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, />Signal source</);
  assert.doesNotMatch(source, /Signal source:/);
});
