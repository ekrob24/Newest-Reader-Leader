# Reader-Leader Child-Voice Prototype Acceptance Gates

**Author:** Manus AI  
**Configuration:** `config/benchmark.yaml`  
**Benchmark version:** `rl-stage4-benchmark-v1.1`

The child-voice prototype passes only when **every required performance, safety, evidence, traceability, and evaluability gate passes on the frozen holdout evaluation, with zero hard policy violations**. The percentages are conservative prototype targets. They are not production or learning-science guarantees.

> A successful synthetic smoke test proves that the software runs. It does not pass the child-voice prototype stage. The evidence-sufficiency gates deliberately prevent this.

## Stage-pass rule

```text
STAGE_PASS =
    all performance gates are PASS
AND all evidence-sufficiency gates are PASS
AND all required metrics are evaluable
AND policy_violations == 0
AND schema/cross-file validation succeeds
```

If any required metric has a zero denominator, its result is `NOT EVALUABLE`. With `require_all_gates_evaluable: true`, that condition fails the stage.

## Performance and safety gates

| Configuration key | Required result | Exact interpretation |
|---|---:|---|
| `fcr_overall_max` | **≤ 0.02 (2%)** | At most 2% of all human-labelled `correct` and `valid_accent_variant` opportunities may receive one or more corrective actions. PROMPT and MODEL both count. Report the numerator, denominator, and Wilson 95% interval. |
| `fcr_per_cohort_max` | **≤ 0.03 (3%) in each cohort** | The selected regional cohort and comparison cohort must each meet the FCR ceiling. A good overall average cannot hide harm in one cohort. |
| `stay_silent_safe_min` | **≥ 0.98 (98%)** | At least 98% of correct and approved-variant opportunities must receive no PROMPT and no MODEL. This is the complement of token-level FCR under this event definition. |
| `corrective_action_precision_min` | **≥ 0.90 (90%)** | At least 90% of all corrective events must be on human-adjudicated events where intervention was appropriate. This prevents a system from achieving low FCR merely by acting rarely but incorrectly. |
| `variant_acceptance_min` | **≥ 0.95 (95%)** | At least 95% of frozen, expert-approved `valid_accent_variant` events must receive no corrective action. Variants remain in the FCR denominator. |
| `premature_prompt_max` | **≤ 0.05 (5%)** | No more than 5% of completed `self_correction` events may have received a PROMPT or MODEL before completion. |
| `accent_fcr_gap_max` | **≤ 0.01 (1 percentage point)** | The absolute FCR difference between the selected regional and comparison cohorts must not exceed one percentage point. Report cohort counts and uncertainty with the point gap. |
| `stable_result_latency_p95_ms_max` | **≤ 1200 ms** | At least 95% of events with stable ASR evidence must reach that stable result within 1.2 seconds of the event/audio boundary used by the logging contract. |
| `decision_latency_p95_ms_max` | **≤ 1500 ms** | At least 95% of logged first policy decisions must occur within 1.5 seconds. Later self-correction, stall, retry, and MODEL timers are reported separately. |

### Metric definitions

```text
FCR = corrective events on gold CORRECT or VALID_ACCENT_VARIANT
      ----------------------------------------------------------
      all gold CORRECT or VALID_ACCENT_VARIANT opportunities

false-action share = false corrective events / all corrective events

variant acceptance = approved-variant events without PROMPT or MODEL
                     -----------------------------------------------
                     all gold VALID_ACCENT_VARIANT events

accent FCR gap = | FCR(selected regional) - FCR(comparison) |
```

A corrective event is detected from `prompt_issued_count > 0 OR model_issued_count > 0`. This catches a prior PROMPT even when the final event action is `STAY_SILENT` after a successful retry.

## Evidence-sufficiency and audit gates

| Configuration key | Required result | Exact interpretation |
|---|---:|---|
| `min_total_speakers_all_splits` | **≥ 24** | At least 24 consented child speakers across development and holdout. Synthetic and adult voices do not satisfy this evidence claim. |
| `min_speakers_per_cohort_all_splits` | **≥ 12 per cohort** | At least 12 selected-regional and 12 comparison speakers across all splits. |
| `min_development_speakers_per_cohort` | **≥ 6 per cohort** | At least six speakers in each development cohort are available for calibration without touching holdout speakers. |
| `min_holdout_speakers_per_cohort` | **≥ 6 per cohort** | At least six previously unseen speakers in each holdout cohort support subgroup reporting. |
| `min_holdout_non_correct_events` | **≥ 200** | The holdout must contain at least 200 adjudicated events outside the `correct`/`valid_accent_variant` safe set. This supports action precision/recall analysis. |
| `min_double_annotated_holdout_session_fraction` | **≥ 0.20 (20%)** | At least 20% of holdout sessions must be independently double-labelled. A session counts only when every one of its event records has at least two reviewers and status `double_label_agreed` or `adjudicated`. |
| `reference_token_coverage_min` | **= 1.00 (100%)** | Every expected reference-token index must have at least one adjudicated event record in every evaluated holdout session. Extra insertion/noise events may use `token_index: null`. |
| `corrective_action_traceability_min` | **= 1.00 (100%)** | Every corrective event must include a reference token, reviewable audio span, ASR confidence, reason code, and decision timestamp. |
| `require_all_gates_evaluable` | **true** | Any required metric with no valid denominator fails the child-voice stage rather than being silently ignored. |

The `24 / 12 / 6 / 200` thresholds are minimum evidence-bearing pilot gates derived from the current Stage 4 plan. They do not establish production readiness or broad accent generalisation.

## State-machine calibration values

These values control the live decision policy. They are not performance gates, but they must be calibrated only on development speakers and frozen before holdout.

| Configuration key | Frozen default | Meaning |
|---|---:|---|
| `partial_stability_ms` | **400 ms** | A partial hypothesis must remain stable for at least this window before it can contribute to a correction decision. |
| `self_correction_hold_ms` | **2000 ms** | The child receives approximately two seconds to self-correct before a possible mismatch can prompt. |
| `stall_prompt_ms` | **3000 ms** | A confirmed stall must persist for three seconds before a single light PROMPT is allowed. |
| `retry_model_ms` | **3000 ms** | MODEL is permitted only after a prior PROMPT and an unsuccessful three-second retry window. |
| `min_action_confidence` | **0.80** | Corrective action requires confidence at or above 0.80 plus stable, reliable timing and no approved accent variant. Confidence alone is never sufficient. |

## Hard validation and policy conditions

The evaluator returns a validation or policy failure if any of the following occurs:

1. A child lacks verified consent or assent.
2. The same speaker appears in both development and holdout.
3. Holdout events use more than one configuration version.
4. An approved accent variant receives PROMPT or MODEL.
5. An unstable partial or an uncertainty reason triggers a corrective action.
6. MODEL occurs without one previous PROMPT.
7. A PROMPT or MODEL count exceeds one for a token/window.
8. Event metadata conflicts with its parent session.
9. Audio spans or latency milestones are invalid.
10. Required schema fields or pronunciation-variant provenance are missing.

## Word error rate policy

There is intentionally **no WER pass threshold** in version 1.1. WER is reported overall and by cohort from the preserved free transcript. The intervention gate may correctly stay silent on an approved pronunciation even when the recognizer's transcript is wrong, so WER and false correction answer different questions. Add a WER gate only after the child dataset, passage difficulty, and educational use have been reviewed; do not add one after inspecting holdout results.

## Required reporting

A pass report must publish overall, cohort-level, and speaker-level results with raw counts. It must include WER, FCR and its confidence interval, false-action share, safe stay-silent rate, corrective-action precision/recall, variant acceptance, premature prompts, abstention, latency distributions, accent disparity, gate results, and the event audit trail.

## References

[1]: ./references/reader-leader-stage4-minimum-asr-plan.md "Reader-Leader Stage 4 Minimum Accent-Aware ASR Prototype Plan"
[2]: ./references/accent-and-false-correction.md "Regional Accent and False-Correction Evaluation"
[3]: ./references/state-machine.md "Exact Stage 4 Intervention State Machine"
