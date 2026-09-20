# Raw Audio Ingestion Workflow

`src/ingest_audio.py` converts controlled raw recordings into canonical 16 kHz mono PCM WAV files and valid session JSONL records. It also creates a token annotation template. It emits final event JSONL only after human-reviewed event labels and captured ASR/state-machine evidence are supplied.

> The script never infers a child's accent and never invents a gold reading label. Use pseudonymous `session_id` and `speaker_id` values. Keep consent records and identifying information outside this package.

## Processing modes

| Mode | Input | Result | Use case |
|---|---|---|---|
| Existing transcripts | Manifest fields `transcript_path` or `asr_free_transcript` | Canonical audio + complete session records | Transcription has already run in a controlled environment. |
| Structured ASR results | `--asr-results results.jsonl` | Canonical audio + complete session records | A batch recognizer produced one result object per `session_id`. |
| ASR adapter command | `--asr-command 'adapter --audio {audio} --session {session_id}'` | Canonical audio + complete session records | Integrate any recognizer without coupling the package to a vendor. The adapter must output one JSON object to stdout. |
| Ingestion only | `--allow-missing-transcript` | Canonical audio + sessions with provider/model `not_run` | Prepare recordings before recognition. Do not evaluate WER until transcripts are populated. |

An external ASR service may receive child audio only when the research team has approved that processor and data route. The script therefore has no default network upload.

## Manifest

Start from `data/ingest_manifest.example.csv`. The required columns are:

| Field | Requirement |
|---|---|
| `audio_path` | Local controlled path to WAV, MP3, M4A, FLAC, OGG, or another FFmpeg-readable recording. |
| `session_id`, `speaker_id` | Pseudonymous IDs using letters, numbers, `.`, `_`, or `-`. Never use a child name. |
| `split` | `development` or `holdout`. |
| `cohort` | `selected_regional` or `comparison`; based on approved metadata, not audio inference. |
| `age_min_years`, `age_max_years` | Age band between 4 and 17. |
| `consent_verified`, `assent_verified` | Both must be `true`; ingestion otherwise stops. |
| `accent_label_source` | `guardian_report`, `participant_report`, or `researcher_verified_metadata`. |
| `passage_id`, `reference_text` | Frozen passage identifier and exact reading text. |
| `session_started_at` | ISO-8601 timestamp with timezone. |
| `config_version` | Frozen state-machine and ASR configuration version. |
| `device_class`, `environment` | Values allowed by `session.schema.json`. |
| `microphone_check_passed`, `overlapping_speech_detected` | Capture-quality metadata supplied by the collection process. |

Optional fields include SNR, transcript source, ASR provider/model/mode, and notes.

## Run session ingestion

```bash
cd /home/ubuntu/projects/readerleader-33f0d994/asr-benchmark
python3 src/ingest_audio.py \
  --manifest /controlled/input/recordings.csv \
  --asr-results /controlled/input/free_asr_results.jsonl \
  --output-dir /controlled/output/readerleader_ingest
```

The output contains:

```text
readerleader_ingest/
├── audio/<session_id>.wav
├── sessions.jsonl
└── event_annotation_template.csv
```

The canonical output filename contains only the pseudonymous session ID. FFmpeg removes source metadata while converting to 16 kHz mono PCM. The script records duration, sample rate, channels, SHA-256, clipping detection, capture metadata, and the original free transcript.

## Merge reviewed events

The annotation template is for reviewer workflow planning. Final event input must be JSONL with the complete event evidence contract: human gold event, adjudication, audio span, ASR hypotheses/confidence, alignment event, accent-variant status, latency milestones, and the logged state-machine decision. `data/example_events.jsonl` demonstrates this structure.

```bash
python3 src/ingest_audio.py \
  --manifest /controlled/input/recordings.csv \
  --asr-results /controlled/input/free_asr_results.jsonl \
  --event-annotations /controlled/input/reviewed_events.jsonl \
  --output-dir /controlled/output/readerleader_ingest
```

The script inherits and cross-checks `speaker_id`, split, cohort, passage, schema version, and configuration version from each parent session. It refuses conflicting records. It then validates `events.jsonl` against `schema/event.schema.json`.

## Evaluate

Copy or reference the frozen pronunciation-variant file, then run:

```bash
python3 src/evaluate_asr.py \
  --sessions /controlled/output/readerleader_ingest/sessions.jsonl \
  --events /controlled/output/readerleader_ingest/events.jsonl \
  --variants /controlled/input/approved_variants.jsonl \
  --config config/benchmark.yaml \
  --output /controlled/output/readerleader_report \
  --fail-on-gates
```

See `ACCEPTANCE_GATES.md` for the exact child-voice stage-pass rule.

## ASR adapter output

An adapter receives the canonical audio path and must emit one JSON object to stdout:

```json
{
  "transcript": "the recognizer's free transcript",
  "provider": "provider_name",
  "model": "model_and_version",
  "mode": "free"
}
```

The command is executed without a shell. Placeholders are substituted as individual arguments, which avoids shell interpolation. Preserve free or lightly adapted evidence; never force expected passage words into the transcript before WER scoring.

## Dependencies

The ingestion script uses Python 3.11+, `jsonschema`, FFmpeg, and FFprobe. The benchmark evaluator also uses PyYAML. Install Python requirements with `python3 -m pip install -r requirements.txt` and install FFmpeg using the operating system package manager if it is not already present.

## References

[1]: ./README.md "Reader-Leader Stage 4 Low-Latency ASR Benchmark"
[2]: ./ACCEPTANCE_GATES.md "Reader-Leader Child-Voice Prototype Acceptance Gates"
[3]: ./references/reader-leader-stage4-minimum-asr-plan.md "Reader-Leader Stage 4 Minimum Accent-Aware ASR Prototype Plan"
