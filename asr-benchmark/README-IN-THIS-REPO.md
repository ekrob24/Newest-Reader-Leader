# Read this first

**This directory does not run inside Reader Leader. Nothing in the product imports it, and no
result in it is evidence about children.**

It arrived from a second build and was brought in deliberately, inert, because the contract it
writes down is worth having in the repository before the evidence exists. Read this page before
`README.md` beside it, which describes the framework on its own terms.

## What this is

The **evaluation contract for the child-voice stage**: the metrics that would decide whether a
speech engine is fit to put in front of a child, and the thresholds that define a pass. It is a
Python framework with its own schemas, fixtures and tests, run from the command line against a
corpus of recordings.

It is a statement of what we would have to prove, written before we could prove it.

## What it is not

- **It is not wired to anything.** No TypeScript imports it. It is outside `tsconfig.json`'s
  `include` and named in its `exclude`; outside the `include` globs in `vitest.config.ts`;
  outside the roots in `scripts/assert-test-quality.mjs`; and it adds no CI job. Its
  `Dockerfile` and `compose.yaml` build the benchmark, not the product.
- **It is not a result.** Everything in `output/example/` is a synthetic fixture. The example
  run reports `"stage_pass": false` over **2 speakers and 9 events**. That is the framework
  working correctly, not a failing engine.
- **It is not a description of what Reader Leader does.** Some gates —
  `premature_prompt_max`, `decision_latency_p95_ms_max`, and the `state_machine` block with its
  `stall_prompt_ms` and `retry_model_ms` — describe a **live tutoring behaviour: software that
  prompts a child and models a word aloud while they read.** Reader Leader does not do that and
  does not ship it. It records a reading and gives a teacher a review screen. A reader of this
  directory must not conclude otherwise.

## Where the 2% comes from

`config/benchmark.yaml`:

```yaml
prototype_gates:
  fcr_overall_max: 0.02      # false-correction rate, overall
  fcr_per_cohort_max: 0.03   # and per accent cohort
```

**Written before we had any results.** It is the number the project has been measured against
since, and it is why the measurements recorded in `ENGINE_PROPOSAL.md` — 7.1% unprompted from
transcription, 2.5% from forced alignment on one adult — are reported as failures rather than
as encouraging.

## Why running it today returns FAIL

`config/benchmark.yaml` also sets evidence gates, and they are not about engine quality:

```yaml
evidence_gates:
  min_total_speakers_all_splits: 24
  min_speakers_per_cohort_all_splits: 12
  min_holdout_non_correct_events: 200
```

**Twenty-four consented child speakers, twelve per accent cohort.** We have four or five
readings from one adult — see `corpus/`, manifests only, no audio. Adult voices and synthetic
fixtures do not satisfy a child-speaker gate, and they are not meant to: the gates exist so
that a thin or convenient dataset cannot produce a pass.

So running this today returns FAIL **by design, on evidence sufficiency**, before any question
of how well an engine performed. That is the correct output and it should not be reported as a
problem with the framework or with the engine.

## What would have to happen before it means anything

Consented child speakers, recorded and annotated, across accent cohorts including Irish
English. That is the multi-reader measurement `ENGINE_PROPOSAL.md` keeps deferring, and this
directory is the specification for it.

## Two documents, not yet reconciled

`docs/evaluation/LESSONS_reader_leader_recurring_defects_v_1_1_2026-09-19.md` came from the same
build and overlaps `ENGINE_PROPOSAL.md`. **Both are kept intact and unreconciled on purpose.**
Merging them is a post-Galway job; doing it in a hurry would lose one of the two.

---

**What it would take to actually use this** — the consent and ethics path, the evidence
the gates demand, and the two things the product cannot do today — is in
`ENGINE_IMPLEMENTATION.md` at the repository root.
