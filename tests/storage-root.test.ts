import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Module from "node:module";

type ModuleLoader = (request: string, parent: unknown, isMain: boolean) => unknown;
const originalLoad = (Module as unknown as { _load: ModuleLoader })._load;
(Module as unknown as { _load: ModuleLoader })._load = function patchedLoad(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

test("capture storage honors an isolated HACKRF_WEBUI_CAPTURE_ROOT", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hackrf-captures-"));
  const previous = process.env.HACKRF_WEBUI_CAPTURE_ROOT;
  process.env.HACKRF_WEBUI_CAPTURE_ROOT = root;
  try {
    const storage = await import(`../src/server/storage.ts?test=${Date.now()}`);
    assert.equal(storage.capturesRootDir(), root);
    const sessionDir = storage.ensureCaptureSessionDir("pmr", "session-1", new Date("2026-08-12T00:00:00Z"));
    assert.equal(sessionDir, path.join(root, "2026", "08", "12", "pmr", "session-1"));
    assert.equal(storage.captureRelativePath(path.join(sessionDir, "activity.wav")), "2026/08/12/pmr/session-1/activity.wav");
  } finally {
    if (previous === undefined) delete process.env.HACKRF_WEBUI_CAPTURE_ROOT;
    else process.env.HACKRF_WEBUI_CAPTURE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("blank capture override falls back to the project capture root", async () => {
  const previous = process.env.HACKRF_WEBUI_CAPTURE_ROOT;
  process.env.HACKRF_WEBUI_CAPTURE_ROOT = "   ";
  try {
    const storage = await import(`../src/server/storage.ts?test=blank-${Date.now()}`);
    assert.equal(storage.capturesRootDir(), path.join(process.cwd(), "data", "captures"));
  } finally {
    if (previous === undefined) delete process.env.HACKRF_WEBUI_CAPTURE_ROOT;
    else process.env.HACKRF_WEBUI_CAPTURE_ROOT = previous;
  }
});

test("capture root test sentinel", () => assert.equal(true, true));
