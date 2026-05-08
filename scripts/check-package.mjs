#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const FORBIDDEN_PACKAGE_PATHS = [
  /^\.next\//,
  /^assets\/ai\//,
  /^bin\//,
  /^data\/captures\//,
  /^db\/.*\.sqlite(?:-shm|-wal)?$/,
  /^public\/tiles\/osm\//,
  /^runtime\//,
];

function fail(message) {
  process.stderr.write(`[package-check] error: ${message}\n`);
  process.exitCode = 1;
}

const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || "npm pack --dry-run failed.\n");
  process.exit(result.status || 1);
}

let pack;
try {
  pack = JSON.parse(result.stdout);
} catch (error) {
  fail(`Could not parse npm pack output: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(process.exitCode || 1);
}

const entry = Array.isArray(pack) ? pack[0] : null;
const files = Array.isArray(entry?.files) ? entry.files : [];
if (!entry || files.length === 0) {
  fail("npm pack did not report any package files.");
  process.exit(process.exitCode || 1);
}

const paths = files.map((file) => file?.path).filter((path) => typeof path === "string");
const forbidden = paths.filter((path) => FORBIDDEN_PACKAGE_PATHS.some((pattern) => pattern.test(path)));
for (const path of forbidden) {
  fail(`Package includes local runtime artifact: ${path}`);
}

if (!paths.includes("package.json") || !paths.includes("README.md")) {
  fail("Package is missing package.json or README.md.");
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

process.stdout.write(`[package-check] ok: ${paths.length} files, ${entry.unpackedSize ?? 0} bytes unpacked.\n`);
