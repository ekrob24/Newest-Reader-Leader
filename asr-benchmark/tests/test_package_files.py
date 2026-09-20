#!/usr/bin/env python3
import re
import unittest
import urllib.parse
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


class PackageIntegrityTests(unittest.TestCase):
    def test_local_markdown_references_resolve(self):
        markdown_files = [ROOT / "README.md", ROOT / "ACCEPTANCE_GATES.md", ROOT / "INGESTION.md", ROOT / "output" / "example" / "summary.md"]
        for markdown in markdown_files:
            text = markdown.read_text(encoding="utf-8")
            for _, url in re.findall(r"^\[(\d+)\]:\s+(\S+)", text, flags=re.MULTILINE):
                if "://" in url:
                    continue
                target = (markdown.parent / urllib.parse.unquote(url)).resolve()
                self.assertTrue(target.exists(), f"broken local reference in {markdown}: {url}")

    def test_required_stage_gates_are_present(self):
        config = yaml.safe_load((ROOT / "config" / "benchmark.yaml").read_text(encoding="utf-8"))
        self.assertEqual(config["prototype_gates"]["fcr_overall_max"], 0.02)
        self.assertEqual(config["prototype_gates"]["fcr_per_cohort_max"], 0.03)
        self.assertEqual(config["prototype_gates"]["variant_acceptance_min"], 0.95)
        self.assertEqual(config["prototype_gates"]["accent_fcr_gap_max"], 0.01)
        self.assertEqual(config["evidence_gates"]["min_total_speakers_all_splits"], 24)
        self.assertEqual(config["evidence_gates"]["min_holdout_non_correct_events"], 200)
        self.assertTrue(config["evidence_gates"]["require_all_gates_evaluable"])

    def test_fixture_data_contains_no_audio_recording(self):
        audio_extensions = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".webm"}
        recordings = [path for path in (ROOT / "data").rglob("*") if path.suffix.lower() in audio_extensions]
        self.assertEqual(recordings, [], "the downloadable fixtures must not contain real or synthetic audio")

    def test_container_definitions_are_present(self):
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
        compose = yaml.safe_load((ROOT / "compose.yaml").read_text(encoding="utf-8"))
        self.assertIn("ffmpeg", dockerfile)
        self.assertIn("python3", dockerfile)
        self.assertIn("benchmark", compose["services"])
        self.assertEqual(compose["services"]["benchmark"]["image"], "readerleader-asr-evaluation:1.1")


if __name__ == "__main__":
    unittest.main()
