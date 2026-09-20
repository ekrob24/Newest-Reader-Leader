# Reader-Leader Stage 4 Low-Latency ASR Benchmark

**Author:** Manus AI  
**Version:** 1.1.0

This package defines a versioned dataset contract and a reproducible evaluation CLI for benchmarking child read-aloud recognition across a selected regional accent cohort and a matched comparison cohort. It measures recognition quality, intervention safety, regional-variant acceptance, and low-latency behavior without allowing the known passage to overwrite the ASR evidence.

> The files under `data/example_*` are **synthetic schema and test fixtures only**. They are not child recordings, linguistic evidence, or performance results. Replace them with consented, adjudicated data before drawing conclusions.

## Design principles

The benchmark stores free-transcription evidence at the session level and intervention evidence at the token/event level. Standard word error rate (WER) is calculated from the preserved free transcript. False-correction and accent metrics are calculated from independently adjudicated reading events. A legitimate regional pronunciation is included in the safe-opportunity denominator and must resolve to **STAY SILENT**.

| Principle | Enforcement |
|---|---|
| No automatic accent classification | `cohort` comes from guardian/participant/research metadata; no inferred accent field exists. |
| Reference text cannot hide errors | `asr_free_transcript` is preserved and used for WER before token alignment. |
| Accent variants need provenance | Every approved variant identifies phonetics and literacy reviewers plus local-speaker evidence. |
| Uncertainty cannot correct a child | Policy validation flags corrective actions on unstable partials or uncertainty reason codes. |
| MODEL cannot occur directly | `MODEL` requires one prior `PROMPT`, an elapsed retry window, and an auditable latency trace. |
| Holdout is frozen | The evaluator requires one holdout `config_version` and rejects speaker leakage across splits. |

## Package structure

| Path | Purpose |
|---|---|
| `schema/session.schema.json` | Session, speaker/cohort metadata, consent/assent, free transcript, audio capture, and provider configuration. |
| `schema/event.schema.json` | Gold reading event, ASR alternatives, accent evidence, action state, audit fields, and low-latency milestones. |
| `schema/pronunciation-variant.schema.json` | Passage-specific, expert-approved regional pronunciation variants with provenance. |
| `config/benchmark.yaml` | Frozen normalization, timing thresholds, policy classes, and prototype gates. |
| `src/evaluate_asr.py` | Validation, WER, false-correction, accent, intervention, latency, subgroup, and gate evaluation. |
| `src/ingest_audio.py` | Deterministic raw-audio normalization, session mapping, annotation-template creation, and reviewed-event merge. |
| `tests/` | Unit tests for metric separation, ingestion, schema output, and hard safety invariants. |
| `data/example_*.jsonl` | Synthetic smoke-test fixtures only. |
| `ACCEPTANCE_GATES.md` | Exact child-voice stage thresholds, denominators, evidence requirements, and pass rule. |
| `INGESTION.md` | Raw-recording manifest, ASR-adapter, reviewer-merge, privacy, and execution guide. |
| `Dockerfile` / `compose.yaml` | Reproducible Linux container for Windows 11 + WSL2 + Docker Desktop. |
| `DEPLOY-WINDOWS-WSL.md` | Windows 11, WSL2, Docker, Compose, filesystem, privacy, and troubleshooting guide. |

## Data model

### Session record

A session represents one passage attempt by one pseudonymous speaker. It stores the reference passage and the recognizer's free transcript so WER cannot be computed from a reference-corrected hypothesis. It also stores split, cohort, consent/assent, age band, device/environment, sample rate, capture quality, model version, and configuration version.

### Event record

An event represents one adjudicated token or timed reading behavior. `latency.*_ms` values are elapsed milliseconds from the end of the event's `audio_span` to that output. `decision_ms` records the first policy decision; `prompt_ms` and `model_ms` record later child-facing outputs when present. The record stores raw hypotheses, confidence, partial/final status, stability, alignment event, accent-variant status, the human gold label, intervention eligibility, PROMPT/MODEL counts, state, reason code, review flag, and reviewer override.

A final `STAY_SILENT` event may still record a prior PROMPT if the child succeeds on retry. Therefore the evaluator defines a corrective event from `prompt_issued_count > 0 OR model_issued_count > 0`, not only from the final `action` field.

### Pronunciation-variant record

A pronunciation variant is passage-specific and cohort-specific. It is accepted only when the record is approved and includes reviewer and local-speaker provenance. A model's recurring transcription error is not sufficient evidence to add a variant.

## Gold event taxonomy

| Gold event | Safe opportunity for FCR? | Default intervention eligibility |
|---|---:|---:|
| `correct` | Yes | No |
| `valid_accent_variant` | Yes | No |
| `self_correction` | No; report premature prompts separately | No |
| `unintelligible_noise` | No; report as abstention/uncertainty | No |
| `substitution`, `omission`, `hesitation` | No | Reviewer determines `gold_should_intervene` |
| `insertion`, `repetition` | No | Reviewer determines `gold_should_intervene` |

## Metrics

```text
FCR = corrective events on gold CORRECT or VALID_ACCENT_VARIANT
      ----------------------------------------------------------
      all gold CORRECT or VALID_ACCENT_VARIANT opportunities

false-action share = false corrective events / all corrective events
variant acceptance = accepted gold VALID_ACCENT_VARIANT / all gold VALID_ACCENT_VARIANT
```

The evaluator reports overall and cohort-specific WER, FCR with Wilson 95% intervals, false-action share, safe stay-silent rate, corrective-action precision/recall, valid-variant acceptance, premature prompts, abstention, first-partial/stable/final/decision/prompt/model latency, speaker-level metrics, and the absolute cohort FCR gap.

The target gates in `benchmark.yaml` are conservative prototype gates, not production guarantees. Change them only on development data and freeze the configuration before the final holdout run. A stage passes only when all performance, evidence-sufficiency, traceability, and evaluability gates pass with zero hard policy violations. The synthetic fixtures intentionally fail child-evidence sufficiency even when their software metrics pass. See `ACCEPTANCE_GATES.md`.

## Ingest raw recordings

Use `src/ingest_audio.py` to convert controlled source recordings to canonical 16 kHz mono PCM WAV files named with pseudonymous session IDs. It removes source metadata, calculates SHA-256 and duration, checks clipping, maps approved manifest metadata into `sessions.jsonl`, and creates an annotation template.

The script does **not** infer accent from audio and does **not** invent gold event labels. Final `events.jsonl` is written only when complete human-reviewed annotations and captured ASR/state-machine evidence are supplied.

```bash
python3 src/ingest_audio.py \
  --manifest /controlled/input/recordings.csv \
  --asr-results /controlled/input/free_asr_results.jsonl \
  --output-dir /controlled/output/readerleader_ingest
```

It has no default network upload. If an external ASR processor is approved, connect it through `--asr-results` or the documented no-shell `--asr-command` adapter. See `INGESTION.md` and `data/ingest_manifest.example.csv`.

## Install and run

```bash
cd /home/ubuntu/projects/readerleader-33f0d994/asr-benchmark
python3 -m pip install -r requirements.txt
python3 -m unittest discover -s tests -v
python3 src/evaluate_asr.py \
  --sessions data/example_sessions.jsonl \
  --events data/example_events.jsonl \
  --variants data/example_variants.jsonl \
  --config config/benchmark.yaml \
  --output output/example
```

Use `--fail-on-gates` in continuous integration when a frozen dataset must fail the build if a gate is missed. The CLI exits with code 2 for invalid data, 3 for hard safety-policy violations, and 4 for any failed or non-evaluable required gate when `--fail-on-gates` is active.

## Outputs

| Output | Purpose |
|---|---|
| `metrics.json` | Machine-readable overall/cohort metrics, gates, and policy violations. |
| `summary.md` | Human-readable benchmark report with raw counts and interpretation. |
| `event_audit.csv` | Event-level actions, reason codes, latencies, and false-correction flags. |
| `speaker_metrics.csv` | Speaker-level WER, FCR, action, variant, and latency summaries. |

## Evaluation protocol

Use speaker-disjoint development and holdout splits. Double-label at least 20% of recordings. A literacy reviewer owns reading-event labels. A phonetics/local-variety reviewer adjudicates accent-sensitive cases. Freeze the passage, normalization, pronunciation variants, alignment, state machine, confidence threshold, timing thresholds, and provider/model version before evaluating holdout data.

Report raw counts and confidence intervals. Never exclude valid accent variants from the FCR denominator. Never change a variant or threshold after looking at holdout results. If the holdout configuration changes, version it and collect or designate a new untouched holdout.

## References

[1]: ./references/reader-leader-stage4-minimum-asr-plan.md "Reader-Leader Stage 4 Minimum Accent-Aware ASR Prototype Plan"
[2]: ./references/accent-and-false-correction.md "Regional Accent and False-Correction Evaluation"
[3]: ./references/state-machine.md "Exact Stage 4 Intervention State Machine"

## Reader Leader v2.1 additive change (2026-09-05)

`schema/event.schema.json`: one value added to `decision.reason_code` — `WITHHELD_BY_CHALLENGE_LEVEL`.
It records a `STAY_SILENT` decision where the deterministic state machine *would* have issued a
corrective action but the adult-set challenge level withheld it. It is not an uncertainty code and is
deliberately absent from `policy.uncertainty_reason_codes`. Numeric governor fields live in a sidecar
(`governor.jsonl`, keyed by `event_id`) so the event schema keeps `additionalProperties: false`.
No other file in this package was modified.
