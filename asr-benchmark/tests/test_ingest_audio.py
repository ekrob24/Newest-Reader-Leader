#!/usr/bin/env python3
import csv
import json
import math
import struct
import sys
import tempfile
import unittest
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import ingest_audio as ingest  # noqa: E402


class AudioIngestionTests(unittest.TestCase):
    def write_audio(self, path: Path, seconds: float = 1.0) -> None:
        sample_rate = 8000
        frames = []
        for index in range(int(sample_rate * seconds)):
            value = int(2000 * math.sin(2 * math.pi * 220 * index / sample_rate))
            frames.append(struct.pack("<h", value))
        with wave.open(str(path), "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(sample_rate)
            handle.writeframes(b"".join(frames))

    def manifest_row(self, audio_path: Path) -> dict[str, str]:
        return {
            "audio_path": str(audio_path), "session_id": "sess_test_001", "speaker_id": "spk_test_001",
            "split": "development", "cohort": "selected_regional", "age_min_years": "7", "age_max_years": "9",
            "consent_verified": "true", "assent_verified": "true", "accent_label_source": "guardian_report",
            "passage_id": "passage_test", "reference_text": "Fox ran.", "session_started_at": "2026-09-04T09:00:00Z",
            "config_version": "test-config-v1", "device_class": "laptop_builtin", "environment": "quiet_room",
            "microphone_check_passed": "true", "overlapping_speech_detected": "false", "estimated_snr_db": "24",
            "transcript_path": "", "asr_free_transcript": "fox ran", "asr_provider": "fixture",
            "asr_model": "fixture-v1", "asr_mode": "free", "notes": "synthetic test tone; not a child recording",
        }

    def write_manifest(self, path: Path, row: dict[str, str]) -> None:
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(row))
            writer.writeheader()
            writer.writerow(row)

    def test_normalizes_audio_and_emits_valid_session(self):
        with tempfile.TemporaryDirectory() as temp:
            temp_dir = Path(temp)
            raw_audio = temp_dir / "raw_name_not_copied.wav"
            self.write_audio(raw_audio)
            manifest = temp_dir / "manifest.csv"
            self.write_manifest(manifest, self.manifest_row(raw_audio))
            output = temp_dir / "output"
            sessions = ingest.build_sessions(manifest, output, 16000, None, None, False)
            schema = ingest.load_json(ROOT / "schema" / "session.schema.json")
            ingest.validate_rows(sessions, schema, "sessions")
            self.assertEqual(len(sessions), 1)
            self.assertEqual(sessions[0]["audio"]["sample_rate_hz"], 16000)
            self.assertEqual(sessions[0]["audio"]["channels"], 1)
            self.assertEqual(sessions[0]["audio"]["uri"], "audio/sess_test_001.wav")
            self.assertEqual(len(sessions[0]["audio"]["sha256"]), 64)
            self.assertTrue((output / "audio" / "sess_test_001.wav").is_file())

    def test_refuses_missing_consent(self):
        with tempfile.TemporaryDirectory() as temp:
            temp_dir = Path(temp)
            raw_audio = temp_dir / "raw.wav"
            self.write_audio(raw_audio)
            row = self.manifest_row(raw_audio)
            row["consent_verified"] = "false"
            manifest = temp_dir / "manifest.csv"
            self.write_manifest(manifest, row)
            with self.assertRaisesRegex(ValueError, "consent_verified"):
                ingest.build_sessions(manifest, temp_dir / "output", 16000, None, None, False)

    def test_annotation_template_covers_reference_tokens(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "template.csv"
            sessions = [{"session_id": "sess_test_001", "reference_text": "Fox ran."}]
            ingest.write_annotation_template(path, sessions)
            with path.open(newline="", encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual([row["expected_token"] for row in rows], ["Fox", "ran"])
            self.assertEqual([row["token_index"] for row in rows], ["0", "1"])

    def test_merges_reviewed_event_without_inventing_gold_label(self):
        with tempfile.TemporaryDirectory() as temp:
            temp_dir = Path(temp)
            annotation = temp_dir / "events.jsonl"
            record = {
                "event_id": "evt_test_001", "session_id": "sess_test_001", "token_index": 0,
                "expected_token": "Fox", "gold_event": "correct", "gold_should_intervene": False,
                "adjudication": {"status": "double_label_agreed", "reviewer_count": 2, "literacy_reviewed": True, "phonetics_reviewed": False},
                "audio_span": {"start_ms": 0, "end_ms": 500},
                "asr": {"hypotheses": [{"rank": 1, "text": "fox", "confidence": 0.97}], "partial_or_final": "final", "stable_result": True, "alternatives_conflict": False, "timings_reliable": True, "confidence": 0.97},
                "alignment_event": "match", "accent_variant": {"status": "not_applicable", "variant_id": None},
                "latency": {"first_partial_ms": 100, "stable_result_ms": 400, "final_result_ms": 500, "decision_ms": 520, "prompt_ms": None, "model_ms": None},
                "decision": {"action": "STAY_SILENT", "reason_code": "MATCH", "state": "STAY_SILENT", "prompt_issued_count": 0, "model_issued_count": 0, "review_flagged": False},
                "reviewer_override": None,
            }
            annotation.write_text(json.dumps(record) + "\n", encoding="utf-8")
            sessions = [{
                "session_id": "sess_test_001", "speaker_id": "spk_test_001", "split": "development",
                "cohort": "selected_regional", "passage_id": "passage_test", "config_version": "test-config-v1",
            }]
            events = ingest.merge_events(annotation, sessions)
            schema = ingest.load_json(ROOT / "schema" / "event.schema.json")
            ingest.validate_rows(events, schema, "events")
            self.assertEqual(events[0]["gold_event"], "correct")
            self.assertEqual(events[0]["speaker_id"], "spk_test_001")


if __name__ == "__main__":
    unittest.main()
