import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const analyzerPath = new URL("../scripts/ai/audio_analyzer.py", import.meta.url);
const requirements = readFileSync(new URL("../scripts/ai/requirements.txt", import.meta.url), "utf8");

function runCacheCheck(modelRoot: string) {
  const program = `
import importlib.util, pathlib, sys, types
fw = types.ModuleType("faster_whisper")
fw.WhisperModel = object
vad = types.ModuleType("faster_whisper.vad")
vad.SileroVADModel = object
vad.VadOptions = object
sys.modules["faster_whisper"] = fw
sys.modules["faster_whisper.vad"] = vad
spec = importlib.util.spec_from_file_location("audio_analyzer", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
result = module.cached_model_path(pathlib.Path(sys.argv[2]), module.DEFAULT_ASR_MODEL, module.DEFAULT_ASR_REVISION)
print("ready" if result else "rejected")
`;
  return spawnSync("python3", ["-c", program, analyzerPath.pathname, modelRoot], { encoding: "utf8" });
}

test("SIGINT Audio v2 rejects a cached model whose manifest hash no longer matches", { skip: !process.env.HACKRF_WEBUI_NETWORK_TESTS }, () => {
  const root = mkdtempSync(join(tmpdir(), "hackrf-ai-model-integrity-"));
  try {
    const modelDir = join(root, "Systran--faster-whisper-base");
    const prepare = spawnSync("python3", [
      new URL("../scripts/ai/download_model.py", import.meta.url).pathname,
      "--model",
      "Systran/faster-whisper-base",
      "--destination",
      root,
      "--revision",
      "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66",
    ], { encoding: "utf8", timeout: 180_000 });
    assert.equal(prepare.status, 0, prepare.stdout || prepare.stderr);
    assert.equal(runCacheCheck(root).stdout.trim(), "ready");
    writeFileSync(join(modelDir, "config.json"), "{}\n", "utf8");
    assert.equal(runCacheCheck(root).stdout.trim(), "rejected");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SIGINT Audio v2 dependency lock contains hashes and start enforces them", () => {
  assert.match(requirements, /--hash=sha256:/);
  const start = readFileSync(new URL("../start.sh", import.meta.url), "utf8");
  assert.match(start, /--require-hashes/);
});

test("SIGINT Audio v2 performs model artifact hash verification in the offline cache path", () => {
  const analyzer = readFileSync(analyzerPath, "utf8");
  assert.match(analyzer, /sha256_file\(direct_model \/ name\) == digest/);
  assert.match(analyzer, /required\.issubset\(expected\)/);
});
