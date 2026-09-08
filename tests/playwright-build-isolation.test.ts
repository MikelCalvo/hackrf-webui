import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("Playwright builds use an isolated Next output directory", async () => {
  const [nextConfig, defaultPlaywright, authPlaywright, packageJson, eslintConfig, gitignore, npmignore] = await Promise.all([
    source("next.config.ts"),
    source("playwright.config.ts"),
    source("playwright.auth.config.ts"),
    source("package.json"),
    source("eslint.config.mjs"),
    source(".gitignore"),
    source(".npmignore"),
  ]);
  const scripts = (JSON.parse(packageJson) as { scripts: Record<string, string> }).scripts;

  assert.match(nextConfig, /HACKRF_WEBUI_NEXT_DIST_DIR/);
  assert.match(defaultPlaywright, /HACKRF_WEBUI_NEXT_DIST_DIR/);
  assert.match(authPlaywright, /HACKRF_WEBUI_NEXT_DIST_DIR/);
  assert.match(authPlaywright, /HACKRF_WEBUI_E2E_TOKEN/);
  assert.doesNotMatch(authPlaywright, /playwright-token/);
  assert.match(scripts["test:e2e"], /HACKRF_WEBUI_NEXT_DIST_DIR/);
  assert.match(scripts["test:e2e:auth"], /HACKRF_WEBUI_NEXT_DIST_DIR/);
  assert.match(eslintConfig, /\.hermes\/next-\*\/\*\*/);
  assert.match(gitignore, /\/\.hermes\/next-e2e\//);
  assert.match(gitignore, /\/\.hermes\/next-e2e-auth\//);
  assert.match(npmignore, /\/\.hermes\//);
});
