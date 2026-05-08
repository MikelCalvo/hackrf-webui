#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT_DIR = resolve(new URL("..", import.meta.url).pathname);
const STATS_PATH = join(ROOT_DIR, ".next", "diagnostics", "route-bundle-stats.json");
const DEFAULT_FIRST_LOAD_BUDGET_BYTES = 800 * 1024;
const FIRST_LOAD_BUDGET_BYTES = Number.parseInt(
  process.env.BUNDLE_MAX_FIRST_LOAD_BYTES || String(DEFAULT_FIRST_LOAD_BUDGET_BYTES),
  10,
);

function fail(message) {
  process.stderr.write(`[bundle-check] error: ${message}\n`);
  process.exitCode = 1;
}

if (!existsSync(STATS_PATH)) {
  fail("Missing .next/diagnostics/route-bundle-stats.json. Run npm run build before npm run check:bundle.");
  process.exit(process.exitCode || 1);
}

let stats;
try {
  stats = JSON.parse(readFileSync(STATS_PATH, "utf8"));
} catch (error) {
  fail(`Could not parse ${STATS_PATH}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(process.exitCode || 1);
}

if (!Array.isArray(stats)) {
  fail("route-bundle-stats.json has an unexpected shape.");
  process.exit(process.exitCode || 1);
}

let largest = null;
for (const route of stats) {
  if (!route || typeof route.route !== "string") {
    fail("Bundle stats contain a route entry without a route name.");
    continue;
  }

  const bytes = Number(route.firstLoadUncompressedJsBytes);
  if (!Number.isFinite(bytes)) {
    fail(`${route.route} does not report firstLoadUncompressedJsBytes.`);
    continue;
  }

  if (!largest || bytes > largest.bytes) {
    largest = { route: route.route, bytes };
  }

  if (bytes > FIRST_LOAD_BUDGET_BYTES) {
    fail(`${route.route} first-load JS is ${bytes} bytes, above the ${FIRST_LOAD_BUDGET_BYTES} byte budget.`);
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

process.stdout.write(
  `[bundle-check] ok: ${stats.length} routes, largest first-load JS ${largest?.bytes ?? 0} bytes on ${largest?.route ?? "<none>"}.\n`,
);
