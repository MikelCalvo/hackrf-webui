import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const captureRoutePath = new URL("../src/app/api/capture-files/[fileId]/route.ts", import.meta.url);
const sigintPath = new URL("../src/lib/sigint.ts", import.meta.url);
const mediaComponentPath = new URL("../src/components/authenticated-capture-media.tsx", import.meta.url);
const moduleUiPath = new URL("../src/components/module-ui.tsx", import.meta.url);
const sigintComponentPath = new URL("../src/components/sigint.tsx", import.meta.url);

test("capture files require header authentication rather than query tokens", async () => {
  const source = await readFile(captureRoutePath, "utf8");

  assert.match(source, /authorizeApiRequest\(request, \{ sensitive: true \}\)/);
  assert.doesNotMatch(source, /allowQueryToken:\s*true/);
});

test("capture media fetches authorized blobs without appending credentials to URLs", async () => {
  const [sigint, mediaComponent, moduleUi, sigintComponent] = await Promise.all([
    readFile(sigintPath, "utf8"),
    readFile(mediaComponentPath, "utf8"),
    readFile(moduleUiPath, "utf8"),
    readFile(sigintComponentPath, "utf8"),
  ]);

  assert.doesNotMatch(sigint, /captureFileUrl|appendApiToken/);
  assert.match(mediaComponent, /apiFetch\(file\.url/);
  assert.match(mediaComponent, /URL\.createObjectURL/);
  assert.doesNotMatch(mediaComponent, /appendApiToken/);
  assert.doesNotMatch(moduleUi, /captureFileUrl/);
  assert.doesNotMatch(sigintComponent, /captureFileUrl/);
});
