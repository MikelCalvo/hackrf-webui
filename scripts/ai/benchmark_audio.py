#!/usr/bin/env python3
import argparse
import json
import subprocess
from collections import Counter, defaultdict
from pathlib import Path
from time import perf_counter


def analyze(command: list[str]) -> tuple[dict[str, object], float]:
    started = perf_counter()
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    elapsed = perf_counter() - started
    lines = [line.strip() for line in result.stdout.decode("utf-8", errors="replace").splitlines() if line.strip()]
    if not lines:
        raise RuntimeError(result.stderr.decode("utf-8", errors="replace").strip() or "analyzer returned no JSON")
    payload = json.loads(lines[-1])
    if result.returncode != 0 or payload.get("status") != "completed":
        raise RuntimeError(str(payload.get("error") or "analysis failed"))
    return payload, elapsed


def main() -> int:
    parser = argparse.ArgumentParser(description="Benchmark SIGINT Audio v2 on preserved WAV captures")
    parser.add_argument("--corpus", required=True, help="Directory containing WAV files")
    parser.add_argument("--python", required=True)
    parser.add_argument("--analyzer", required=True)
    parser.add_argument("--vad-model", required=True)
    parser.add_argument("--model-cache", required=True)
    parser.add_argument("--asr-model", required=True)
    parser.add_argument("--cpu-threads", type=int, default=4)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--skip-asr", action="store_true")
    parser.add_argument("--output", help="Optional JSON report path")
    args = parser.parse_args()

    corpus = Path(args.corpus)
    wav_files = sorted(corpus.rglob("*.wav"))
    if args.limit > 0:
        wav_files = wav_files[: args.limit]
    if not wav_files:
        raise SystemExit("no WAV captures found")

    rows: list[dict[str, object]] = []
    counts: Counter[str] = Counter()
    module_counts: dict[str, Counter[str]] = defaultdict(Counter)
    total_elapsed = 0.0
    total_audio = 0.0
    for wav_path in wav_files:
        command = [
            args.python,
            args.analyzer,
            "--wav",
            str(wav_path),
            "--vad-model",
            args.vad_model,
            "--model-cache",
            args.model_cache,
            "--asr-model",
            args.asr_model,
            "--cpu-threads",
            str(args.cpu_threads),
        ]
        if args.skip_asr:
            command.append("--skip-asr")
        payload, elapsed = analyze(command)
        classification = str(payload.get("classification") or "unknown")
        relative = wav_path.relative_to(corpus)
        module = relative.parts[3] if len(relative.parts) > 3 else "unknown"
        transcript = payload.get("transcript") if isinstance(payload.get("transcript"), dict) else {}
        voice = payload.get("voice_activity") if isinstance(payload.get("voice_activity"), dict) else {}
        row = {
            "path": str(relative),
            "module": module,
            "classification": classification,
            "confidence": payload.get("confidence"),
            "voice_detected": voice.get("detected"),
            "voice_confidence": voice.get("confidence"),
            "transcript_accepted": transcript.get("accepted"),
            "language": transcript.get("language"),
            "text": transcript.get("text"),
            "audio_seconds": payload.get("audio_seconds"),
            "elapsed_seconds": round(elapsed, 6),
        }
        rows.append(row)
        counts[classification] += 1
        module_counts[module][classification] += 1
        total_elapsed += elapsed
        total_audio += float(payload.get("audio_seconds") or 0.0)
        print(json.dumps(row, ensure_ascii=False), flush=True)

    report = {
        "schema_version": 1,
        "engine": "sigint-audio-v2",
        "asr_model": args.asr_model,
        "skip_asr": args.skip_asr,
        "capture_count": len(rows),
        "classification_counts": dict(counts),
        "module_counts": {module: dict(values) for module, values in module_counts.items()},
        "transcript_count": sum(1 for row in rows if row["transcript_accepted"]),
        "voice_count": sum(1 for row in rows if row["voice_detected"]),
        "audio_seconds": round(total_audio, 6),
        "elapsed_seconds": round(total_elapsed, 6),
        "realtime_factor": round(total_elapsed / total_audio, 6) if total_audio > 0 else None,
        "rows": rows,
    }
    if args.output:
        Path(args.output).write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "rows"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
