#!/usr/bin/env python3
"""Ingest raw child-read-aloud recordings into Reader-Leader benchmark JSONL.

The script performs deterministic local audio normalization and metadata mapping.
It never infers a child's accent and never invents human gold event labels.
Final event JSONL is emitted only by merging reviewer annotations with captured
ASR/state-machine evidence supplied in --event-annotations.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import shlex
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from jsonschema import Draft202012Validator, FormatChecker

ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{3,80}$")
REQUIRED_MANIFEST_FIELDS = {
    "audio_path", "session_id", "speaker_id", "split", "cohort",
    "age_min_years", "age_max_years", "consent_verified", "assent_verified",
    "accent_label_source", "passage_id", "reference_text", "session_started_at",
    "config_version", "device_class", "environment", "microphone_check_passed",
    "overlapping_speech_detected",
}
BOOL_TRUE = {"1", "true", "yes", "y"}
BOOL_FALSE = {"0", "false", "no", "n"}


def parse_bool(value: Any, field: str) -> bool:
    if isinstance(value, bool):
        return value
    normalized = str(value).strip().lower()
    if normalized in BOOL_TRUE:
        return True
    if normalized in BOOL_FALSE:
        return False
    raise ValueError(f"{field}: expected true/false, got {value!r}")


def parse_optional_float(value: Any) -> float | None:
    if value is None or str(value).strip() == "":
        return None
    return float(value)


def parse_iso_datetime(value: str, field: str) -> str:
    text = value.strip()
    if not text:
        raise ValueError(f"{field}: timestamp is required")
    candidate = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError as exc:
        raise ValueError(f"{field}: invalid ISO-8601 timestamp {text!r}") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{field}: timestamp must include a timezone")
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{line_no}: invalid JSON: {exc}") from exc
            row["__line__"] = line_no
            rows.append(row)
    return rows


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            clean = {key: value for key, value in row.items() if key != "__line__"}
            handle.write(json.dumps(clean, ensure_ascii=False, separators=(",", ":")) + "\n")


def validate_rows(rows: Iterable[dict[str, Any]], schema: dict[str, Any], source_name: str) -> None:
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors: list[str] = []
    for index, row in enumerate(rows, 1):
        clean = {key: value for key, value in row.items() if key != "__line__"}
        for error in sorted(validator.iter_errors(clean), key=lambda item: list(item.path)):
            location = ".".join(str(part) for part in error.path) or "$"
            errors.append(f"{source_name}:{index}:{location}: {error.message}")
    if errors:
        raise ValueError("Schema validation failed:\n" + "\n".join(f"- {item}" for item in errors))


def read_manifest(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        fields = set(reader.fieldnames or [])
        missing = sorted(REQUIRED_MANIFEST_FIELDS - fields)
        if missing:
            raise ValueError(f"{path}: missing required columns: {', '.join(missing)}")
        rows = [dict(row) for row in reader]
    if not rows:
        raise ValueError(f"{path}: manifest contains no recordings")
    return rows


def ensure_tools() -> None:
    missing = [tool for tool in ("ffmpeg", "ffprobe") if shutil.which(tool) is None]
    if missing:
        raise RuntimeError(f"Missing required system tools: {', '.join(missing)}")


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=True, text=True, capture_output=True)


def probe_audio(path: Path) -> dict[str, Any]:
    result = run([
        "ffprobe", "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=sample_rate,channels,duration:format=duration",
        "-of", "json", str(path),
    ])
    payload = json.loads(result.stdout)
    streams = payload.get("streams", [])
    if not streams:
        raise ValueError(f"{path}: no audio stream found")
    stream = streams[0]
    duration_text = stream.get("duration") or payload.get("format", {}).get("duration")
    if duration_text is None:
        raise ValueError(f"{path}: duration is unavailable")
    return {
        "sample_rate_hz": int(stream["sample_rate"]),
        "channels": int(stream["channels"]),
        "duration_ms": max(1, round(float(duration_text) * 1000)),
    }


def normalize_audio(source: Path, destination: Path, sample_rate_hz: int) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
        "-map_metadata", "-1", "-vn", "-ac", "1", "-ar", str(sample_rate_hz),
        "-c:a", "pcm_s16le", str(destination),
    ])


def detect_clipping(path: Path) -> bool:
    process = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "volumedetect", "-f", "null", "-"],
        text=True, capture_output=True, check=False,
    )
    match = re.search(r"max_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB", process.stderr)
    if not match or match.group(1) == "-inf":
        return False
    return float(match.group(1)) >= -0.1


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def resolve_input_path(value: str, manifest_dir: Path) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = manifest_dir / path
    return path.resolve()


def load_asr_result_map(path: Path | None) -> dict[str, dict[str, Any]]:
    if path is None:
        return {}
    result: dict[str, dict[str, Any]] = {}
    for row in load_jsonl(path):
        session_id = str(row.get("session_id", ""))
        if not session_id:
            raise ValueError(f"{path}:{row['__line__']}: session_id is required")
        if session_id in result:
            raise ValueError(f"{path}: duplicate ASR result for {session_id}")
        result[session_id] = {key: value for key, value in row.items() if key != "__line__"}
    return result


def call_asr_adapter(command_template: str, audio_path: Path, session_id: str) -> dict[str, Any]:
    parts = shlex.split(command_template)
    if not parts:
        raise ValueError("--asr-command is empty")
    command = [part.replace("{audio}", str(audio_path)).replace("{session_id}", session_id) for part in parts]
    result = run(command)
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise ValueError(f"ASR adapter for {session_id} must write one JSON object to stdout") from exc
    if not isinstance(payload, dict) or "transcript" not in payload:
        raise ValueError(f"ASR adapter for {session_id} must return transcript/provider/model/mode fields")
    return payload


def asr_for_row(
    row: dict[str, str],
    manifest_dir: Path,
    canonical_audio: Path,
    asr_results: dict[str, dict[str, Any]],
    asr_command: str | None,
    allow_missing_transcript: bool,
) -> dict[str, Any]:
    session_id = row["session_id"].strip()
    if session_id in asr_results:
        payload = asr_results[session_id]
        transcript = str(payload.get("transcript", payload.get("asr_free_transcript", "")))
        return {
            "transcript": transcript,
            "provider": str(payload.get("provider", payload.get("asr_provider", "external_result"))),
            "model": str(payload.get("model", payload.get("asr_model", "unknown"))),
            "mode": str(payload.get("mode", payload.get("asr_mode", "free"))),
        }
    transcript_path = row.get("transcript_path", "").strip()
    inline_transcript = row.get("asr_free_transcript", "").strip()
    if transcript_path:
        path = resolve_input_path(transcript_path, manifest_dir)
        if not path.is_file():
            raise FileNotFoundError(f"{session_id}: transcript_path does not exist: {path}")
        inline_transcript = path.read_text(encoding="utf-8").strip()
    if inline_transcript:
        return {
            "transcript": inline_transcript,
            "provider": row.get("asr_provider", "provided_transcript").strip() or "provided_transcript",
            "model": row.get("asr_model", "provided_transcript").strip() or "provided_transcript",
            "mode": row.get("asr_mode", "free").strip() or "free",
        }
    if asr_command:
        payload = call_asr_adapter(asr_command, canonical_audio, session_id)
        return {
            "transcript": str(payload["transcript"]),
            "provider": str(payload.get("provider", "adapter")),
            "model": str(payload.get("model", "unknown")),
            "mode": str(payload.get("mode", "free")),
        }
    if allow_missing_transcript:
        return {"transcript": "", "provider": "not_run", "model": "not_run", "mode": "free"}
    raise ValueError(
        f"{session_id}: no transcript found; provide --asr-results, transcript_path, "
        "asr_free_transcript, --asr-command, or --allow-missing-transcript"
    )


def validate_manifest_row(row: dict[str, str], row_number: int) -> None:
    prefix = f"manifest row {row_number}"
    for field in ("session_id", "speaker_id"):
        value = row[field].strip()
        if not ID_PATTERN.fullmatch(value):
            raise ValueError(f"{prefix}: invalid {field}; use 3–80 pseudonymous letters/digits/._-")
    if row["split"].strip() not in {"development", "holdout"}:
        raise ValueError(f"{prefix}: split must be development or holdout")
    if row["cohort"].strip() not in {"selected_regional", "comparison"}:
        raise ValueError(f"{prefix}: cohort must be selected_regional or comparison")
    if not parse_bool(row["consent_verified"], "consent_verified"):
        raise ValueError(f"{prefix}: consent_verified must be true before ingestion")
    if not parse_bool(row["assent_verified"], "assent_verified"):
        raise ValueError(f"{prefix}: assent_verified must be true before ingestion")
    min_age, max_age = int(row["age_min_years"]), int(row["age_max_years"])
    if not 4 <= min_age <= max_age <= 17:
        raise ValueError(f"{prefix}: age band must satisfy 4 <= min <= max <= 17")
    parse_iso_datetime(row["session_started_at"], "session_started_at")


def build_sessions(
    manifest_path: Path,
    output_dir: Path,
    sample_rate_hz: int,
    asr_results_path: Path | None,
    asr_command: str | None,
    allow_missing_transcript: bool,
) -> list[dict[str, Any]]:
    rows = read_manifest(manifest_path)
    asr_results = load_asr_result_map(asr_results_path)
    output_audio_dir = output_dir / "audio"
    sessions: list[dict[str, Any]] = []
    seen_sessions: set[str] = set()
    source_dir = manifest_path.parent.resolve()

    for row_number, row in enumerate(rows, 2):
        validate_manifest_row(row, row_number)
        session_id = row["session_id"].strip()
        if session_id in seen_sessions:
            raise ValueError(f"manifest row {row_number}: duplicate session_id {session_id}")
        seen_sessions.add(session_id)
        source_audio = resolve_input_path(row["audio_path"], source_dir)
        if not source_audio.is_file():
            raise FileNotFoundError(f"{session_id}: audio file does not exist: {source_audio}")
        canonical_audio = output_audio_dir / f"{session_id}.wav"
        normalize_audio(source_audio, canonical_audio, sample_rate_hz)
        audio_info = probe_audio(canonical_audio)
        asr = asr_for_row(row, source_dir, canonical_audio, asr_results, asr_command, allow_missing_transcript)
        session = {
            "schema_version": "1.0.0",
            "session_id": session_id,
            "speaker_id": row["speaker_id"].strip(),
            "split": row["split"].strip(),
            "cohort": row["cohort"].strip(),
            "age_band": {"min_years": int(row["age_min_years"]), "max_years": int(row["age_max_years"])},
            "consent_verified": True,
            "assent_verified": True,
            "accent_label_source": row["accent_label_source"].strip(),
            "passage_id": row["passage_id"].strip(),
            "reference_text": row["reference_text"].strip(),
            "asr_free_transcript": asr["transcript"],
            "asr_provider": asr["provider"],
            "asr_model": asr["model"],
            "asr_mode": asr["mode"],
            "audio": {
                "uri": f"audio/{canonical_audio.name}",
                "sha256": sha256_file(canonical_audio),
                "sample_rate_hz": audio_info["sample_rate_hz"],
                "channels": audio_info["channels"],
                "duration_ms": audio_info["duration_ms"],
                "device_class": row["device_class"].strip(),
                "environment": row["environment"].strip(),
            },
            "capture": {
                "microphone_check_passed": parse_bool(row["microphone_check_passed"], "microphone_check_passed"),
                "clipping_detected": detect_clipping(canonical_audio),
                "overlapping_speech_detected": parse_bool(row["overlapping_speech_detected"], "overlapping_speech_detected"),
                "estimated_snr_db": parse_optional_float(row.get("estimated_snr_db")),
            },
            "session_started_at": parse_iso_datetime(row["session_started_at"], "session_started_at"),
            "config_version": row["config_version"].strip(),
            "notes": row.get("notes", "").strip(),
        }
        sessions.append(session)
    return sessions


def write_annotation_template(path: Path, sessions: list[dict[str, Any]]) -> None:
    fields = [
        "session_id", "event_id", "token_index", "expected_token", "gold_event",
        "gold_should_intervene", "adjudication_status", "reviewer_count",
        "literacy_reviewed", "phonetics_reviewed", "audio_start_ms", "audio_end_ms",
        "alignment_event", "accent_variant_status", "variant_id", "review_notes",
    ]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for session in sessions:
            tokens = re.findall(r"\b[\w']+\b", session["reference_text"], flags=re.UNICODE)
            for token_index, token in enumerate(tokens):
                writer.writerow({
                    "session_id": session["session_id"],
                    "event_id": f"{session['session_id']}.token.{token_index:04d}",
                    "token_index": token_index,
                    "expected_token": token,
                })


def merge_events(annotation_path: Path, sessions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    session_map = {session["session_id"]: session for session in sessions}
    events: list[dict[str, Any]] = []
    for annotation in load_jsonl(annotation_path):
        clean = {key: value for key, value in annotation.items() if key != "__line__"}
        session_id = str(clean.get("session_id", ""))
        session = session_map.get(session_id)
        if not session:
            raise ValueError(f"{annotation_path}:{annotation['__line__']}: unknown session_id {session_id!r}")
        inherited = {
            "schema_version": "1.0.0",
            "session_id": session_id,
            "speaker_id": session["speaker_id"],
            "split": session["split"],
            "cohort": session["cohort"],
            "passage_id": session["passage_id"],
            "config_version": session["config_version"],
        }
        for field, value in inherited.items():
            if field in clean and clean[field] != value:
                raise ValueError(f"{annotation_path}:{annotation['__line__']}: {field} conflicts with session record")
        event = {**clean, **inherited}
        missing = [field for field in ("event_id", "gold_event", "gold_should_intervene", "adjudication", "audio_span", "asr", "alignment_event", "accent_variant", "latency", "decision") if field not in event]
        if missing:
            raise ValueError(
                f"{annotation_path}:{annotation['__line__']}: missing reviewed event/evidence fields: {', '.join(missing)}"
            )
        events.append(event)
    return events


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Normalize raw recordings and emit Reader-Leader session/event JSONL.",
        epilog=(
            "ASR is local/opt-in: provide --asr-results, transcript fields in the manifest, "
            "or an adapter command that writes JSON to stdout. Accent labels are never inferred."
        ),
    )
    parser.add_argument("--manifest", type=Path, required=True, help="CSV containing one row per raw recording")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--schema-dir", type=Path, default=Path(__file__).resolve().parents[1] / "schema")
    parser.add_argument("--sample-rate-hz", type=int, default=16000)
    parser.add_argument("--asr-results", type=Path, help="Optional JSONL keyed by session_id")
    parser.add_argument("--asr-command", help="Optional no-shell adapter command; use {audio} and {session_id} placeholders")
    parser.add_argument("--allow-missing-transcript", action="store_true", help="Ingestion-only mode; records an empty transcript as provider not_run")
    parser.add_argument("--event-annotations", type=Path, help="Reviewed event/evidence JSONL to merge into events.jsonl")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        ensure_tools()
        if args.sample_rate_hz < 16000:
            raise ValueError("--sample-rate-hz must be at least 16000")
        output_dir = args.output_dir.resolve()
        output_dir.mkdir(parents=True, exist_ok=True)
        sessions = build_sessions(
            args.manifest.resolve(), output_dir, args.sample_rate_hz,
            args.asr_results.resolve() if args.asr_results else None,
            args.asr_command, args.allow_missing_transcript,
        )
        session_schema = load_json(args.schema_dir / "session.schema.json")
        validate_rows(sessions, session_schema, "sessions")
        write_jsonl(output_dir / "sessions.jsonl", sessions)
        write_annotation_template(output_dir / "event_annotation_template.csv", sessions)

        if args.event_annotations:
            events = merge_events(args.event_annotations.resolve(), sessions)
            event_schema = load_json(args.schema_dir / "event.schema.json")
            validate_rows(events, event_schema, "events")
            write_jsonl(output_dir / "events.jsonl", events)
            print(f"Wrote {len(sessions)} session(s) and {len(events)} reviewed event(s) to {output_dir}")
        else:
            print(
                f"Wrote {len(sessions)} session(s) and an annotation template to {output_dir}. "
                "No events.jsonl was created because human-reviewed --event-annotations were not supplied."
            )
        return 0
    except (ValueError, RuntimeError, FileNotFoundError, subprocess.CalledProcessError) as exc:
        print(f"Ingestion failed: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
