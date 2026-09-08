import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("typecheck is non-destructive to existing production build artifacts", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
    scripts: Record<string, string>;
  };

  assert.match(packageJson.scripts.typecheck, /\btsc\b/);
  assert.match(packageJson.scripts.typecheck, /tsconfig\.typecheck\.json/);
  assert.doesNotMatch(packageJson.scripts.typecheck, /\b(?:npm\s+run\s+)?clean\b/);
  assert.doesNotMatch(packageJson.scripts.typecheck, /rmSync\(|\.next/);

  const typecheckConfig = await readFile(new URL("../tsconfig.typecheck.json", import.meta.url), "utf8");
  assert.doesNotMatch(typecheckConfig, /next-env\.d\.ts/);
  assert.match(typecheckConfig, /next\.config\.ts/);
  assert.match(typecheckConfig, /playwright\.auth\.config\.ts/);
});

test("run-only E2E command builds the isolated output it serves", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
    scripts: Record<string, string>;
  };

  assert.match(packageJson.scripts["test:e2e:run"], /HACKRF_WEBUI_NEXT_DIST_DIR/);
  assert.match(packageJson.scripts["test:e2e:run"], /build:web/);
  assert.match(packageJson.scripts["test:e2e:run"], /playwright test/);
});

test("authenticated E2E requires an injected token instead of bundling a fixture", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
    scripts: Record<string, string>;
  };

  assert.match(packageJson.scripts["test:e2e:auth"], /HACKRF_WEBUI_E2E_TOKEN/);
  assert.doesNotMatch(packageJson.scripts["test:e2e:auth"], /playwright-token/);
});
