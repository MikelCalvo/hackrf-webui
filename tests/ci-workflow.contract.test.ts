import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../.github/workflows/ci.yml", import.meta.url);

test("CI injects an ephemeral token for authenticated E2E", async () => {
  const source = await readFile(workflowPath, "utf8");

  assert.match(source, /openssl rand -hex 32/);
  assert.match(source, /HACKRF_WEBUI_E2E_TOKEN="\$E2E_TOKEN" npm run test:e2e:auth/);
});
