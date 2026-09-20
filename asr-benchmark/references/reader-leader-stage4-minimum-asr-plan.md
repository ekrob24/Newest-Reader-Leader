# Reader-Leader Stage 4: Minimum Accent-Aware ASR Prototype Plan

**Prepared by Manus AI**  
**Date:** 3 September 2026  
**Purpose:** Prove that Reader-Leader can recognise a child reading a known passage, distinguish likely reading mistakes from legitimate accent variation, and make safe **PROMPT / MODEL / STAY SILENT** decisions.

## Executive conclusion

Reader-Leader Stage 4 should not be built as a general dictation system. It should be built as a **constrained oral-reading decision system**. The reference passage is known in advance. Automatic speech recognition (ASR) supplies acoustic and word-level evidence. A separate Reader-Leader layer aligns that evidence to the passage, accepts expert-approved accent variants, recognises self-correction, and abstains whenever the evidence is uncertain.

The minimum prototype should use **one fixed passage, one named regional accent cohort, one comparison cohort, one replaceable ASR adapter, one deterministic decision state machine, and one small evaluation harness**. It should not train a speech model, attempt broad accent coverage, score prosody, generate open-ended feedback, or build the full running-record dashboard. Those additions would obscure the core question: **can the system avoid falsely correcting a child who read correctly?**

The uploaded source library supports this architecture but does not implement it. The textbook contains 26 chapters in three parts. Chapters 15 and 16 provide the direct phonetics and ASR foundation; Chapters 2–4, 7, 17, and 18 support alignment, confidence-aware classification, decoding, spoken modelling, and event labels. The eighteen lectures and notebook archive add text-processing, evaluation, state-management, and ethics patterns. However, the notebook archive contains no runnable audio, waveform, ASR, forced-alignment, word-timing, WER, or child-speech pipeline. The project must therefore add these pieces.[1] [2]

> **Safety principle:** low confidence must produce **STAY SILENT + teacher flag**, never a correction. A missed teaching opportunity is recoverable; a false correction directly damages confidence and trust.[3] [4]

## 1. What the source review establishes

### 1.1 Textbook coverage

The August 2026 draft of *Speech and Language Processing* contains **three parts, 26 chapters, and 203 numbered contents entries**. Its major topic families are language modelling and decoding; classification, neural networks, and model evaluation; embeddings and interpretability; speech science, ASR, and text-to-speech; retrieval, agents, and translation; linguistic sequence labelling and syntax; and semantic, discourse, and conversational analysis.[1]

| Stage 4 priority | Textbook chapters | Use in this prototype |
|---|---|---|
| **Primary** | 15, 16 | Phonetics, pronunciation variation, acoustic features, ASR architectures, CTC/streaming trade-offs, and WER. |
| **Direct support** | 2, 3, 4, 7 | Tokenization, minimum edit distance, language-model context, precision/recall, harm-aware classification, Transformers, and decoding. |
| **Conditional support** | 5, 8–10, 14, 17, 18 | Bias auditing, interpretability, adaptation, recurrent models, spoken model output, and token-level event labelling. |
| **Defer** | 11–13, 19–26 | Retrieval, translation, parsing, information extraction, affect, coreference, discourse, and open conversation are not needed to prove Stage 4. |

The complete part, chapter, section, and page-number catalog is delivered separately in `textbook-contents-catalog.md`.[1]

### 1.2 Individual chapters, lectures, and notebooks

The source review covers **five standalone chapters, eighteen lecture decks, one notebook archive, and the ASR vendor assessment**. Only the standalone phonetics and ASR chapters are directly about recognition. The other sources are supporting rather than speech implementations.[2]

| Material group | Useful assets | Important gap |
|---|---|---|
| Phonetics and speech features | Phones, articulatory categories, pronunciation dictionaries, prosody, waveform/spectrum concepts, log-Mel features, and MFCCs | No child-speech implementation or accent lexicon. |
| ASR | Encoder–decoder ASR, Whisper-style systems, HuBERT/wav2vec-style pretraining, CTC, RNN-T, WER, normalization, and speech corpora | No runnable child ASR, forced aligner, or calibrated thresholds. |
| TTS | Spoken model-word concepts and evaluation | No selected child-facing voice; neural voice cloning is unnecessary and inappropriate for the minimum build. |
| Classification and language modelling | Edit distance, n-grams, Bayes/logistic baselines, precision/recall, confusion matrices, and contextual scoring | These are text-side methods and cannot establish what the child actually pronounced. |
| Sequence labelling and dialogue | HMM/Viterbi/CRF concepts, state tracking, policy selection, and templates | No Reader-Leader reading-event schema or intervention policy is supplied. |
| Ethics and bias | Privacy, data statements, subgroup evaluation, linguistic justice, and explainability limits | No project-specific DPIA, consent flow, retention implementation, or child-data governance procedure. |
| Notebook archive | Python/NLTK, scikit-learn, Hugging Face, text classification, language models, tagging, NER, prompting, and bias-audit patterns | **No waveform, audio capture, ASR, word timing, WER, child speech, or forced-alignment notebook exists.** |
| Vendor assessment | Specialist and generic ASR candidates, integration questions, and red-line acceptance rules | No candidate is proven ready for the selected child accent or live intervention loop. |

The evidence-by-source catalog, including topic progression, methods, datasets, prototype contributions, limitations, and page/slide/notebook references, is delivered separately in `individual-source-catalog.md`.[2]

## 2. Exact Stage 4 outcome

The Student Journey defines Stage 4 as three word-level decisions: **PROMPT**, **MODEL**, and **STAY SILENT**. A prompt gives a stalled child a light cue and preserves the opportunity to self-correct. Modelling supplies the word only after the prompt has not worked. Silence means the reading is correct, including a legitimate regional pronunciation, or the evidence is too uncertain to justify intervention.[3]

### 2.1 Minimum proof statement

At the end of the sprint, the team should be able to make this evidence-backed statement:

> On one unseen passage and a speaker-disjoint holdout set containing children from one named regional accent cohort and one comparison cohort, Reader-Leader aligned the read speech to the passage, accepted documented accent variants, identified a limited set of reading events, and applied PROMPT / MODEL / STAY SILENT under a published conservative policy. Results include exact false-correction counts, confidence intervals, accent-stratified metrics, action latency, and reviewable audio evidence.

The prototype must **not** claim broad multi-accent readiness, learning gain, diagnostic ability, classroom-scale reliability, or production child-data compliance.

### 2.2 In scope and out of scope

| In scope for the minimum prototype | Explicitly out of scope |
|---|---|
| One fixed passage of approximately 60–100 words, plus a short pronunciation calibration list | Full content library or arbitrary uploaded books |
| One named regional accent cohort and one comparison cohort | Broad UK/Ireland accent support |
| Child audio capture with quality checks | Speaker identification or automatic accent classification |
| Replaceable ASR adapter with words, timings, confidence, and alternatives where available | Training or fine-tuning an acoustic model |
| Reference-text normalization and sequence alignment | Open-ended dictation |
| Events: correct, valid accent variant, substitution, omission, insertion, repetition, hesitation, self-correction, uncertain/noise | Full prosody, comprehension, reading-age, or diagnostic scoring |
| Deterministic PROMPT / MODEL / STAY SILENT policy | LLM deciding whether a child is right or wrong |
| Pre-recorded model words in the selected local variety | Voice cloning or generative child voices |
| Audio-linked event log and simple reviewer screen/export | Full Stage 7 dashboard, longitudinal trends, or school integrations |
| Offline, speaker-disjoint evaluation | Production deployment or production ASR procurement |

## 3. Recommended system architecture

![Reader-Leader Stage 4 minimum ASR architecture](./stage4-minimum-asr-architecture.png)

The architecture separates **recognition** from **judgment**. This is essential. A vendor or pretrained model may change, but Reader-Leader should own passage alignment, accent acceptance, reading-event state, abstention, intervention timing, audit evidence, and adult override.[5]

### 3.1 Component boundaries

| Component | Minimum responsibility | Required output |
|---|---|---|
| Browser recorder | Capture mono audio, show the known passage, and stream or upload sentence-sized segments | PCM/WAV or provider-supported stream with timestamps |
| Audio-quality gate | Detect silence, clipping, excessive background noise, and recording failure | `usable`, `retry_recording`, or `uncertain` with reason |
| ASR adapter | Call one open baseline or vendor SDK/API behind a stable interface | Word hypotheses, start/end times, confidence, alternatives, and partial/final status where available |
| Text normalizer | Normalize punctuation, apostrophes, numbers, and case without deleting repetitions or disfluencies needed for scoring | Canonical reference tokens and normalized hypothesis tokens |
| Reference aligner | Align evidence to the known text using weighted dynamic programming | Match, substitution, omission, insertion, and repetition candidates |
| Accent acceptance layer | Match a passage word against expert-approved pronunciation alternatives and phonetic evidence | `canonical_correct`, `variant_correct`, `not_variant`, or `uncertain` |
| Reading-event state | Preserve hesitation, retry, self-correction, and short temporal context | Stable event type, confidence, and evidence span |
| Safety and intervention gate | Apply the conservative deterministic policy | PROMPT, MODEL, or STAY SILENT with machine-readable reason |
| Evidence log | Preserve decisions, audio slices, thresholds, and reviewer overrides | JSONL/SQLite record and simple reviewer export |
| Evaluation harness | Compare predictions with teacher/phonetician labels | Overall and cohort-specific metrics with confidence intervals |

### 3.2 Minimal interface contract

Every evaluated reference token should produce an auditable record similar to the following:

```json
{
  "session_id": "pseudonymous-id",
  "token_index": 17,
  "expected": "house",
  "asr_hypotheses": ["house", "horse"],
  "start_ms": 8120,
  "end_ms": 8590,
  "asr_confidence": 0.84,
  "accent_variant_status": "variant_correct",
  "reading_event": "correct",
  "event_confidence": 0.97,
  "decision": "STAY_SILENT",
  "reason_code": "APPROVED_ACCENT_VARIANT",
  "audio_span": [7900, 8800],
  "reviewer_override": null
}
```

No user-facing explanation needs to expose internal chain-of-thought. The reason code should identify the observable evidence and applied rule, such as `MATCH`, `APPROVED_ACCENT_VARIANT`, `LOW_CONFIDENCE_ABSTAIN`, `SELF_CORRECTION_IN_PROGRESS`, `CONFIRMED_STALL`, or `RETRY_FAILED_MODEL_WORD`.

## 4. Recognition and alignment design

### 4.1 Do not let the reference text hide genuine mistakes

A known passage makes recognition easier, but excessive reference conditioning can force the expected word into the transcript and conceal a true substitution. The prototype should preserve two distinct operations:

1. **Recognition evidence:** obtain an unconstrained or only lightly vocabulary-adapted hypothesis, preferably with alternatives and confidence.
2. **Post-recognition alignment:** align that evidence to the expected passage.

The reference passage may improve tokenization and vocabulary coverage. It must not overwrite the acoustic evidence before error classification. If a service returns only a forced score against the expected word, compare it with at least one free-transcription baseline during evaluation.

### 4.2 Alignment rules

Use a weighted Levenshtein or dynamic-programming aligner over a short active passage window. Exact normalized matches should cost zero. Approved orthographic equivalents may cost zero. Substitutions, omissions, insertions, and repetitions should remain separate events. The aligner should retain N-best ASR alternatives when available and should use time order to avoid shifting one mistake across the rest of the sentence.

The aligner should not classify a low-confidence acoustic mismatch as a reading error by itself. It should emit an **uncertain candidate** for the accent and safety layers.

### 4.3 Self-correction and hesitation

A child who says an incorrect word and then supplies the correct word should be labelled **self-correction**, not substitution plus insertion. The system should keep a configurable hold window—initially about **two seconds or the next two spoken tokens**—before finalising a high-confidence mismatch. A pause should be labelled hesitation only when audio-quality and voice-activity evidence indicate that the child is present but not progressing. These are starting parameters for calibration, not universal pedagogical constants.

## 5. Accent-aware correctness

### 5.1 Scope one accent honestly

The challenge materials require one accent measured properly rather than broad unsupported claims.[4] The team should select **one named local regional variety based on recruitable speakers and an available literacy/phonetics reviewer**. The comparison cohort should use the same age band, passage, device class, and recording conditions. Accent membership should come from parent/guardian and participant metadata; the system should not infer or label a child's accent automatically.

### 5.2 Build a passage-specific pronunciation set

For every passage word with likely regional variation, create a small pronunciation record:

| Field | Example function |
|---|---|
| Canonical token | Connects the pronunciation to one passage word |
| Standard pronunciation | Provides a reference phoneme sequence |
| Approved regional variants | Encodes legitimate alternative realisations |
| Context | Records whether the variant depends on neighbouring sounds or word sense |
| Evidence source | Names the phonetician/literacy reviewer and local speakers who confirmed it |
| Decision rule | Defines when the variant must be accepted and when evidence remains uncertain |

The prototype should use a pronunciation or phoneme score only as **supporting evidence**. It should never reject a word solely because it differs from a standard pronunciation dictionary. If the ASR text is wrong but acoustic/phonetic evidence supports an approved local form, the correct action is **STAY SILENT** and the log should record `APPROVED_ACCENT_VARIANT`.

### 5.3 Model audio

For the minimum build, record the target passage words with a trusted adult speaker of the selected variety. This is simpler, more controllable, and more culturally appropriate than voice cloning or a large neural TTS system. MODEL should play only after a light prompt and a failed retry. The child is not being trained to imitate Received Pronunciation or any other prestige accent.[3]

## 6. Safe intervention policy

The first prototype should use a deterministic state machine, not a learned or generative decision model. A compact state machine is easier to audit and calibrate with a small dataset.

### 6.1 Initial policy

| Observed state | Action | Rationale |
|---|---|---|
| Stable exact match | **STAY SILENT** | Correct reading needs no interruption. |
| Approved regional pronunciation | **STAY SILENT** | Accent is legitimate variation, not error. |
| Low confidence, conflicting ASR alternatives, noise, or unstable partial transcript | **STAY SILENT + log for review** | Uncertainty cannot justify correcting a child. |
| Possible substitution with self-correction window still open | **STAY SILENT** | Preserve agency and allow self-monitoring. |
| Self-correction completed | **STAY SILENT + positive event in record** | Self-correction is a strength, not a fault. |
| Confirmed stall after a calibrated pause | **PROMPT** | A light cue is the least intrusive useful action. |
| High-confidence mismatch that remains after the hold window and is not an approved variant | **PROMPT** | Correct only when evidence is strong and stable. |
| Prompt issued and target still not produced after the retry interval | **MODEL** | Supply the word cleanly after the child has had a chance. |
| Multiple simultaneous uncertainties | **STAY SILENT + teacher flag** | The system does not have enough evidence to intervene. |

### 6.2 Starting thresholds to calibrate

The team may begin with the following engineering defaults and adjust them only on the development set:

| Parameter | Initial engineering value | Calibration objective |
|---|---:|---|
| Partial-result stability | Same leading word sequence in two consecutive updates spanning at least 400 ms | Prevent volatile partials from triggering actions |
| Self-correction hold | 2.0 seconds or two following spoken tokens | Minimise premature prompts |
| Stall prompt | Approximately 3.0 seconds without progress, after passing audio-quality checks | Avoid interpreting normal phrasing as a stall |
| Retry-to-model wait | Approximately 3.0 seconds after the prompt | Preserve a genuine retry opportunity |
| Error-action threshold | Select threshold that reaches at least 95% precision on labelled development events | Prefer missed errors to false corrections |

These numbers are not learning-science claims. They are safe initial settings for a measured calibration exercise. A literacy specialist must approve the final timing.

## 7. Prototype implementation options

The underlying recogniser should be replaceable. The same labelled child-audio holdout set must be used for every option.[5]

| Approach | Tradeoffs | Cost | Setup Complexity |
|---|---|---|---|
| **Open/pretrained ASR baseline with an offline-first evaluation harness** | Fastest way to build alignment, accent logic, and metrics. It may perform poorly on children and should not be treated as the production recogniser. Sentence-finalized feedback is safer than volatile live partials. | No specialist licence; compute and engineering time remain. | Low to medium |
| **Specialist children's-ASR service using file or short-chunk requests** | Strong domain fit and reading-event outputs may reduce engineering, but true streaming, UK/Ireland accent results, privacy terms, retention, and pricing require verification. | Commercial evaluation or licence likely. | Medium |
| **On-device child-optimised SDK with live partial results** | Best privacy and control potential. Reader-Leader must still build reference alignment and decision policy, and detailed word/phoneme evidence may arrive only at finalisation. Device/browser performance must be tested. | Commercial SDK plus device-integration effort. | Medium to high |

The sprint should not lock the judgment layer to one provider. Build the adapter first, evaluate at least one open baseline, and insert a specialist candidate when credentials or an SDK trial are available. A provider without stable word timing/confidence cannot be permitted to trigger child-facing correction.

## 8. Minimum data and annotation plan

### 8.1 Two evidence levels

| Level | Minimum sample | Purpose | Permitted claim |
|---|---|---|---|
| **Engineering shakedown** | Approximately 12 consented children: six in the selected regional cohort and six comparison speakers; one calibration list and two short passage reads each | Find integration, accent-variant, latency, and annotation failures | Demonstrates that the pipeline works; no readiness claim |
| **Evidence-bearing pilot** | At least 24 consented children: twelve per cohort, with speaker-disjoint development and holdout sets; enough reading opportunities to include at least 200 adjudicated non-correct events | Estimate error/action performance with uncertainty and subgroup reporting | Supports a narrow one-passage, one-accent prototype claim only |

If recruitment produces fewer speakers or too few naturally occurring miscues, report counts and uncertainty honestly. Do not manufacture a child-performance claim using adult or synthetic voices. Adult/synthetic audio may test plumbing but cannot validate child recognition.

### 8.2 Recording protocol

Use one target age band and record the same passage under the same device and room instructions. Capture 16 kHz or higher mono audio without destructive noise suppression. Include a short microphone check, a short calibration list covering likely accent-sensitive words, and two passage attempts. Keep speaker identity out of filenames. Store consent separately from pseudonymous audio IDs.

### 8.3 Gold annotation schema

Each reference token or time span should receive one of the following labels: `correct`, `valid_accent_variant`, `substitution`, `omission`, `insertion`, `repetition`, `hesitation`, `self_correction`, or `unintelligible_noise`. A qualified literacy specialist should own the reading-behaviour label. A phonetically trained reviewer or local-variety expert should adjudicate accent-sensitive cases.

At least 20% of recordings should be independently double-labelled. Report class-level agreement and Cohen's kappa, but also list disagreements because rare categories can make one summary coefficient misleading. Adjudication must occur before the holdout results are revealed.

### 8.4 Split discipline

All calibration and threshold selection must be **speaker-disjoint** from the final holdout. No audio or events from a holdout child may be used to build the pronunciation list, tune thresholds, or change alignment weights. Freeze the passage, normalization rules, accent variants, state machine, and thresholds before the final run.

## 9. Metrics and acceptance gates

### 9.1 Primary metric

Define the token-level false-correction rate as:

```text
FCR = corrective actions on human-labelled CORRECT or VALID_ACCENT_VARIANT tokens
      --------------------------------------------------------------------------
      all human-labelled CORRECT or VALID_ACCENT_VARIANT token opportunities
```

A corrective action is PROMPT or MODEL. Report raw numerator and denominator, not only a percentage. Also report **false-action share**—false corrective actions divided by all corrective actions—because a system that rarely acts may have low token FCR while most of its actions are still wrong.

### 9.2 Supporting metrics

| Metric | Why it matters | Reporting rule |
|---|---|---|
| Standard WER | Measures free-transcription insertions, deletions, and substitutions | Report overall and by cohort; document normalization |
| Variant-aware reading-event accuracy | Measures whether approved pronunciations are accepted | Keep separate from WER; do not rewrite the transcript before WER |
| Correct/variant stay-silent rate | Directly measures restraint | Report overall and per cohort |
| Corrective-action precision and recall | Shows the cost of acting versus missing an error | Precision is the priority for v0 |
| Event-level precision/recall/F1 | Assesses substitutions, omissions, repetitions, hesitations, and self-corrections | Report per class; do not collapse self-correction into error |
| Premature-intervention rate | Detects prompts issued before a self-correction | Use the human-labelled correction window |
| Abstention rate | Shows how often uncertainty is routed to review | Report whether abstentions are useful or excessive |
| Stable-result latency | Measures ASR finalisation and action timing | Report median and 95th percentile |
| Accent gap | Detects unequal false correction or recognition | Report absolute difference and confidence interval |

### 9.3 Working sprint gates

The following are **prototype gates to be approved by the literacy lead**, not production guarantees:

| Gate | Initial target |
|---|---:|
| False-correction rate | ≤2% overall and ≤3% in each cohort, with raw counts and 95% confidence intervals |
| Stay silent on correct or approved-variant tokens | ≥98% overall |
| Corrective-action precision | ≥90%; recall may be lower in the first prototype |
| Approved-variant acceptance | ≥95% on the frozen variant set |
| Premature prompt before completed self-correction | ≤5% of self-correction events |
| Accent disparity in false correction | No more than 1 percentage point absolute difference, subject to sample uncertainty |
| Decision traceability | 100% of PROMPT/MODEL actions include reference token, timestamps, audio slice, confidence, and reason code |

For the final showcase passage, the desired result is zero false corrections. If zero are observed, report the number of correct/variant opportunities and the confidence interval; do not claim the true rate is zero.

## 10. Ten-working-day implementation plan

| Day | Work | Output and exit criterion |
|---:|---|---|
| 1 | Freeze one passage, age band, selected accent cohort, comparison cohort, event taxonomy, consent/assent text, and recording protocol | Signed scope; no unresolved definition of “correct,” “variant,” or “self-correction” |
| 2 | Build browser recording and audio-quality checks; record trusted local-accent model words | Valid WAV/stream capture; poor recordings request retry; model audio is ready |
| 3 | Implement replaceable ASR adapter and run an open baseline on a few consented samples | Stable JSON word/timing/confidence contract; free-transcription evidence preserved |
| 4 | Implement normalization, active-window alignment, event candidates, and audio slicing | Unit tests cover exact match, substitution, omission, insertion, and repetition |
| 5 | Build the passage-specific accent-variant set with expert/local-speaker review | Frozen variant file; every accepted variant has provenance and test audio |
| 6 | Implement hesitation/self-correction state and deterministic action gate | Replay tests show partial results never trigger correction and uncertainty abstains |
| 7 | Integrate PROMPT / MODEL / STAY SILENT into the thin child UI and reviewer log | End-to-end sentence-finalized demo; every action is auditable |
| 8 | Collect/label the engineering set; double-label at least 20%; calibrate only on development speakers | Error analysis, agreement results, and threshold choice are recorded |
| 9 | Freeze code/configuration and run the speaker-disjoint holdout once | Cohort-stratified metrics, confidence intervals, latency, and error list generated |
| 10 | Fix only implementation defects revealed by the frozen evaluation, rerun under a versioned configuration, and prepare the demo narrative | Reproducible build, versioned metrics, known-limitations sheet, and fallback demo recording |

## 11. Suggested minimal technical stack

| Layer | Minimal choice | Why |
|---|---|---|
| Child UI | Small browser application using the MediaRecorder/Web Audio APIs | Lowest-friction capture and text highlighting |
| Service | Python FastAPI or an equivalent small service | Good fit for audio adapters, alignment, and evaluation code |
| ASR | Adapter around one open baseline and, when available, one specialist trial | Enables honest comparative evaluation and avoids vendor lock-in |
| Alignment | Custom weighted dynamic programming over active passage tokens | Transparent, testable, and suited to a known text |
| Pronunciation evidence | Passage-specific phoneme variants from a pronunciation lexicon plus expert review | Keeps accent scope small and auditable |
| State/policy | Deterministic finite-state machine | Safer and more explainable than an LLM for child-facing correction |
| Model word | Pre-recorded adult local-accent clips | Immediate, controlled, and avoids voice-cloning risk |
| Storage | Local encrypted files plus SQLite/JSONL for the prototype | Sufficient for pseudonymous sessions and reviewable audit records |
| Evaluation | Python scripts using edit distance/WER, pandas-style summaries, and confidence intervals | Reproducible metrics without a large analytics stack |

The supplied notebooks can contribute tokenization, edit distance, n-gram, classification-evaluation, confusion-matrix, and Hugging Face integration patterns. They should not be mistaken for an ASR starter project.[2]

## 12. Test suite

### 12.1 Deterministic unit and replay tests

Create fixed audio/text fixtures for exact reading, one substitution, one omission, one insertion, one repetition, a pause, a self-correction, background noise, an approved accent variant, and an unapproved/uncertain pronunciation. Replay the ASR event stream to test the decision engine without repeatedly calling the provider.

### 12.2 Required behavioral tests

| Scenario | Required behavior |
|---|---|
| Correct standard pronunciation | STAY SILENT |
| Correct approved regional pronunciation that ASR mis-transcribes | STAY SILENT and record variant evidence |
| Low-confidence disagreement between ASR alternatives | STAY SILENT and flag for review |
| Clear substitution followed quickly by correct word | STAY SILENT; record self-correction |
| Confirmed stall | PROMPT after calibrated wait |
| Prompt followed by correct retry | STAY SILENT; do not MODEL |
| Prompt followed by continued stall/failed retry | MODEL once |
| Background speaker or overlapping speech | STAY SILENT; mark uncertain/noise |
| Provider partial changes from wrong to right | No correction from the wrong partial |
| Audio dropout/clipping | Ask to retry recording, not retry the word |

## 13. Risk register and fallback rules

| Risk | Consequence | Mitigation / fallback |
|---|---|---|
| Adult-trained baseline performs poorly on child speech | High WER and misleading event labels | Benchmark rather than conceal the gap; use specialist trial when available; abstain aggressively |
| Reference bias forces expected words | Genuine mistakes disappear | Preserve free transcription and alternatives; align only afterward |
| Accent variant mistaken for an error | Harmful false correction and fairness failure | Frozen expert-approved variants, local-speaker evidence, subgroup metrics, and default abstention |
| Unstable streaming partial triggers action | Child is interrupted incorrectly | Partials may highlight only; act on stable/final evidence |
| Too few natural mistakes | Correction precision cannot be estimated | Add a separately labelled calibration activity designed by the literacy specialist; report it separately from natural reading |
| Too few child recordings | Invalid child-recognition claim | Use adult/synthetic data only for plumbing and explicitly withhold performance claims |
| Specialist service lacks word timing/confidence | Unsafe intervention timing | Use it only for post-read analysis; do not permit live correction |
| TTS voice models an unfamiliar prestige accent | Pedagogical mismatch | Use pre-recorded words from a trusted local adult speaker |
| Small sample hides accent disparity | False fairness confidence | Report speaker-level results and uncertainty; label conclusions provisional |
| Child audio retained too long or reused | Privacy and safeguarding failure | Consent/assent, minimization, encryption, separate identity store, deletion schedule, no training reuse without explicit opt-in |

## 14. Responsible-data checklist

Before recording a child, complete a project-specific privacy and safeguarding review. The minimum process should include parent/guardian consent, child assent in age-appropriate language, purpose limitation, named access roles, pseudonymous IDs, encryption, a short retention period, deletion verification, and an explicit prohibition on model training reuse without separate opt-in. The project should prepare a data statement that identifies represented and missing ages, accents, devices, and recording conditions. Every automated decision must remain reviewable and reversible by a qualified adult.[4] [6]

## 15. Definition of done

The Stage 4 minimum prototype is complete only when all of the following are true:

1. A child can read the frozen passage in the browser and the system captures usable audio.
2. The recogniser produces time-aligned evidence through a replaceable adapter.
3. The aligner emits the agreed reading-event categories without forcing the expected text into the evidence.
4. The frozen pronunciation set causes legitimate selected-accent variants to be accepted.
5. Correct, variant, and uncertain cases resolve to STAY SILENT.
6. A confirmed stall or persistent high-confidence error produces one light PROMPT.
7. MODEL occurs only after the prompt and failed retry, using the selected local-variety recording.
8. Every PROMPT and MODEL has an audio slice, reference token, confidence, reason code, and review path.
9. A speaker-disjoint holdout report publishes WER, false-correction counts/rates, action precision/recall, self-correction behavior, latency, abstention, and accent disparity.
10. The limitations state clearly that the result covers one passage, one selected regional cohort, one comparison cohort, and a prototype—not production readiness.

## 16. Immediate next decisions

The engineering plan is deliberately provider-neutral, but four implementation choices must be frozen on Day 1: the child age band, the exact passage, the one named regional accent cohort, and the first ASR adapter available for testing. These choices do not change the architecture. They determine the pronunciation set, participant recruitment, and benchmark configuration.

The strongest first milestone is not a polished live demo. It is a **blind audio replay test** in which the system stays silent on an approved accent variant, prompts on a confirmed non-variant error, models only after a failed retry, and provides evidence for every decision. Once that replay is reliable, connect the same state machine to live audio.

## References

[1]: ./textbook-contents-catalog.md "Speech and Language Processing, 3rd edition: complete textbook contents catalog"
[2]: ./individual-source-catalog.md "Reader-Leader uploaded NLP materials: individual source catalog"
[3]: ./Reader-Leader-The-Student-Journey.pdf "Reader Leader: The Student Journey"
[4]: ./Reader%20Leader%20Challenge%20Statement.docx "Reader Leader Challenge Statement and Project Scope Notes"
[5]: ./ASR%20vendor_shortlist.pdf "Reader Leader Children's-ASR Vendor Shortlist"
[6]: ./Reader%20Leader_Methodology%20%281%29.pptx "Reader Leader Product and Pedagogical Methodology"
