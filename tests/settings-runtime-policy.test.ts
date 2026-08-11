import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveEffectiveAiSettings,
  runtimeAiDisableReason,
} from "@/lib/settings-runtime";
import { DEFAULT_APP_SETTINGS } from "@/lib/settings";

test("runtime AI disable policy overrides a persisted enabled preference", () => {
  const saved = { ...DEFAULT_APP_SETTINGS.ai, enabled: true };
  const effective = resolveEffectiveAiSettings(saved, { HACKRF_WEBUI_SKIP_AI: "1" });
  assert.equal(effective.enabled, false);
  assert.equal(runtimeAiDisableReason({ HACKRF_WEBUI_SKIP_AI: "1" }), "Disabled by HACKRF_WEBUI_SKIP_AI runtime policy.");
});

test("legacy SKIP_AI runtime policy is also fail-closed", () => {
  const saved = { ...DEFAULT_APP_SETTINGS.ai, enabled: true };
  assert.equal(resolveEffectiveAiSettings(saved, { SKIP_AI: "true" }).enabled, false);
});

test("false-like runtime values do not lock the persisted AI preference", () => {
  const saved = { ...DEFAULT_APP_SETTINGS.ai, enabled: true };
  for (const value of [undefined, "", "0", "false", "off", "no"]) {
    assert.equal(resolveEffectiveAiSettings(saved, { HACKRF_WEBUI_SKIP_AI: value }).enabled, true);
  }
});

test("runtime AI policy test sentinel", () => assert.equal(true, true));
