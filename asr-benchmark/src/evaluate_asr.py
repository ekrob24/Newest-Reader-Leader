#!/usr/bin/env python3
"""Reader-Leader Stage 4 benchmark evaluator.

Validates session/event/variant JSONL, preserves free-transcript WER, and computes
accent-stratified false-correction, intervention, abstention, and latency metrics.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

import yaml
from jsonschema import Draft202012Validator, FormatChecker

COHORTS = ("selected_regional", "comparison")


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


def load_schema(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_rows(rows: list[dict[str, Any]], schema: dict[str, Any], source: Path) -> list[str]:
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors: list[str] = []
    for row in rows:
        line_no = row.get("__line__", "?")
        candidate = {k: v for k, v in row.items() if k != "__line__"}
        for err in sorted(validator.iter_errors(candidate), key=lambda e: list(e.path)):
            loc = ".".join(str(part) for part in err.path) or "$"
            errors.append(f"{source}:{line_no}:{loc}: {err.message}")
    return errors


def clean_rows(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{k: v for k, v in row.items() if k != "__line__"} for row in rows]


def normalize(text: str, config: dict[str, Any]) -> list[str]:
    settings = config.get("normalization", {})
    if settings.get("lowercase", True):
        text = text.lower()
    if settings.get("preserve_apostrophes", True):
        text = re.sub(r"[^\w\s']", " ", text, flags=re.UNICODE)
    else:
        text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    return [token for token in text.split() if token]


def edit_counts(reference: list[str], hypothesis: list[str]) -> tuple[int, int, int]:
    """Return substitutions, deletions, insertions using deterministic DP."""
    rows, cols = len(reference) + 1, len(hypothesis) + 1
    dp: list[list[tuple[int, int, int, int]]] = [[(0, 0, 0, 0) for _ in range(cols)] for _ in range(rows)]
    for i in range(1, rows):
        dp[i][0] = (i, 0, i, 0)
    for j in range(1, cols):
        dp[0][j] = (j, 0, 0, j)
    for i in range(1, rows):
        for j in range(1, cols):
            if reference[i - 1] == hypothesis[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
                continue
            sub = dp[i - 1][j - 1]
            delete = dp[i - 1][j]
            insert = dp[i][j - 1]
            candidates = [
                (sub[0] + 1, sub[1] + 1, sub[2], sub[3]),
                (delete[0] + 1, delete[1], delete[2] + 1, delete[3]),
                (insert[0] + 1, insert[1], insert[2], insert[3] + 1),
            ]
            dp[i][j] = min(candidates, key=lambda value: (value[0], value[1] + value[2] + value[3], value[1], value[2]))
    _, substitutions, deletions, insertions = dp[-1][-1]
    return substitutions, deletions, insertions


def safe_div(num: int | float, den: int | float) -> float | None:
    return None if den == 0 else num / den


def wilson_interval(successes: int, total: int, z: float = 1.96) -> tuple[float | None, float | None]:
    if total == 0:
        return None, None
    p = successes / total
    denominator = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / denominator
    margin = z * math.sqrt((p * (1 - p) / total) + (z * z / (4 * total * total))) / denominator
    return max(0.0, centre - margin), min(1.0, centre + margin)


def percentile(values: list[int | float], probability: float) -> float | None:
    if not values:
        return None
    ordered = sorted(float(value) for value in values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def corrective(event: dict[str, Any]) -> bool:
    decision = event["decision"]
    return decision["prompt_issued_count"] > 0 or decision["model_issued_count"] > 0


def cross_validate(
    sessions: list[dict[str, Any]],
    events: list[dict[str, Any]],
    variants: list[dict[str, Any]],
    config: dict[str, Any],
) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    violations: list[str] = []
    session_ids: set[str] = set()
    event_ids: set[str] = set()
    variant_ids: set[str] = set()
    session_map: dict[str, dict[str, Any]] = {}

    for session in sessions:
        sid = session["session_id"]
        if sid in session_ids:
            errors.append(f"duplicate session_id: {sid}")
        session_ids.add(sid)
        session_map[sid] = session
        if session["age_band"]["min_years"] > session["age_band"]["max_years"]:
            errors.append(f"{sid}: age_band min_years exceeds max_years")
        if not session["consent_verified"] or not session["assent_verified"]:
            errors.append(f"{sid}: consent and assent must both be verified")

    split_by_speaker: dict[str, set[str]] = defaultdict(set)
    for session in sessions:
        split_by_speaker[session["speaker_id"]].add(session["split"])
    for speaker_id, splits in split_by_speaker.items():
        if len(splits) > 1:
            errors.append(f"speaker leakage: {speaker_id} appears in {sorted(splits)}")

    variants_by_id: dict[str, dict[str, Any]] = {}
    for variant in variants:
        vid = variant["variant_id"]
        if vid in variant_ids:
            errors.append(f"duplicate variant_id: {vid}")
        variant_ids.add(vid)
        variants_by_id[vid] = variant

    uncertainty = set(config["policy"]["uncertainty_reason_codes"])
    for event in events:
        eid = event["event_id"]
        if eid in event_ids:
            errors.append(f"duplicate event_id: {eid}")
        event_ids.add(eid)
        session = session_map.get(event["session_id"])
        if not session:
            errors.append(f"{eid}: unknown session_id {event['session_id']}")
            continue
        for field in ("speaker_id", "split", "cohort", "passage_id", "config_version"):
            if event[field] != session[field]:
                errors.append(f"{eid}: {field} does not match parent session")
        if event["audio_span"]["start_ms"] >= event["audio_span"]["end_ms"]:
            errors.append(f"{eid}: audio_span start_ms must be less than end_ms")
        if event["audio_span"]["end_ms"] > session["audio"]["duration_ms"]:
            errors.append(f"{eid}: audio_span exceeds session duration")

        latency = event["latency"]
        ordered_fields = ["first_partial_ms", "stable_result_ms", "final_result_ms"]
        ordered_values = [latency[name] for name in ordered_fields if latency[name] is not None]
        if ordered_values != sorted(ordered_values):
            errors.append(f"{eid}: ASR latency milestones are not monotonic")
        if event["asr"]["stable_result"] and latency["stable_result_ms"] is not None and latency["decision_ms"] < latency["stable_result_ms"]:
            errors.append(f"{eid}: decision precedes stable ASR result")
        if latency["prompt_ms"] is not None and latency["model_ms"] is not None and latency["model_ms"] < latency["prompt_ms"]:
            errors.append(f"{eid}: model latency precedes prompt latency")

        decision = event["decision"]
        is_corrective = corrective(event)
        if decision["model_issued_count"] > decision["prompt_issued_count"]:
            violations.append(f"{eid}: MODEL issued without prior PROMPT")
        if decision["action"] == "MODEL" and decision["model_issued_count"] != 1:
            violations.append(f"{eid}: MODEL action without model_issued_count=1")
        if decision["action"] == "PROMPT" and decision["prompt_issued_count"] != 1:
            violations.append(f"{eid}: PROMPT action without prompt_issued_count=1")
        if event["asr"]["partial_or_final"] == "partial" and not event["asr"]["stable_result"] and is_corrective:
            violations.append(f"{eid}: unstable partial triggered corrective action")
        if decision["reason_code"] in uncertainty and is_corrective:
            violations.append(f"{eid}: uncertainty reason triggered corrective action")
        if event["accent_variant"]["status"] == "approved":
            vid = event["accent_variant"]["variant_id"]
            if not vid or vid not in variants_by_id:
                errors.append(f"{eid}: approved variant_id is missing or unknown")
            elif variants_by_id[vid]["approval_status"] != "approved":
                errors.append(f"{eid}: referenced variant is not approved")
            if is_corrective:
                violations.append(f"{eid}: approved accent variant triggered corrective action")
        if event["gold_event"] == "valid_accent_variant" and event["accent_variant"]["status"] != "approved":
            errors.append(f"{eid}: gold valid_accent_variant lacks approved variant evidence")

    holdout_versions = {event["config_version"] for event in events if event["split"] == "holdout"}
    if len(holdout_versions) > 1:
        errors.append(f"holdout uses multiple config versions: {sorted(holdout_versions)}")
    return errors, violations


def metric_block(sessions: list[dict[str, Any]], events: list[dict[str, Any]], config: dict[str, Any]) -> dict[str, Any]:
    safe_gold = set(config["policy"]["safe_gold_events"])
    uncertainty = set(config["policy"]["uncertainty_reason_codes"])
    sub = dele = ins = ref_words = 0
    for session in sessions:
        reference = normalize(session["reference_text"], config)
        hypothesis = normalize(session["asr_free_transcript"], config)
        s, d, i = edit_counts(reference, hypothesis)
        sub += s
        dele += d
        ins += i
        ref_words += len(reference)

    safe_events = [event for event in events if event["gold_event"] in safe_gold]
    false_corrections = [event for event in safe_events if corrective(event)]
    corrective_events = [event for event in events if corrective(event)]
    true_corrective = [event for event in corrective_events if event["gold_should_intervene"]]
    gold_intervention = [event for event in events if event["gold_should_intervene"]]
    variants = [event for event in events if event["gold_event"] == "valid_accent_variant"]
    accepted_variants = [event for event in variants if not corrective(event) and event["accent_variant"]["status"] == "approved"]
    self_corrections = [event for event in events if event["gold_event"] == "self_correction"]
    premature = [event for event in self_corrections if corrective(event)]
    abstentions = [event for event in events if event["decision"]["review_flagged"] or event["decision"]["reason_code"] in uncertainty]
    non_correct_events = [event for event in events if event["gold_event"] not in safe_gold]
    events_by_session: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        events_by_session[event["session_id"]].append(event)
    double_annotated_session_ids = {
        session_id for session_id, session_events in events_by_session.items()
        if session_events and all(
            event["adjudication"]["reviewer_count"] >= 2
            and event["adjudication"]["status"] in {"double_label_agreed", "adjudicated"}
            for event in session_events
        )
    }
    complete_reference_sessions = 0
    for session in sessions:
        required_indices = set(range(len(normalize(session["reference_text"], config))))
        covered_indices = {
            event["token_index"] for event in events
            if event["session_id"] == session["session_id"] and event["token_index"] is not None
        }
        if required_indices.issubset(covered_indices):
            complete_reference_sessions += 1
    traceable_corrective = [
        event for event in corrective_events
        if event["expected_token"] is not None
        and event["audio_span"]["end_ms"] > event["audio_span"]["start_ms"]
        and event["asr"]["confidence"] is not None
        and bool(event["decision"]["reason_code"])
        and event["latency"]["decision_ms"] is not None
    ]

    fcr = safe_div(len(false_corrections), len(safe_events))
    fcr_low, fcr_high = wilson_interval(len(false_corrections), len(safe_events))
    latencies = {
        "first_partial_ms": [event["latency"]["first_partial_ms"] for event in events if event["latency"]["first_partial_ms"] is not None],
        "stable_result_ms": [event["latency"]["stable_result_ms"] for event in events if event["latency"]["stable_result_ms"] is not None],
        "final_result_ms": [event["latency"]["final_result_ms"] for event in events if event["latency"]["final_result_ms"] is not None],
        "decision_ms": [event["latency"]["decision_ms"] for event in events],
        "prompt_ms": [event["latency"]["prompt_ms"] for event in events if event["latency"]["prompt_ms"] is not None],
        "model_ms": [event["latency"]["model_ms"] for event in events if event["latency"]["model_ms"] is not None],
    }
    return {
        "counts": {
            "sessions": len(sessions),
            "speakers": len({session["speaker_id"] for session in sessions}),
            "events": len(events),
            "safe_events": len(safe_events),
            "false_corrections": len(false_corrections),
            "corrective_events": len(corrective_events),
            "gold_intervention_events": len(gold_intervention),
            "valid_accent_variants": len(variants),
            "abstentions": len(abstentions),
            "non_correct_events": len(non_correct_events),
            "double_annotated_sessions": len(double_annotated_session_ids),
            "complete_reference_sessions": complete_reference_sessions,
            "traceable_corrective_events": len(traceable_corrective),
        },
        "wer": {
            "reference_words": ref_words,
            "substitutions": sub,
            "deletions": dele,
            "insertions": ins,
            "rate": safe_div(sub + dele + ins, ref_words),
        },
        "fcr": {"rate": fcr, "lower_95": fcr_low, "upper_95": fcr_high},
        "false_action_share": safe_div(len(false_corrections), len(corrective_events)),
        "safe_stay_silent_rate": safe_div(len(safe_events) - len(false_corrections), len(safe_events)),
        "corrective_action_precision": safe_div(len(true_corrective), len(corrective_events)),
        "corrective_action_recall": safe_div(len(true_corrective), len(gold_intervention)),
        "variant_acceptance_rate": safe_div(len(accepted_variants), len(variants)),
        "premature_prompt_rate": safe_div(len(premature), len(self_corrections)),
        "abstention_rate": safe_div(len(abstentions), len(events)),
        "double_annotated_session_fraction": safe_div(len(double_annotated_session_ids), len(sessions)),
        "reference_token_coverage": safe_div(complete_reference_sessions, len(sessions)),
        "corrective_action_traceability": safe_div(len(traceable_corrective), len(corrective_events)),
        "latency": {
            key: {"count": len(values), "p50_ms": percentile(values, 0.50), "p95_ms": percentile(values, 0.95)}
            for key, values in latencies.items()
        },
    }


def evaluate(sessions: list[dict[str, Any]], events: list[dict[str, Any]], config: dict[str, Any], split: str) -> dict[str, Any]:
    selected_sessions = [session for session in sessions if session["split"] == split]
    selected_ids = {session["session_id"] for session in selected_sessions}
    selected_events = [event for event in events if event["split"] == split and event["session_id"] in selected_ids]
    overall = metric_block(selected_sessions, selected_events, config)
    by_cohort: dict[str, Any] = {}
    for cohort in COHORTS:
        cohort_sessions = [session for session in selected_sessions if session["cohort"] == cohort]
        cohort_ids = {session["session_id"] for session in cohort_sessions}
        cohort_events = [event for event in selected_events if event["session_id"] in cohort_ids]
        by_cohort[cohort] = metric_block(cohort_sessions, cohort_events, config)
    regional_fcr = by_cohort["selected_regional"]["fcr"]["rate"]
    comparison_fcr = by_cohort["comparison"]["fcr"]["rate"]
    accent_gap = None if regional_fcr is None or comparison_fcr is None else abs(regional_fcr - comparison_fcr)
    all_split_speakers = len({session["speaker_id"] for session in sessions})
    all_split_speakers_by_cohort = {
        cohort: len({session["speaker_id"] for session in sessions if session["cohort"] == cohort})
        for cohort in COHORTS
    }
    development_speakers_by_cohort = {
        cohort: len({session["speaker_id"] for session in sessions if session["cohort"] == cohort and session["split"] == "development"})
        for cohort in COHORTS
    }
    holdout_speakers_by_cohort = {
        cohort: len({session["speaker_id"] for session in sessions if session["cohort"] == cohort and session["split"] == "holdout"})
        for cohort in COHORTS
    }
    return {
        "split": split,
        "overall": overall,
        "by_cohort": by_cohort,
        "accent_fcr_gap": accent_gap,
        "evidence": {
            "all_split_speakers": all_split_speakers,
            "all_split_speakers_by_cohort": all_split_speakers_by_cohort,
            "development_speakers_by_cohort": development_speakers_by_cohort,
            "holdout_speakers_by_cohort": holdout_speakers_by_cohort,
            "holdout_non_correct_events": overall["counts"]["non_correct_events"],
        },
    }


def gate_results(metrics: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    gates = config["prototype_gates"]
    evidence_gates = config["evidence_gates"]
    overall = metrics["overall"]
    results: dict[str, Any] = {}

    def gate(name: str, value: float | None, comparator: str, threshold: float, kind: str = "rate") -> None:
        if value is None:
            results[name] = {"pass": None, "value": None, "operator": comparator, "threshold": threshold, "kind": kind}
        else:
            if comparator == "<=":
                passed = value <= threshold
            elif comparator == ">=":
                passed = value >= threshold
            elif comparator == "==":
                passed = value == threshold
            else:
                raise ValueError(f"Unsupported gate comparator: {comparator}")
            results[name] = {"pass": passed, "value": value, "operator": comparator, "threshold": threshold, "kind": kind}

    gate("fcr_overall", overall["fcr"]["rate"], "<=", gates["fcr_overall_max"])
    gate("safe_stay_silent", overall["safe_stay_silent_rate"], ">=", gates["stay_silent_safe_min"])
    gate("corrective_action_precision", overall["corrective_action_precision"], ">=", gates["corrective_action_precision_min"])
    gate("variant_acceptance", overall["variant_acceptance_rate"], ">=", gates["variant_acceptance_min"])
    gate("premature_prompt", overall["premature_prompt_rate"], "<=", gates["premature_prompt_max"])
    gate("accent_fcr_gap", metrics["accent_fcr_gap"], "<=", gates["accent_fcr_gap_max"])
    gate("stable_result_latency_p95_ms", overall["latency"]["stable_result_ms"]["p95_ms"], "<=", gates["stable_result_latency_p95_ms_max"], "ms")
    gate("decision_latency_p95_ms", overall["latency"]["decision_ms"]["p95_ms"], "<=", gates["decision_latency_p95_ms_max"], "ms")
    for cohort, block in metrics["by_cohort"].items():
        gate(f"fcr_{cohort}", block["fcr"]["rate"], "<=", gates["fcr_per_cohort_max"])
    gate("all_split_speakers", metrics["evidence"]["all_split_speakers"], ">=", evidence_gates["min_total_speakers_all_splits"], "count")
    for cohort in COHORTS:
        gate(
            f"all_split_speakers_{cohort}",
            metrics["evidence"]["all_split_speakers_by_cohort"][cohort],
            ">=", evidence_gates["min_speakers_per_cohort_all_splits"], "count",
        )
        gate(
            f"development_speakers_{cohort}",
            metrics["evidence"]["development_speakers_by_cohort"][cohort],
            ">=", evidence_gates["min_development_speakers_per_cohort"], "count",
        )
        gate(
            f"holdout_speakers_{cohort}",
            metrics["evidence"]["holdout_speakers_by_cohort"][cohort],
            ">=", evidence_gates["min_holdout_speakers_per_cohort"], "count",
        )
    gate("holdout_non_correct_events", metrics["evidence"]["holdout_non_correct_events"], ">=", evidence_gates["min_holdout_non_correct_events"], "count")
    gate("double_annotated_holdout_session_fraction", overall["double_annotated_session_fraction"], ">=", evidence_gates["min_double_annotated_holdout_session_fraction"])
    gate("reference_token_coverage", overall["reference_token_coverage"], ">=", evidence_gates["reference_token_coverage_min"])
    gate("corrective_action_traceability", overall["corrective_action_traceability"], ">=", evidence_gates["corrective_action_traceability_min"])
    if evidence_gates.get("require_all_gates_evaluable", True):
        not_evaluable = sum(result["pass"] is None for result in results.values())
        gate("not_evaluable_required_gates", not_evaluable, "==", 0, "count")
    return results


def format_rate(value: float | None) -> str:
    return "N/A" if value is None else f"{value * 100:.2f}%"


def write_csvs(output_dir: Path, sessions: list[dict[str, Any]], events: list[dict[str, Any]], config: dict[str, Any]) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    with (output_dir / "event_audit.csv").open("w", newline="", encoding="utf-8") as handle:
        fields = ["event_id", "session_id", "speaker_id", "cohort", "gold_event", "gold_should_intervene", "action", "prompt_count", "model_count", "reason_code", "false_correction", "decision_ms"]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        safe_gold = set(config["policy"]["safe_gold_events"])
        for event in events:
            writer.writerow({
                "event_id": event["event_id"], "session_id": event["session_id"], "speaker_id": event["speaker_id"],
                "cohort": event["cohort"], "gold_event": event["gold_event"], "gold_should_intervene": event["gold_should_intervene"],
                "action": event["decision"]["action"], "prompt_count": event["decision"]["prompt_issued_count"],
                "model_count": event["decision"]["model_issued_count"], "reason_code": event["decision"]["reason_code"],
                "false_correction": event["gold_event"] in safe_gold and corrective(event), "decision_ms": event["latency"]["decision_ms"],
            })

    events_by_speaker: dict[str, list[dict[str, Any]]] = defaultdict(list)
    sessions_by_speaker: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        events_by_speaker[event["speaker_id"]].append(event)
    for session in sessions:
        sessions_by_speaker[session["speaker_id"]].append(session)
    with (output_dir / "speaker_metrics.csv").open("w", newline="", encoding="utf-8") as handle:
        fields = ["speaker_id", "cohort", "sessions", "events", "wer", "fcr", "safe_stay_silent_rate", "corrective_action_precision", "variant_acceptance_rate", "decision_p95_ms"]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for speaker_id in sorted(sessions_by_speaker):
            block = metric_block(sessions_by_speaker[speaker_id], events_by_speaker[speaker_id], config)
            writer.writerow({
                "speaker_id": speaker_id, "cohort": sessions_by_speaker[speaker_id][0]["cohort"],
                "sessions": block["counts"]["sessions"], "events": block["counts"]["events"],
                "wer": block["wer"]["rate"], "fcr": block["fcr"]["rate"],
                "safe_stay_silent_rate": block["safe_stay_silent_rate"],
                "corrective_action_precision": block["corrective_action_precision"],
                "variant_acceptance_rate": block["variant_acceptance_rate"],
                "decision_p95_ms": block["latency"]["decision_ms"]["p95_ms"],
            })


def write_summary(output_dir: Path, metrics: dict[str, Any], gates: dict[str, Any], violations: list[str], config: dict[str, Any]) -> None:
    overall = metrics["overall"]
    failed_gates = [name for name, result in gates.items() if result["pass"] is not True]
    stage_pass = not failed_gates and not violations
    lines = [
        "# Reader-Leader ASR Benchmark Summary", "", "**Generated by:** `evaluate_asr.py`", "",
        "> This report measures a frozen evaluation split. Example fixtures are synthetic smoke tests and are not evidence of child-ASR performance.", "",
        "## Stage verdict", "",
        f"**Child-voice prototype stage: {'PASS' if stage_pass else 'FAIL / NOT READY'}**", "",
        ("All performance, evidence, traceability, and evaluability gates passed with no hard safety violation."
         if stage_pass else
         f"The dataset failed or could not evaluate {len(failed_gates)} required gate(s), or contained a hard policy violation. Synthetic fixtures are expected to fail evidence-sufficiency gates."), "",
        "## Overall metrics", "",
        "| Metric | Result |", "|---|---:|",
        f"| Sessions / speakers / events | {overall['counts']['sessions']} / {overall['counts']['speakers']} / {overall['counts']['events']} |",
        f"| WER | {format_rate(overall['wer']['rate'])} ({overall['wer']['substitutions']} S, {overall['wer']['deletions']} D, {overall['wer']['insertions']} I; {overall['wer']['reference_words']} reference words) |",
        f"| False-correction rate | {format_rate(overall['fcr']['rate'])} ({overall['counts']['false_corrections']} / {overall['counts']['safe_events']}); 95% CI {format_rate(overall['fcr']['lower_95'])}–{format_rate(overall['fcr']['upper_95'])} |",
        f"| False-action share | {format_rate(overall['false_action_share'])} |",
        f"| Safe stay-silent rate | {format_rate(overall['safe_stay_silent_rate'])} |",
        f"| Corrective-action precision / recall | {format_rate(overall['corrective_action_precision'])} / {format_rate(overall['corrective_action_recall'])} |",
        f"| Valid-variant acceptance | {format_rate(overall['variant_acceptance_rate'])} |",
        f"| Premature prompt rate | {format_rate(overall['premature_prompt_rate'])} |",
        f"| Abstention rate | {format_rate(overall['abstention_rate'])} |",
        f"| Stable-result latency p50 / p95 | {overall['latency']['stable_result_ms']['p50_ms']} / {overall['latency']['stable_result_ms']['p95_ms']} ms |",
        f"| Decision latency p50 / p95 | {overall['latency']['decision_ms']['p50_ms']} / {overall['latency']['decision_ms']['p95_ms']} ms |",
        "", "## Accent-stratified results", "",
        "| Cohort | Speakers | WER | FCR | Safe stay-silent | Variant acceptance | Decision p95 |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for cohort in COHORTS:
        block = metrics["by_cohort"][cohort]
        lines.append(
            f"| {cohort} | {block['counts']['speakers']} | {format_rate(block['wer']['rate'])} | "
            f"{format_rate(block['fcr']['rate'])} | {format_rate(block['safe_stay_silent_rate'])} | "
            f"{format_rate(block['variant_acceptance_rate'])} | {block['latency']['decision_ms']['p95_ms']} ms |"
        )
    lines.extend(["", f"**Absolute cohort FCR gap:** {format_rate(metrics['accent_fcr_gap'])}", "", "## Prototype gates", "", "| Gate | Result | Threshold | Status |", "|---|---:|---:|---|"])
    for name, result in gates.items():
        value = result["value"]
        kind = result.get("kind", "rate")
        if value is None:
            shown = "N/A"
        elif kind == "ms":
            shown = f"{value:.1f} ms"
        elif kind == "count":
            shown = f"{value:.0f}"
        else:
            shown = format_rate(value)
        if kind == "ms":
            threshold = f"{result['threshold']:.0f} ms"
        elif kind == "count":
            threshold = f"{result['threshold']:.0f}"
        else:
            threshold = format_rate(result["threshold"])
        status = "NOT EVALUABLE" if result["pass"] is None else ("PASS" if result["pass"] else "FAIL")
        lines.append(f"| {name} | {shown} | {result['operator']} {threshold} | **{status}** |")
    lines.extend(["", "## Safety-policy violations", ""])
    lines.extend([f"- {item}" for item in violations] or ["No hard safety-policy violations detected."])
    lines.extend(["", "## Interpretation", "", "WER is calculated from the preserved free transcript. Reading-event metrics are calculated from adjudicated token events. Approved regional variants remain in the false-correction denominator and should resolve to STAY SILENT. Low-confidence or unstable evidence is counted as abstention rather than a reading error.", "", "## References", "", "[1]: ../../references/reader-leader-stage4-minimum-asr-plan.md \"Reader-Leader Stage 4 Minimum ASR Prototype Plan\"", "[2]: ../../references/accent-and-false-correction.md \"Regional Accent and False-Correction Evaluation\""])
    (output_dir / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate Reader-Leader low-latency accent-aware ASR events.")
    parser.add_argument("--sessions", type=Path, required=True)
    parser.add_argument("--events", type=Path, required=True)
    parser.add_argument("--variants", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--schema-dir", type=Path, default=Path(__file__).resolve().parents[1] / "schema")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--split", choices=["development", "holdout"], default=None)
    parser.add_argument("--fail-on-gates", action="store_true")
    args = parser.parse_args()

    config = yaml.safe_load(args.config.read_text(encoding="utf-8"))
    split = args.split or config.get("evaluation_split", "holdout")
    session_rows = load_jsonl(args.sessions)
    event_rows = load_jsonl(args.events)
    variant_rows = load_jsonl(args.variants)
    errors = []
    errors.extend(validate_rows(session_rows, load_schema(args.schema_dir / "session.schema.json"), args.sessions))
    errors.extend(validate_rows(event_rows, load_schema(args.schema_dir / "event.schema.json"), args.events))
    errors.extend(validate_rows(variant_rows, load_schema(args.schema_dir / "pronunciation-variant.schema.json"), args.variants))
    if errors:
        print("Schema validation failed:", file=sys.stderr)
        print("\n".join(f"- {item}" for item in errors), file=sys.stderr)
        return 2

    sessions, events, variants = clean_rows(session_rows), clean_rows(event_rows), clean_rows(variant_rows)
    cross_errors, violations = cross_validate(sessions, events, variants, config)
    if cross_errors:
        print("Cross-file validation failed:", file=sys.stderr)
        print("\n".join(f"- {item}" for item in cross_errors), file=sys.stderr)
        return 2

    selected_sessions = [session for session in sessions if session["split"] == split]
    selected_ids = {session["session_id"] for session in selected_sessions}
    selected_events = [event for event in events if event["split"] == split and event["session_id"] in selected_ids]
    if not selected_sessions or not selected_events:
        print(f"No sessions/events found for split={split}", file=sys.stderr)
        return 2

    metrics = evaluate(sessions, events, config, split)
    gates = gate_results(metrics, config)
    gate_failures = [name for name, result in gates.items() if result["pass"] is not True]
    stage_pass = not gate_failures and not violations
    args.output.mkdir(parents=True, exist_ok=True)
    payload = {
        "benchmark_version": config["benchmark_version"], "config_version": sorted({session["config_version"] for session in selected_sessions}),
        "stage_pass": stage_pass, "metrics": metrics, "gates": gates, "policy_violations": violations,
    }
    (args.output / "metrics.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    write_csvs(args.output, selected_sessions, selected_events, config)
    write_summary(args.output, metrics, gates, violations, config)
    print(f"Wrote benchmark report to {args.output}")
    print(f"FCR={format_rate(metrics['overall']['fcr']['rate'])}; WER={format_rate(metrics['overall']['wer']['rate'])}; stage_pass={stage_pass}; violations={len(violations)}")

    if violations:
        return 3
    if args.fail_on_gates and gate_failures:
        print(f"Failed gates: {', '.join(gate_failures)}", file=sys.stderr)
        return 4
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
