import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("package dry run excludes Hermes working artifacts", () => {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const [entry] = JSON.parse(result.stdout) as Array<{ files?: Array<{ path?: string }> }>;
  const paths = entry.files?.map((file) => file.path ?? "") ?? [];

  assert.equal(paths.some((path) => path.startsWith(".hermes/")), false);
});

test("package artifact guard forbids Hermes working artifacts", async () => {
  const source = await readFile(new URL("../scripts/check-package.mjs", import.meta.url), "utf8");

  assert.match(source, /\/\^\\\.hermes\\\//);
});
