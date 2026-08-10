#!/usr/bin/env python3
import argparse
import hashlib
import json
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

HUGGING_FACE_API = "https://huggingface.co/api/models"
HUGGING_FACE_RESOLVE = "https://huggingface.co"
REQUIRED_FILES = ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt")
PINNED_MODEL_FILES = {
    ("Systran/faster-whisper-base", "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66"): {
        "config.json": "56a6d8110d311f19c8f0471e562832c7527f146b567275bfca59fcf7c184da9a",
        "model.bin": "d01c3014881c9c6f3133c182f3d2887eb6ca1c789a7538c5c007196857a0a6a9",
        "tokenizer.json": "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab",
        "vocabulary.txt": "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913",
    },
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch_json(url: str) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.load(response)


def download_file(url: str, destination: Path, expected_size: int | None) -> None:
    temporary = destination.with_suffix(f"{destination.suffix}.tmp")
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "hackrf-webui/1"})
        with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        actual_size = temporary.stat().st_size
        if expected_size is not None and actual_size != expected_size:
            raise RuntimeError(
                f"downloaded size mismatch for {destination.name}: expected {expected_size}, got {actual_size}"
            )
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def prepare_model(model_id: str, destination_root: Path, *, revision: str = "main") -> dict[str, object]:
    requested_revision = revision
    metadata = fetch_json(f"{HUGGING_FACE_API}/{model_id}?blobs=true&revision={urllib.parse.quote(revision, safe='')}")
    resolved_revision = str(metadata.get("sha") or revision)
    expected_digests = PINNED_MODEL_FILES.get((model_id, resolved_revision))
    if expected_digests is None:
        raise RuntimeError(
            "model files are not digest-pinned; add the exact model revision and SHA-256 values before use"
        )
    raw_siblings = metadata.get("siblings")
    sibling_rows = raw_siblings if isinstance(raw_siblings, list) else []
    siblings = {
        str(item.get("rfilename")): item
        for item in sibling_rows
        if isinstance(item, dict)
    }
    missing = [name for name in REQUIRED_FILES if name not in siblings]
    if missing:
        raise RuntimeError(f"model repository is missing required files: {', '.join(missing)}")

    model_dir = destination_root / model_id.replace("/", "--")
    model_dir.mkdir(parents=True, exist_ok=True)
    files: list[dict[str, object]] = []
    for filename in REQUIRED_FILES:
        item = siblings[filename]
        expected_size = item.get("size")
        size = int(expected_size) if isinstance(expected_size, int) else None
        destination = model_dir / filename
        expected_sha256 = expected_digests[filename]
        reused = (
            destination.is_file()
            and (size is None or destination.stat().st_size == size)
            and sha256_file(destination) == expected_sha256
        )
        if not reused:
            quoted_model = urllib.parse.quote(model_id, safe="/")
            quoted_revision = urllib.parse.quote(resolved_revision, safe="")
            quoted_filename = urllib.parse.quote(filename, safe="")
            download_file(
                f"{HUGGING_FACE_RESOLVE}/{quoted_model}/resolve/{quoted_revision}/{quoted_filename}",
                destination,
                size,
            )
        actual_sha256 = sha256_file(destination)
        if actual_sha256 != expected_sha256:
            destination.unlink(missing_ok=True)
            raise RuntimeError(
                f"downloaded digest mismatch for {filename}: expected {expected_sha256}, got {actual_sha256}"
            )
        files.append({
            "name": filename,
            "bytes": destination.stat().st_size,
            "sha256": actual_sha256,
            "reused": reused,
        })

    manifest = {
        "schema_version": 1,
        "model_id": model_id,
        "requested_revision": requested_revision,
        "revision": resolved_revision,
        "files": files,
    }
    (model_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return {"status": "ok", "model_dir": str(model_dir), **manifest}


def main() -> int:
    parser = argparse.ArgumentParser(description="Download a compact faster-whisper model without a second package cache")
    parser.add_argument("--model", required=True)
    parser.add_argument("--destination", required=True)
    parser.add_argument("--revision", default="main")
    args = parser.parse_args()

    try:
        payload = prepare_model(args.model, Path(args.destination), revision=args.revision)
    except Exception as exc:
        print(json.dumps({"status": "failed", "error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
