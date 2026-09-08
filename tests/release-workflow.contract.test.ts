import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../.github/workflows/release.yml", import.meta.url);

test("release workflow accepts only exact stable SemVer tags", async () => {
  const source = await readFile(workflowPath, "utf8");

  assert.match(source, /\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/);
  assert.doesNotMatch(source, /v\[0-9\]\*\.\[0-9\]\*\.\[0-9\]\*/);
});

test("release workflow verifies package and changelog versions before tagging", async () => {
  const source = await readFile(workflowPath, "utf8");

  assert.match(source, /require\('\.\/package\.json'\)\.version/);
  assert.match(source, /CHANGELOG\.md is missing/);
  assert.match(source, /Create and push tag/);
});

test("release workflow injects an ephemeral token for authenticated E2E", async () => {
  const source = await readFile(workflowPath, "utf8");

  assert.match(source, /openssl rand -hex 32/);
  assert.match(source, /HACKRF_WEBUI_E2E_TOKEN="\$E2E_TOKEN" npm run test:e2e:auth/);
});

test("release workflow checks only for an existing tag", async () => {
  const source = await readFile(workflowPath, "utf8");

  assert.match(source, /refs\/tags\/\$VERSION/);
});
