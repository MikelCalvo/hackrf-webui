import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_APP_SETTINGS } from "@/lib/settings";
import {
  applyAiEnvironmentDefaults,
  resolveSavedAiSettings,
} from "@/lib/settings-runtime";

test("documented AI environment defaults seed threads and hotwords when no DB row exists", () => {
  const resolved = applyAiEnvironmentDefaults(DEFAULT_APP_SETTINGS.ai, {
    HACKRF_WEBUI_AI_CPU_THREADS: "6",
    HACKRF_WEBUI_AI_HOTWORDS: " PMR, Bilbao ",
  });
  assert.equal(resolved.cpuThreads, 6);
  assert.equal(resolved.hotwords, "PMR, Bilbao");
});

test("invalid AI environment defaults fall back safely", () => {
  const resolved = applyAiEnvironmentDefaults(DEFAULT_APP_SETTINGS.ai, {
    HACKRF_WEBUI_AI_CPU_THREADS: "999",
    HACKRF_WEBUI_AI_HOTWORDS: "x".repeat(1001),
  });
  assert.equal(resolved.cpuThreads, DEFAULT_APP_SETTINGS.ai.cpuThreads);
  assert.equal(resolved.hotwords, DEFAULT_APP_SETTINGS.ai.hotwords);
});

test("environment defaults apply only while the AI section has no database row", () => {
  const env = {
    HACKRF_WEBUI_AI_CPU_THREADS: "6",
    HACKRF_WEBUI_AI_HOTWORDS: "environment words",
  };
  const saved = { ...DEFAULT_APP_SETTINGS.ai, cpuThreads: 2, hotwords: "database words" };
  assert.equal(resolveSavedAiSettings(saved, "default", env).cpuThreads, 6);
  assert.equal(resolveSavedAiSettings(saved, "database", env).cpuThreads, 2);
  assert.equal(resolveSavedAiSettings(saved, "database", env).hotwords, "database words");
});

test("AI environment defaults test sentinel", () => assert.equal(true, true));
