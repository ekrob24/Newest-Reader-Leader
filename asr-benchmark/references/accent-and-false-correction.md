# Regional Accent and False-Correction Evaluation

Use this reference when designing or auditing the Reader-Leader Stage 4 evaluation. The central rule is: **a legitimate regional pronunciation is a correct reading, and uncertainty is not evidence of an error**.

## 1. Define the cohorts without automatic accent labelling

Select one named regional variety based on recruitable children, local speakers, and an available phonetics/literacy reviewer. Use a matched comparison cohort with the same age band, passage, device class, microphone instructions, room conditions, and number of reading attempts. Record accent/cohort membership from parent/guardian and participant metadata. Do not infer, expose, or automatically classify a child's accent from their audio.

Report speaker-level results as well as pooled results. With small samples, state the uncertainty and do not claim broad UK/Ireland, national, or multilingual coverage from one regional cohort.

## 2. Build a passage-specific pronunciation set

For each word likely to vary regionally, store:

| Field | Requirement |
|---|---|
| Canonical token | Passage token and token index |
| Standard pronunciation | Reference phoneme sequence and lexicon source |
| Approved regional variants | One or more reviewed phoneme sequences or acoustic descriptions |
| Context | Neighbouring sounds, morphology, stress, or word sense that conditions the variant |
| Provenance | Reviewer, local speakers, date, and evidence recording IDs |
| Decision rule | Evidence needed to accept, reject, or abstain |

Have a phonetics/literacy reviewer and local speakers approve the set. Do not create variants merely because an ASR engine frequently misrecognises a word. A frequent model error is not evidence of a legitimate pronunciation.

Use phoneme/pronunciation evidence as supporting evidence, not as a sole rejection rule. If a free ASR transcript is wrong but audio and reviewed phonetic evidence support an approved regional form, classify the reading as `valid_accent_variant` and output **STAY SILENT**.

## 3. Preserve acoustic evidence before reference alignment

Run recognition in free or lightly vocabulary-adapted mode when possible. Preserve the original transcript, word timings, confidence, N-best alternatives, and partial/final status. Only then align the hypothesis to the known passage. Never replace a low-confidence hypothesis with the expected word before measuring recognition; this hides true substitutions and makes false-correction rates meaningless.

Keep two separate results:

- **Recognition result:** what the ASR evidence says, scored with standard normalization and WER.
- **Reading-event result:** whether the evidence, pronunciation review, timing, and human label support correct, valid variant, substitution, omission, insertion, repetition, hesitation, self-correction, or uncertain/noise.

## 4. Gold labels and adjudication

For every reference token or time span, annotate:

`correct`, `valid_accent_variant`, `substitution`, `omission`, `insertion`, `repetition`, `hesitation`, `self_correction`, or `unintelligible_noise`.

A literacy specialist owns reading-behaviour labels. A phonetically trained reviewer or local-variety expert adjudicates accent-sensitive cases. Double-label at least 20% of recordings independently before revealing model outputs. Record disagreements and adjudication decisions. Freeze the pronunciation set, event taxonomy, normalisation rules, alignment weights, and thresholds before the speaker-disjoint holdout run.

Keep self-correction separate from error. If a child produces a likely wrong word and then the expected word within the configured correction window, label `self_correction`; do not count the completed event as a prompt-worthy substitution.

## 5. False-correction rate

Define token-level false-correction rate as:

```text
FCR = corrective actions on human-labelled CORRECT or VALID_ACCENT_VARIANT tokens
      --------------------------------------------------------------------------
      all human-labelled CORRECT or VALID_ACCENT_VARIANT token opportunities
```

A corrective action is **PROMPT** or **MODEL**. Report raw numerator and denominator, percentage, and a 95% confidence interval. For small samples, use an exact binomial or Wilson interval rather than presenting a fragile point estimate alone.

Also report:

```text
false-action share = false corrective actions / all corrective actions
```

FCR answers “how often did the system interrupt a correct opportunity?” False-action share answers “when the system acted, how often was it wrong?” Both are needed because a silent system can obtain low FCR while being unhelpful.

The primary safe-opportunity denominator includes both `correct` and `valid_accent_variant`. Never exclude accent variants from the denominator. Report a separate variant-acceptance metric:

```text
variant acceptance = accepted valid_accent_variant events / all gold valid_accent_variant events
```

## 6. Required subgroup metrics

Report, at minimum, by regional cohort and comparison cohort:

- WER on the original free transcript.
- FCR on correct and valid-variant opportunities.
- Correct/variant stay-silent rate.
- Corrective-action precision and recall on true non-variant errors.
- Variant acceptance rate.
- Premature prompt rate before completed self-correction.
- Abstention rate and uncertain/noise rate.
- Stable-result latency and prompt/model latency.
- Speaker-level distributions, raw counts, and 95% intervals.
- Accent gap: absolute difference in FCR and stay-silent rate between cohorts.

Initial prototype gates may be set at **FCR ≤2% overall and ≤3% per cohort**, **stay silent ≥98% on correct/variant opportunities**, **corrective-action precision ≥90%**, **variant acceptance ≥95%**, **premature prompts ≤5%**, and **accent FCR gap ≤1 percentage point**, subject to sample size and literacy-lead approval. These are conservative engineering gates, not production or learning-science guarantees.

## 7. Failure handling

- Low confidence, conflicting alternatives, noise, clipping, overlapping speech, or unstable partials → `uncertain/noise` and **STAY SILENT + review flag**.
- ASR text differs but an approved pronunciation variant is supported → `valid_accent_variant` and **STAY SILENT**.
- The child is still within the self-correction window → `self_correction_in_progress` and **STAY SILENT**.
- A model error appears after the hold window, is high-confidence, and is not an approved variant → permit **PROMPT**.
- A prompted retry fails and evidence remains stable → permit **MODEL** once.
- If the service provides no stable timings/confidence, use it for post-read analysis only; it must not trigger live correction.

Never “fix” an accent gap by relabelling difficult pronunciations as errors, deleting them from the denominator, or changing thresholds after inspecting holdout results.
