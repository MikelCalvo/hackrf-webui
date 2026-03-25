#!/usr/bin/env python3
import argparse
import csv
import json
import subprocess
from pathlib import Path

import numpy as np
import webrtcvad

try:
    from ai_edge_litert.interpreter import Interpreter  # type: ignore
    MODEL_NAME = "yamnet-ai-edge-litert + webrtcvad"
except Exception:
    from tflite_runtime.interpreter import Interpreter  # type: ignore
    MODEL_NAME = "yamnet-tflite-runtime + webrtcvad"


TARGET_RATE = 16000
MAX_SECONDS = 10.0
MIN_SECONDS = 0.30
SILENCE_FLOOR_RMS = 0.003
VAD_MODE = 2
VAD_FRAME_MS = 30


def load_labels(path: Path) -> list[str]:
    with path.open("r", encoding="utf-8") as fh:
        reader = csv.reader(fh)
        next(reader, None)
        return [row[2] for row in reader if len(row) >= 3]


def decode_audio(wav_path: Path, *, sample_rate: int, seconds: float) -> np.ndarray:
    cmd = [
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
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL,
        check=False,
    )
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", errors="replace").strip() or "ffmpeg decode failed"
        raise RuntimeError(message)
    samples = np.frombuffer(result.stdout, dtype=np.float32)
    if samples.size == 0:
        raise RuntimeError("empty audio")
    return np.clip(samples, -1.0, 1.0)


def label_group(label: str) -> str:
    name = label.strip().lower()
    if not name:
        return "unknown"
    speech_tokens = (
        "speech",
        "conversation",
        "narration",
        "monologue",
        "whisper",
        "yell",
        "shout",
        "chant",
        "babbling",
        "hubbub",
        "screaming",
    )
    music_tokens = (
        "music",
        "singing",
        "choir",
        "song",
        "lullaby",
        "humming",
        "rapping",
        "gospel",
    )
    for token in speech_tokens:
        if token in name:
            return "speech"
    for token in music_tokens:
        if token in name:
            return "music"
    if name == "unknown":
        return "unknown"
    return "noise"


def summarize_scores(labels: list[str], scores: np.ndarray) -> dict[str, object]:
    mean_scores = scores.mean(axis=0)
    ranked = np.argsort(mean_scores)[::-1]
    top_items: list[dict[str, float | str]] = []
    group_scores = {"speech": 0.0, "music": 0.0, "noise": 0.0, "unknown": 0.0}
    representative_items: dict[str, dict[str, float | str]] = {}
    for index in ranked[:5]:
        label = labels[int(index)]
        score = float(mean_scores[int(index)])
        top_items.append({"label": label, "score": score})
    for index in ranked[:40]:
        label = labels[int(index)]
        score = float(mean_scores[int(index)])
        group = label_group(label)
        group_scores[group] += score
        representative_items.setdefault(group, {"label": label, "score": score})

    top_label = str(top_items[0]["label"])
    top_score = float(top_items[0]["score"])
    broad_class = "noise"
    confidence = max(top_score, group_scores["noise"])
    if top_score < 0.10:
        broad_class = "unknown"
        confidence = top_score
    elif group_scores["speech"] >= max(0.20, group_scores["music"] * 1.15):
        broad_class = "speech"
        confidence = max(top_score, group_scores["speech"])
    elif group_scores["music"] >= max(0.20, group_scores["speech"] * 1.10):
        broad_class = "music"
        confidence = max(top_score, group_scores["music"])
    elif top_label.lower() == "unknown":
        broad_class = "unknown"
        confidence = top_score

    class_item = representative_items.get(broad_class)
    class_label = str(class_item["label"]) if class_item else top_label
    class_score = float(class_item["score"]) if class_item else top_score
    return {
        "class": broad_class,
        "class_label": class_label,
        "class_score": class_score,
        "confidence": confidence,
        "scene_label": top_label,
        "scene_score": top_score,
        "top_items": top_items,
        "group_scores": group_scores,
    }


def compute_voice_activity(waveform: np.ndarray) -> dict[str, object]:
    frame_samples = int(TARGET_RATE * (VAD_FRAME_MS / 1000.0))
    if frame_samples <= 0 or waveform.size < frame_samples:
        return {
            "detected": False,
            "ratio": 0.0,
            "seconds": 0.0,
            "longest_burst_seconds": 0.0,
            "confidence": 0.0,
            "detector": f"webrtcvad-{VAD_MODE}",
        }

    pcm = np.clip(waveform, -1.0, 1.0)
    pcm16 = (pcm * 32767.0).astype(np.int16)
    vad = webrtcvad.Vad(VAD_MODE)
    total_frames = pcm16.size // frame_samples
    speech_frames = 0
    longest_run = 0
    current_run = 0

    for index in range(total_frames):
        start = index * frame_samples
        end = start + frame_samples
        frame = pcm16[start:end]
        is_speech = vad.is_speech(frame.tobytes(), TARGET_RATE)
        if is_speech:
            speech_frames += 1
            current_run += 1
            longest_run = max(longest_run, current_run)
        else:
            current_run = 0

    ratio = speech_frames / float(total_frames) if total_frames > 0 else 0.0
    speech_seconds = speech_frames * (VAD_FRAME_MS / 1000.0)
    longest_burst_seconds = longest_run * (VAD_FRAME_MS / 1000.0)
    detected = bool(
        ratio >= 0.18
        or speech_seconds >= 0.45
        or longest_burst_seconds >= 0.24
    )
    confidence = min(
        1.0,
        max(
            ratio * 1.8,
            speech_seconds / max(1.0, waveform.size / float(TARGET_RATE)),
            longest_burst_seconds * 1.9,
        ),
    )

    return {
        "detected": detected,
        "ratio": ratio,
        "seconds": speech_seconds,
        "longest_burst_seconds": longest_burst_seconds,
        "confidence": confidence,
        "detector": f"webrtcvad-{VAD_MODE}",
    }


def build_explanation(
    broad_class: str,
    class_label: str,
    scene_label: str,
    voice_activity: dict[str, object],
) -> str:
    voice_detected = bool(voice_activity["detected"])
    voice_seconds = float(voice_activity["seconds"])
    scene_lower = scene_label.strip().lower()
    class_lower = class_label.strip().lower()

    if broad_class == "speech":
        if voice_detected and scene_lower and scene_lower != class_lower:
            return (
                f"Voice activity was detected, but the overall acoustic scene is dominated by "
                f"{scene_label.lower()} between bursts."
            )
        if voice_detected:
            return f"Voice activity was detected for about {voice_seconds:.2f} s of the saved clip."
        return "Speech-like content was detected in a weak or intermittent radio segment."
    if broad_class == "music":
        return "The capture looks music-dominant rather than operational voice traffic."
    if broad_class == "noise":
        if scene_lower == "silence":
            return "No clear voice was detected; the capture is mostly silence between radio bursts."
        return f"No clear voice was detected; the scene is dominated by {scene_label.lower()}."
    return "The capture did not contain enough confident evidence to classify beyond the ambient scene."


def classify_file(wav_path: Path, interpreter: Interpreter, labels: list[str]) -> dict[str, object]:
    waveform = decode_audio(wav_path, sample_rate=TARGET_RATE, seconds=MAX_SECONDS)
    duration_s = waveform.size / float(TARGET_RATE)
    rms = float(np.sqrt(np.mean(np.square(waveform)))) if waveform.size else 0.0
    if duration_s < MIN_SECONDS:
        return {
            "status": "completed",
            "class": "unknown",
            "subclass": "Too short",
            "confidence": 0.0,
            "model": MODEL_NAME,
            "error": "",
            "audio_seconds": duration_s,
            "rms": rms,
            "top_labels": [],
            "scene_label": "Too short",
            "scene_score": 0.0,
            "voice_activity": {
                "detected": False,
                "ratio": 0.0,
                "seconds": 0.0,
                "longest_burst_seconds": 0.0,
                "confidence": 0.0,
                "detector": f"webrtcvad-{VAD_MODE}",
            },
            "explanation": "The capture is too short for a reliable local audio analysis pass.",
        }
    if rms < SILENCE_FLOOR_RMS:
        return {
            "status": "completed",
            "class": "noise",
            "subclass": "Silence floor",
            "confidence": 0.99,
            "model": MODEL_NAME,
            "error": "",
            "audio_seconds": duration_s,
            "rms": rms,
            "top_labels": [],
            "scene_label": "Silence",
            "scene_score": 0.99,
            "voice_activity": {
                "detected": False,
                "ratio": 0.0,
                "seconds": 0.0,
                "longest_burst_seconds": 0.0,
                "confidence": 0.0,
                "detector": f"webrtcvad-{VAD_MODE}",
            },
            "explanation": "The clip sits below the silence floor, so there is no usable voice content to review.",
        }

    input_details = interpreter.get_input_details()[0]
    output_details = interpreter.get_output_details()
    interpreter.resize_tensor_input(input_details["index"], [waveform.shape[0]], strict=False)
    interpreter.allocate_tensors()
    interpreter.set_tensor(input_details["index"], waveform)
    interpreter.invoke()
    scores = interpreter.get_tensor(output_details[0]["index"])
    summary = summarize_scores(labels, scores)
    voice_activity = compute_voice_activity(waveform)
    broad_class = str(summary["class"])
    subclass = str(summary["class_label"])
    confidence = float(summary["confidence"])
    scene_label = str(summary["scene_label"])
    scene_score = float(summary["scene_score"])
    top_items = list(summary["top_items"])
    group_scores = summary["group_scores"]
    speech_group_score = float(group_scores["speech"])

    if broad_class in {"noise", "unknown"} and bool(voice_activity["detected"]) and speech_group_score >= 0.08:
        broad_class = "speech"
        subclass = "Speech"
        confidence = max(confidence, float(voice_activity["confidence"]))
    elif broad_class == "speech":
        confidence = max(confidence, float(voice_activity["confidence"]) * 0.92)

    return {
        "status": "completed",
        "class": broad_class,
        "subclass": subclass,
        "confidence": float(min(1.0, max(0.0, confidence))),
        "model": MODEL_NAME,
        "error": "",
        "audio_seconds": duration_s,
        "rms": rms,
        "top_labels": top_items,
        "scene_label": scene_label,
        "scene_score": scene_score,
        "voice_activity": voice_activity,
        "explanation": build_explanation(broad_class, subclass, scene_label, voice_activity),
    }


def build_error(message: str) -> dict[str, object]:
    return {
        "status": "failed",
        "class": "",
        "subclass": "",
        "confidence": 0.0,
        "model": MODEL_NAME,
        "error": message,
        "audio_seconds": 0.0,
        "rms": 0.0,
        "top_labels": [],
        "scene_label": "",
        "scene_score": 0.0,
        "voice_activity": {
            "detected": False,
            "ratio": 0.0,
            "seconds": 0.0,
            "longest_burst_seconds": 0.0,
            "confidence": 0.0,
            "detector": f"webrtcvad-{VAD_MODE}",
        },
        "explanation": "",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="hackrf-webui AI audio tagger")
    parser.add_argument("--wav", help="WAV file to classify")
    parser.add_argument("--model", required=True, help="Path to the YAMNet TFLite model")
    parser.add_argument("--labels", required=True, help="Path to the YAMNet class map CSV")
    parser.add_argument("--check", action="store_true", help="Validate runtime and model")
    args = parser.parse_args()

    model_path = Path(args.model)
    labels_path = Path(args.labels)

    try:
      if not model_path.exists():
          raise RuntimeError(f"missing model: {model_path}")
      if not labels_path.exists():
          raise RuntimeError(f"missing labels: {labels_path}")
      labels = load_labels(labels_path)
      interpreter = Interpreter(model_path=str(model_path))
      interpreter.allocate_tensors()
    except Exception as exc:
      payload = build_error(str(exc))
      print(json.dumps(payload, ensure_ascii=True))
      return 1

    if args.check:
      print(json.dumps({"status": "ok", "model": MODEL_NAME, "labels": len(labels)}, ensure_ascii=True))
      return 0
    if not args.wav:
      print(json.dumps(build_error("missing --wav"), ensure_ascii=True))
      return 1

    wav_path = Path(args.wav)
    try:
      payload = classify_file(wav_path, interpreter, labels)
    except Exception as exc:
      payload = build_error(str(exc))
      print(json.dumps(payload, ensure_ascii=True))
      return 1

    print(json.dumps(payload, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
