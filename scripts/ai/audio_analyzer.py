#!/usr/bin/env python3
import argparse
import hashlib
import json
import math
import subprocess
import sys
from pathlib import Path
from time import perf_counter

import numpy as np
from faster_whisper import WhisperModel
from faster_whisper.vad import SileroVADModel, VadOptions


ENGINE_NAME = "sigint-audio-v2"
DEFAULT_ASR_MODEL = "Systran/faster-whisper-base"
DEFAULT_ASR_REVISION = "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66"
DEFAULT_VAD_FILENAME = "silero_vad_v6.onnx"
TARGET_RATE = 16000
MAX_SECONDS = 20.0
MIN_SECONDS = 0.20
SILENCE_FLOOR_RMS = 0.003
VAD_THRESHOLD = 0.42
ASR_MIN_AVG_LOGPROB = -1.15
ASR_MAX_NO_SPEECH_PROB = 0.72
ASR_MAX_COMPRESSION_RATIO = 2.4


def clamp01(value: float) -> float:
    return min(1.0, max(0.0, float(value)))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def decode_audio(wav_path: Path, *, sample_rate: int, seconds: float) -> np.ndarray:
    command = [
        "ffmpeg",
        "-loglevel",
        "error",
        "-i",
        str(wav_path),
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "-t",
        f"{seconds:.2f}",
        "-f",
        "f32le",
        "-",
    ]
    result = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL,
        check=False,
    )
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", errors="replace").strip() or "ffmpeg decode failed"
        raise RuntimeError(message)
    waveform = np.frombuffer(result.stdout, dtype=np.float32)
    if waveform.size == 0:
        raise RuntimeError("empty audio")
    return np.clip(waveform, -1.0, 1.0)


def cached_model_path(model_cache: Path, model_id: str, revision: str) -> Path | None:
    direct_model = model_cache / model_id.replace("/", "--")
    required = {"model.bin", "config.json", "tokenizer.json"}
    if direct_model.is_dir() and required.issubset({item.name for item in direct_model.iterdir()}):
        manifest_path = direct_model / "manifest.json"
        if manifest_path.is_file():
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                manifest = {}
            if manifest.get("model_id") == model_id and manifest.get("revision") == revision:
                files = manifest.get("files")
                if isinstance(files, list) and all(isinstance(item, dict) for item in files):
                    expected = {
                        str(item.get("name")): str(item.get("sha256"))
                        for item in files
                        if item.get("name") and item.get("sha256")
                    }
                    if required.issubset(expected) and all(
                        (direct_model / name).is_file()
                        and sha256_file(direct_model / name) == digest
                        for name, digest in expected.items()
                    ):
                        return direct_model

    return None


def is_model_cached(model_cache: Path, model_id: str, revision: str) -> bool:
    return cached_model_path(model_cache, model_id, revision) is not None


def create_whisper_model(
    model_id: str,
    model_cache: Path,
    *,
    cpu_threads: int,
    prepare: bool,
    revision: str,
) -> WhisperModel:
    model_cache.mkdir(parents=True, exist_ok=True)
    local_model = cached_model_path(model_cache, model_id, revision)
    model_source = model_id if prepare or local_model is None else str(local_model)
    return WhisperModel(
        model_source,
        device="cpu",
        compute_type="int8",
        cpu_threads=cpu_threads,
        num_workers=1,
        download_root=str(model_cache),
        local_files_only=not prepare,
    )


def prepare_asr_model(model_id: str, model_cache: Path, *, cpu_threads: int, revision: str) -> None:
    downloader = Path(__file__).with_name("download_model.py")
    result = subprocess.run(
        [
            sys.executable,
            str(downloader),
            "--model",
            model_id,
            "--destination",
            str(model_cache),
            "--revision",
            revision,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL,
        check=False,
    )
    if result.returncode != 0:
        message = result.stdout.decode("utf-8", errors="replace").strip()
        if not message:
            message = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(message or "ASR model preparation failed")
    create_whisper_model(model_id, model_cache, cpu_threads=cpu_threads, prepare=False, revision=revision)


def speech_timestamps_from_probabilities(
    probabilities: np.ndarray,
    audio_length_samples: int,
    options: VadOptions,
) -> list[dict[str, int]]:
    threshold = options.threshold
    neg_threshold = options.neg_threshold if options.neg_threshold is not None else max(threshold - 0.15, 0.01)
    window_size_samples = 512
    min_speech_samples = TARGET_RATE * options.min_speech_duration_ms / 1000
    speech_pad_samples = TARGET_RATE * options.speech_pad_ms / 1000
    max_speech_samples = TARGET_RATE * options.max_speech_duration_s - window_size_samples - 2 * speech_pad_samples
    min_silence_samples = TARGET_RATE * options.min_silence_duration_ms / 1000
    min_silence_samples_at_max_speech = TARGET_RATE * 98 / 1000
    triggered = False
    speeches: list[dict[str, int]] = []
    current_speech: dict[str, int] = {}
    temp_end = prev_end = next_start = 0
    for index, speech_prob in enumerate(probabilities):
        sample = window_size_samples * index
        if speech_prob >= threshold and temp_end:
            temp_end = 0
            if next_start < prev_end:
                next_start = sample
        if speech_prob >= threshold and not triggered:
            triggered = True
            current_speech["start"] = sample
            continue
        if triggered and sample - current_speech["start"] > max_speech_samples:
            current_speech["end"] = prev_end or sample
            speeches.append(current_speech)
            current_speech = {}
            triggered = bool(next_start >= prev_end and next_start)
            if triggered:
                current_speech["start"] = next_start
            prev_end = next_start = temp_end = 0
            continue
        if triggered and speech_prob < neg_threshold:
            if not temp_end:
                temp_end = sample
            if sample - temp_end > min_silence_samples_at_max_speech:
                prev_end = temp_end
            if sample - temp_end < min_silence_samples:
                continue
            current_speech["end"] = temp_end
            if current_speech["end"] - current_speech["start"] > min_speech_samples:
                speeches.append(current_speech)
            current_speech = {}
            prev_end = next_start = temp_end = 0
            triggered = False
    if current_speech and audio_length_samples - current_speech["start"] > min_speech_samples:
        current_speech["end"] = audio_length_samples
        speeches.append(current_speech)
    for index, speech in enumerate(speeches):
        if index == 0:
            speech["start"] = int(max(0, speech["start"] - speech_pad_samples))
        if index != len(speeches) - 1:
            silence = speeches[index + 1]["start"] - speech["end"]
            if silence < 2 * speech_pad_samples:
                speech["end"] += int(silence // 2)
                speeches[index + 1]["start"] = int(max(0, speeches[index + 1]["start"] - silence // 2))
            else:
                speech["end"] = int(min(audio_length_samples, speech["end"] + speech_pad_samples))
                speeches[index + 1]["start"] = int(max(0, speeches[index + 1]["start"] - speech_pad_samples))
        else:
            speech["end"] = int(min(audio_length_samples, speech["end"] + speech_pad_samples))
    return speeches


def run_silero_vad(waveform: np.ndarray, vad_model: Path) -> tuple[list[dict[str, float | int]], dict[str, object]]:
    model = SileroVADModel(str(vad_model))
    options = VadOptions(
        threshold=VAD_THRESHOLD,
        min_speech_duration_ms=120,
        min_silence_duration_ms=180,
        speech_pad_ms=120,
        max_speech_duration_s=20.0,
    )
    frame_samples = 512
    pad = (-waveform.size) % frame_samples
    padded = np.pad(waveform, (0, pad)) if pad else waveform
    probabilities = np.asarray(model(padded), dtype=np.float32).reshape(-1)
    raw_regions = speech_timestamps_from_probabilities(probabilities, waveform.size, options)
    regions: list[dict[str, float | int]] = []
    for region in raw_regions:
        start = max(0, int(region["start"]))
        end = min(waveform.size, int(region["end"]))
        if end <= start:
            continue
        first_frame = start // frame_samples
        final_frame = max(first_frame + 1, math.ceil(end / frame_samples))
        region_probs = probabilities[first_frame:final_frame]
        mean_probability = float(region_probs.mean()) if region_probs.size else 0.0
        regions.append({
            "start": start,
            "end": end,
            "start_ms": round(start * 1000.0 / TARGET_RATE),
            "end_ms": round(end * 1000.0 / TARGET_RATE),
            "mean_probability": round(mean_probability, 6),
        })
    voice_samples = sum(int(region["end"]) - int(region["start"]) for region in regions)
    voice_seconds = voice_samples / float(TARGET_RATE)
    total_seconds = waveform.size / float(TARGET_RATE)
    longest_burst_seconds = max(
        ((int(region["end"]) - int(region["start"])) / float(TARGET_RATE) for region in regions),
        default=0.0,
    )
    confidence = max((float(region["mean_probability"]) for region in regions), default=0.0)
    return regions, {
        "detected": bool(regions),
        "ratio": clamp01(voice_seconds / total_seconds if total_seconds > 0 else 0.0),
        "seconds": round(voice_seconds, 6),
        "longest_burst_seconds": round(longest_burst_seconds, 6),
        "confidence": clamp01(confidence),
        "detector": "silero-vad-v6",
        "region_count": len(regions),
        "speech_regions": regions,
    }


def empty_transcript(*, skipped: bool = False) -> dict[str, object]:
    return {
        "engine": "faster-whisper",
        "accepted": False,
        "skipped": skipped,
        "language": "",
        "language_probability": 0.0,
        "text": "",
        "confidence": 0.0,
        "duration_after_vad": 0.0,
        "segment_count": 0,
        "accepted_segments": 0,
        "mean_avg_logprob": 0.0,
        "max_no_speech_prob": 0.0,
        "segments": [],
    }


def transcribe_regions(
    waveform: np.ndarray,
    speech_regions: list[dict[str, float | int]],
    *,
    model_id: str,
    model_cache: Path,
    cpu_threads: int,
    language: str | None,
    hotwords: str,
    revision: str,
) -> dict[str, object]:
    model = create_whisper_model(model_id, model_cache, cpu_threads=cpu_threads, prepare=False, revision=revision)
    clip_timestamps = [
        timestamp
        for region in speech_regions
        for timestamp in (
            float(region["start"]) / TARGET_RATE,
            float(region["end"]) / TARGET_RATE,
        )
    ]
    segment_iterator, info = model.transcribe(
        waveform,
        language=language,
        task="transcribe",
        beam_size=1,
        temperature=0.0,
        word_timestamps=False,
        condition_on_previous_text=False,
        vad_filter=False,
        clip_timestamps=clip_timestamps,
        hotwords=hotwords or None,
        max_new_tokens=96,
    )

    segments: list[dict[str, object]] = []
    accepted_segments: list[dict[str, object]] = []
    for segment in segment_iterator:
        text = segment.text.strip()
        if not text:
            continue
        avg_logprob = float(segment.avg_logprob)
        no_speech_prob = float(segment.no_speech_prob)
        compression_ratio = float(segment.compression_ratio)
        segment_accepted = bool(
            avg_logprob >= ASR_MIN_AVG_LOGPROB
            and no_speech_prob <= ASR_MAX_NO_SPEECH_PROB
            and compression_ratio <= ASR_MAX_COMPRESSION_RATIO
        )
        words = [
            {
                "start": round(float(word.start), 3),
                "end": round(float(word.end), 3),
                "word": word.word,
                "probability": round(float(word.probability), 6),
            }
            for word in (segment.words or [])
        ]
        item = {
            "start": round(float(segment.start), 3),
            "end": round(float(segment.end), 3),
            "text": text,
            "accepted": segment_accepted,
            "avg_logprob": round(avg_logprob, 6),
            "no_speech_prob": round(no_speech_prob, 6),
            "compression_ratio": round(compression_ratio, 6),
            "words": words,
        }
        segments.append(item)
        if segment_accepted:
            accepted_segments.append(item)

    transcript_text = " ".join(str(item["text"]).strip() for item in accepted_segments).strip()
    if not transcript_text:
        transcript_text = ""
    mean_avg_logprob = (
        sum(float(item["avg_logprob"]) for item in accepted_segments) / len(accepted_segments)
        if accepted_segments
        else 0.0
    )
    max_no_speech_prob = max(
        (float(item["no_speech_prob"]) for item in accepted_segments),
        default=0.0,
    )
    transcript_confidence = clamp01(math.exp(mean_avg_logprob)) if accepted_segments else 0.0
    return {
        "engine": "faster-whisper",
        "accepted": bool(transcript_text),
        "skipped": False,
        "language": info.language or "",
        "language_probability": clamp01(float(info.language_probability)),
        "text": transcript_text,
        "confidence": transcript_confidence,
        "duration_after_vad": round(float(info.duration_after_vad), 6),
        "segment_count": len(segments),
        "accepted_segments": len(accepted_segments),
        "mean_avg_logprob": round(mean_avg_logprob, 6),
        "max_no_speech_prob": round(max_no_speech_prob, 6),
        "segments": segments,
    }


def build_error(message: str, *, asr_model: str) -> dict[str, object]:
    return {
        "schema_version": 2,
        "engine": ENGINE_NAME,
        "status": "failed",
        "classification": "unknown",
        "confidence": 0.0,
        "error": message,
        "audio_seconds": 0.0,
        "rms": 0.0,
        "elapsed_ms": 0,
        "voice_activity": {
            "detected": False,
            "ratio": 0.0,
            "seconds": 0.0,
            "longest_burst_seconds": 0.0,
            "confidence": 0.0,
            "detector": "silero-vad-v6",
            "region_count": 0,
            "speech_regions": [],
        },
        "transcript": empty_transcript(),
        "explanation": "",
        "components": {
            "vad": {"engine": "silero-vad", "model": DEFAULT_VAD_FILENAME},
            "asr": {"engine": "faster-whisper", "model": asr_model},
        },
    }


def analyze(args: argparse.Namespace) -> dict[str, object]:
    started = perf_counter()
    wav_path = Path(args.wav)
    vad_model = Path(args.vad_model)
    model_cache = Path(args.model_cache)
    if not wav_path.is_file():
        raise RuntimeError(f"missing audio: {wav_path}")
    if not vad_model.is_file():
        raise RuntimeError(f"missing VAD model: {vad_model}")
    if not args.skip_asr and not is_model_cached(model_cache, args.asr_model, args.asr_revision):
        raise RuntimeError("ASR model is not prepared. Run the analyzer once with --prepare.")

    waveform = decode_audio(wav_path, sample_rate=TARGET_RATE, seconds=MAX_SECONDS)
    audio_seconds = waveform.size / float(TARGET_RATE)
    rms = float(np.sqrt(np.mean(np.square(waveform)))) if waveform.size else 0.0
    if audio_seconds < MIN_SECONDS:
        voice_activity = run_silero_vad(waveform, vad_model)[1]
        transcript = empty_transcript(skipped=True)
        classification = "unknown"
        confidence = 0.0
        explanation = "The capture is too short for a reliable local analysis pass."
    elif rms < SILENCE_FLOOR_RMS:
        voice_activity = run_silero_vad(waveform, vad_model)[1]
        transcript = empty_transcript(skipped=True)
        classification = "noise"
        confidence = 0.99
        explanation = "No reliable voice activity was found above the local silence floor."
    else:
        speech_regions, voice_activity = run_silero_vad(waveform, vad_model)
        if speech_regions and not args.skip_asr:
            transcript = transcribe_regions(
                waveform,
                speech_regions,
                model_id=args.asr_model,
                model_cache=model_cache,
                cpu_threads=args.cpu_threads,
                language=args.language or None,
                hotwords=args.hotwords,
                revision=args.asr_revision,
            )
        else:
            transcript = empty_transcript(skipped=args.skip_asr)

        if transcript["accepted"]:
            classification = "speech"
            confidence = max(float(voice_activity["confidence"]), float(transcript["confidence"]))
            explanation = "Voice activity was detected and transcribed locally."
        elif speech_regions:
            classification = "unknown"
            confidence = float(voice_activity["confidence"])
            explanation = (
                "Voice activity was detected, but the local ASR result was rejected as unreliable."
                if not args.skip_asr
                else "Voice activity was detected; ASR skipped for this analysis run."
            )
        else:
            classification = "noise"
            confidence = clamp01(1.0 - float(voice_activity["confidence"]))
            explanation = "No reliable voice activity was detected in the saved radio clip."

    return {
        "schema_version": 2,
        "engine": ENGINE_NAME,
        "status": "completed",
        "classification": classification,
        "confidence": clamp01(confidence),
        "error": "",
        "audio_seconds": round(audio_seconds, 6),
        "rms": round(rms, 8),
        "elapsed_ms": int((perf_counter() - started) * 1000),
        "voice_activity": voice_activity,
        "transcript": transcript,
        "explanation": explanation,
        "components": {
            "vad": {"engine": "silero-vad", "model": vad_model.name},
            "asr": {"engine": "faster-whisper", "model": args.asr_model},
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="hackrf-webui SIGINT Audio v2 analyzer")
    parser.add_argument("--wav", help="WAV capture to analyze")
    parser.add_argument("--vad-model", required=True, help="Path to silero_vad_v6.onnx")
    parser.add_argument("--model-cache", required=True, help="Repository-managed faster-whisper cache")
    parser.add_argument("--asr-model", default=DEFAULT_ASR_MODEL, help="Faster-whisper model ID")
    parser.add_argument("--asr-revision", default=DEFAULT_ASR_REVISION, help="Pinned faster-whisper model revision")
    parser.add_argument("--cpu-threads", type=int, default=4, help="CTranslate2 CPU threads")
    parser.add_argument("--language", default="", help="Optional language code override")
    parser.add_argument("--hotwords", default="", help="Optional radio vocabulary prompt")
    parser.add_argument("--skip-asr", action="store_true", help="Run deterministic VAD-only analysis")
    parser.add_argument("--prepare", action="store_true", help="Download and prepare the ASR model cache")
    parser.add_argument("--check", action="store_true", help="Validate runtime and local artifacts")
    args = parser.parse_args()

    payload: dict[str, object]
    try:
        vad_model = Path(args.vad_model)
        model_cache = Path(args.model_cache)
        vad_ready = vad_model.is_file()
        model_cached = is_model_cached(model_cache, args.asr_model, args.asr_revision)
        if args.prepare:
            if not vad_ready:
                raise RuntimeError(f"missing VAD model: {vad_model}")
            prepare_asr_model(args.asr_model, model_cache, cpu_threads=args.cpu_threads, revision=args.asr_revision)
            payload = {
                "schema_version": 2,
                "engine": ENGINE_NAME,
                "status": "ok",
                "prepared": True,
                "model_cached": is_model_cached(model_cache, args.asr_model, args.asr_revision),
                "components": {
                    "vad": {"engine": "silero-vad", "model": vad_model.name, "vad_ready": True},
                    "asr": {"engine": "faster-whisper", "model": args.asr_model, "asr_ready": True},
                },
            }
        elif args.check:
            payload = {
                "schema_version": 2,
                "engine": ENGINE_NAME,
                "status": "ok" if vad_ready and (model_cached or args.skip_asr) else "failed",
                "prepared": False,
                "model_cached": model_cached,
                "components": {
                    "vad": {"engine": "silero-vad", "model": vad_model.name, "vad_ready": vad_ready},
                    "asr": {
                        "engine": "faster-whisper",
                        "model": args.asr_model,
                        "asr_ready": model_cached,
                        "skipped": args.skip_asr,
                    },
                },
            }
            if payload["status"] != "ok":
                payload["error"] = "Local AI artifacts are not ready. Use --prepare to install the ASR model."
        else:
            if not args.wav:
                raise RuntimeError("missing --wav")
            payload = analyze(args)
    except Exception as exc:
        payload = build_error(str(exc), asr_model=args.asr_model)
        print(json.dumps(payload, ensure_ascii=False))
        return 1

    print(json.dumps(payload, ensure_ascii=False))
    return 0 if payload.get("status") in {"ok", "completed"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
