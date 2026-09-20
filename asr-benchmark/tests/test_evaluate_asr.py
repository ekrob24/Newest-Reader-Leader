#!/usr/bin/env python3
import copy
import json
import sys
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import evaluate_asr as evaluator  # noqa: E402


class BenchmarkEvaluatorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = yaml.safe_load((ROOT / "config" / "benchmark.yaml").read_text())
        cls.sessions = evaluator.clean_rows(evaluator.load_jsonl(ROOT / "data" / "example_sessions.jsonl"))
        cls.events = evaluator.clean_rows(evaluator.load_jsonl(ROOT / "data" / "example_events.jsonl"))
        cls.variants = evaluator.clean_rows(evaluator.load_jsonl(ROOT / "data" / "example_variants.jsonl"))

    def test_edit_counts_and_normalization(self):
        ref = evaluator.normalize("The fox ran.", self.config)
        hyp = evaluator.normalize("the fox run", self.config)
        self.assertEqual(evaluator.edit_counts(ref, hyp), (1, 0, 0))

    def test_fixture_metrics_keep_wer_separate_from_accent_acceptance(self):
        result = evaluator.evaluate(self.sessions, self.events, self.config, "holdout")
        self.assertGreater(result["by_cohort"]["selected_regional"]["wer"]["rate"], 0)
        self.assertEqual(result["overall"]["fcr"]["rate"], 0)
        self.assertEqual(result["overall"]["variant_acceptance_rate"], 1)
        self.assertEqual(result["accent_fcr_gap"], 0)

    def test_synthetic_fixture_fails_child_evidence_sufficiency(self):
        metrics = evaluator.evaluate(self.sessions, self.events, self.config, "holdout")
        gates = evaluator.gate_results(metrics, self.config)
        self.assertFalse(gates["all_split_speakers"]["pass"])
        self.assertFalse(gates["holdout_non_correct_events"]["pass"])
        self.assertFalse(gates["reference_token_coverage"]["pass"])

    def test_false_correction_is_counted_on_correct_event(self):
        events = copy.deepcopy(self.events)
        target = next(event for event in events if event["event_id"] == "evt_cmp_house")
        target["decision"].update({"action": "PROMPT", "state": "PROMPTED", "reason_code": "CONFIRMED_NON_VARIANT_MISMATCH", "prompt_issued_count": 1})
        target["latency"]["prompt_ms"] = 700
        result = evaluator.evaluate(self.sessions, events, self.config, "holdout")
        self.assertGreater(result["overall"]["fcr"]["rate"], 0)
        self.assertLess(result["overall"]["safe_stay_silent_rate"], 1)

    def test_approved_variant_cannot_trigger_correction(self):
        events = copy.deepcopy(self.events)
        target = next(event for event in events if event["event_id"] == "evt_reg_house")
        target["decision"].update({"action": "PROMPT", "state": "PROMPTED", "prompt_issued_count": 1})
        target["latency"]["prompt_ms"] = 800
        errors, violations = evaluator.cross_validate(self.sessions, events, self.variants, self.config)
        self.assertFalse(errors)
        self.assertTrue(any("approved accent variant" in item for item in violations))

    def test_model_requires_prompt(self):
        events = copy.deepcopy(self.events)
        target = next(event for event in events if event["event_id"] == "evt_cmp_ran")
        target["decision"]["prompt_issued_count"] = 0
        errors, violations = evaluator.cross_validate(self.sessions, events, self.variants, self.config)
        self.assertFalse(errors)
        self.assertTrue(any("MODEL issued without prior PROMPT" in item for item in violations))

    def test_fixture_schemas(self):
        cases = [
            (ROOT / "data" / "example_sessions.jsonl", ROOT / "schema" / "session.schema.json"),
            (ROOT / "data" / "example_events.jsonl", ROOT / "schema" / "event.schema.json"),
            (ROOT / "data" / "example_variants.jsonl", ROOT / "schema" / "pronunciation-variant.schema.json"),
        ]
        for data_path, schema_path in cases:
            rows = evaluator.load_jsonl(data_path)
            schema = json.loads(schema_path.read_text())
            self.assertEqual(evaluator.validate_rows(rows, schema, data_path), [])


if __name__ == "__main__":
    unittest.main()
