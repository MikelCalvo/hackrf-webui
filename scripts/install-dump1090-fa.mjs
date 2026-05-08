import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = resolve(ROOT_DIR, ".cache", "adsb-runtime", "dump1090-fa");
const SRC_DIR = join(CACHE_DIR, "src");
const BIN_DIR = resolve(ROOT_DIR, "bin");
const OUTPUT_PATH = join(BIN_DIR, "dump1090-fa");
const LICENSE_OUTPUT_PATH = join(BIN_DIR, "dump1090-fa.COPYING");
const MANIFEST_PATH = join(CACHE_DIR, "manifest.json");

const DEFAULT_REF = "4f47d12a18db24238ab2d91c8637dae25937fd98";
const REF = process.env.DUMP1090_FA_REF?.trim() || DEFAULT_REF;
const EXPECTED_TARBALL_SHA256 = process.env.DUMP1090_FA_SHA256?.trim().toLowerCase() || "";
const ALLOW_UNPINNED_REF = process.env.DUMP1090_FA_ALLOW_UNPINNED_REF === "1";
const REINSTALL = process.env.DUMP1090_FA_REINSTALL === "1";

function log(message) {
  process.stdout.write(`[adsb] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[adsb] error: ${message}\n`);
  process.exit(1);
}

function readManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    return null;
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function assertPinnedRef() {
  if (/^[0-9a-f]{40}$/i.test(REF)) {
    return;
  }

  if (ALLOW_UNPINNED_REF) {
    log("Using an unpinned DUMP1090_FA_REF because DUMP1090_FA_ALLOW_UNPINNED_REF=1.");
    return;
  }

  fail("DUMP1090_FA_REF must be a full 40-character Git SHA. Set DUMP1090_FA_ALLOW_UNPINNED_REF=1 to opt out.");
}

function verifySha256(actual, expected, label) {
  if (!expected) {
    return;
  }

  if (!/^[0-9a-f]{64}$/.test(expected)) {
    fail(`${label} SHA-256 must be 64 lowercase hex characters.`);
  }

  if (actual !== expected) {
    fail(`${label} SHA-256 mismatch. Expected ${expected}, got ${actual}.`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    fail(`Could not run ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed.`);
  }
}

async function downloadTarball(url, outputPath) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "hackrf-webui/adsb-installer",
      "X-Decoder-Installer": "dump1090-fa",
    },
  });
  if (!response.ok) {
    fail(`Could not download ${url} (${response.status}).`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const tarball = Buffer.from(arrayBuffer);
  const digest = sha256(tarball);
  verifySha256(digest, EXPECTED_TARBALL_SHA256, "dump1090-fa source archive");
  writeFileSync(outputPath, tarball);
  return digest;
}

async function main() {
  assertPinnedRef();

  const existing = readManifest();
  if (
    !REINSTALL
    && existing?.ref === REF
    && existing.outputPath === OUTPUT_PATH
    && existsSync(OUTPUT_PATH)
  ) {
    log(`dump1090-fa already installed at ${OUTPUT_PATH}.`);
    return;
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  mkdirSync(BIN_DIR, { recursive: true });
  rmSync(SRC_DIR, { recursive: true, force: true });

  const tarballPath = join(CACHE_DIR, `dump1090-fa-${REF}.tar.gz`);
  const sourceUrl = `https://codeload.github.com/flightaware/dump1090/tar.gz/${REF}`;

  log(`Downloading dump1090-fa source from ${sourceUrl}`);
  const tarballSha256 = await downloadTarball(sourceUrl, tarballPath);

  log("Extracting dump1090-fa source tree.");
  run("tar", ["-xzf", tarballPath, "-C", CACHE_DIR]);
  rmSync(tarballPath, { force: true });

  const extractedDir = join(CACHE_DIR, `dump1090-${REF}`);
  if (!existsSync(extractedDir)) {
    fail("The dump1090-fa source archive was extracted, but the source tree was not found.");
  }

  run("mv", [extractedDir, SRC_DIR]);

  log("Building dump1090-fa with HackRF support only.");
  run(
    "make",
    [
      "dump1090",
      "RTLSDR=no",
      "BLADERF=no",
      "HACKRF=yes",
      "LIMESDR=no",
      "SOAPYSDR=no",
      `DUMP1090_VERSION=${REF.slice(0, 12)}`,
    ],
    {
      cwd: SRC_DIR,
      env: {
        ...process.env,
        CFLAGS: "-O3 -g -Wno-error=unterminated-string-initialization",
      },
    },
  );

  const builtBinaryPath = join(SRC_DIR, "dump1090");
  if (!existsSync(builtBinaryPath)) {
    fail("dump1090-fa built successfully, but the dump1090 binary was not produced.");
  }

  copyFileSync(builtBinaryPath, OUTPUT_PATH);
  chmodSync(OUTPUT_PATH, 0o755);

  const copyingPath = join(SRC_DIR, "COPYING");
  if (existsSync(copyingPath)) {
    copyFileSync(copyingPath, LICENSE_OUTPUT_PATH);
  }

  writeFileSync(
    MANIFEST_PATH,
    JSON.stringify(
      {
        ref: REF,
        sourceUrl,
        sourceSha256: tarballSha256,
        outputPath: OUTPUT_PATH,
        installedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  log(`Installed dump1090-fa at ${OUTPUT_PATH}`);
}

await main();
