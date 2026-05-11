import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const START_SH = "./start.sh";

async function runStart(args: string[], env: Record<string, string | undefined> = {}) {
  const nextEnv = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete nextEnv[key];
    } else {
      nextEnv[key] = value;
    }
  }

  try {
    const result = await execFileAsync(START_SH, args, {
      cwd: process.cwd(),
      env: nextEnv,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
    return {
      status: typeof failure.code === "number" ? failure.code : 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

test("start.sh --help documents Node 24/npm 11 runtime and auth safety", async () => {
  const result = await runStart(["--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Node\.js 24\+/);
  assert.match(result.stdout, /npm 11\+/);
  assert.match(result.stdout, /Binding to a non-loopback host requires/);
});

test("start.sh --check reports simulator, replay and token status without starting Next", async () => {
  const result = await runStart(
    ["--check", "--skip-system-deps", "--skip-maps", "--skip-adsb-runtime", "--skip-ai"],
    {
      HACKRF_WEBUI_SIMULATOR: "1",
      HACKRF_WEBUI_REPLAY: "1",
      HACKRF_WEBUI_TOKEN: "test-token",
      NEXT_PUBLIC_HACKRF_WEBUI_TOKEN: undefined,
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Node\.js\s+v24\./);
  assert.match(result.stdout, /npm\s+1[1-9]\./);
  assert.match(result.stdout, /RF simulator\s+enabled/);
  assert.match(result.stdout, /Replay feeds\s+enabled/);
  assert.match(result.stdout, /API auth\s+token enabled/);
});

test("start.sh refuses non-loopback bind without an API token", async () => {
  const result = await runStart(
    ["--check", "--host", "0.0.0.0", "--skip-system-deps", "--skip-maps", "--skip-adsb-runtime", "--skip-ai"],
    {
      HACKRF_WEBUI_TOKEN: undefined,
      NEXT_PUBLIC_HACKRF_WEBUI_TOKEN: undefined,
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /set HACKRF_WEBUI_TOKEN/);
});
