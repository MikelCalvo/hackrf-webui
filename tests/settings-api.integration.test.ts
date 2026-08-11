import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import Module from "node:module";

const execFileAsync = promisify(execFile);
type ModuleLoader = (request: string, parent: unknown, isMain: boolean) => unknown;
const originalLoad = (Module as unknown as { _load: ModuleLoader })._load;
(Module as unknown as { _load: ModuleLoader })._load = function patchedLoad(
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

async function prepareDb(dbPath: string): Promise<void> {
  await execFileAsync(process.execPath, ["./scripts/db/migrate.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, HACKRF_WEBUI_DB_PATH: dbPath },
    timeout: 30_000,
  });
}

test("settings route handlers persist values and enforce runtime AI policy", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "hackrf-settings-api-"));
  const dbPath = path.join(workspace, "app.sqlite");
  const previousDb = process.env.HACKRF_WEBUI_DB_PATH;
  const previousSkip = process.env.HACKRF_WEBUI_SKIP_AI;
  process.env.HACKRF_WEBUI_DB_PATH = dbPath;
  process.env.HACKRF_WEBUI_SKIP_AI = "1";

  try {
    await prepareDb(dbPath);
    const route = await import(`../src/app/api/settings/route.ts?test=${Date.now()}`);
    const patchRequest = new Request("http://127.0.0.1/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1" },
      body: JSON.stringify({ ai: { enabled: true, cpuThreads: 2, hotwords: "mayday", modules: ["pmr"] } }),
    });
    const patchResponse = await route.PATCH(patchRequest);
    assert.equal(patchResponse.status, 200);
    const patched = await patchResponse.json();
    assert.equal(patched.snapshot.values.ai.enabled, true);
    assert.equal(patched.analysis.enabled, false);
    assert.equal(patched.analysis.savedEnabled, true);
    assert.equal(patched.analysis.lockedByRuntime, true);
    assert.match(patched.analysis.runtimePolicyReason, /HACKRF_WEBUI_SKIP_AI/);

    const getResponse = await route.GET(new Request("http://127.0.0.1/api/settings"));
    assert.equal(getResponse.status, 200);
    assert.match(getResponse.headers.get("cache-control") ?? "", /no-store/);
    const fetched = await getResponse.json();
    assert.equal(fetched.snapshot.values.ai.hotwords, "mayday");
    assert.equal(fetched.analysis.enabled, false);
  } finally {
    if (previousDb === undefined) delete process.env.HACKRF_WEBUI_DB_PATH;
    else process.env.HACKRF_WEBUI_DB_PATH = previousDb;
    if (previousSkip === undefined) delete process.env.HACKRF_WEBUI_SKIP_AI;
    else process.env.HACKRF_WEBUI_SKIP_AI = previousSkip;
    await rm(workspace, { recursive: true, force: true });
  }
});

test("settings API integration test sentinel", () => assert.equal(true, true));
