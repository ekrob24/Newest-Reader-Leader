# What "fully implemented" would take

`asr-benchmark/` is in this repository and does not run. It is the contract for deciding
whether a speech engine is fit to put in front of a child: the metrics, the thresholds, and
the evidence required before any of them may be quoted. This document is the path from that
contract to an engine actually chosen and running — in order, with what blocks what.

It is deliberately separate from `ENGINE_PROPOSAL.md`. That file is a **record** of what was
measured and what was refuted, and it should stay stable. This one is **forward-looking** and
will be wrong the moment something on it gets done.

**The headline, before any of the detail: the blocker is not code.** It is twenty-four
consented child speakers and a two-reviewer adjudication process. Everything engineering-side
is a few weeks; the evidence is a term and an ethics approval.

---

## 1. Where this actually stands

| | |
| --- | --- |
| Live recognition | The browser's Web Speech API. Works, and its limits are measured. |
| The evaluation framework | Present, inert. Nothing imports it; `tsconfig.json` excludes it. |
| Consented child recordings | **None.** The framework's `data/example_*` files are synthetic fixtures. |
| A server-side engine | Behind a single interface, unused. No `OPENAI_API_KEY` is set, by rule. |
| The teacher review queue | Built, tested, and inert — see below. |

Much of what `ENGINE_PROPOSAL.md` listed as work has since been done, and it matters that the
list is not read as outstanding. Accuracy is off the child's and the parent's screens; pace is
withheld until a teacher has finished reviewing; `countsAgainstScore` counts a word only on
`teacher_confirmed`; and no audio is stored, because the object storage the save path would
write to is not configured. The product already behaves as though no
machine figure can be trusted, which is exactly the posture an engine has to land into.

---

## 2. What the gates actually demand

From `asr-benchmark/ACCEPTANCE_GATES.md`. Two groups, and the second is the hard one.

**Performance and safety** — what the engine must achieve:

| | |
| --- | --- |
| False correction rate | ≤ 2% overall, ≤ 3% in **each** cohort |
| Accent FCR gap | ≤ 1 percentage point between cohorts |
| Stay-silent on safe opportunities | ≥ 98% |
| Corrective action precision | ≥ 90% |
| Approved-variant acceptance | ≥ 95% |
| Premature prompts during self-correction | ≤ 5% |
| Stable result latency | p95 ≤ 1200 ms |
| Decision latency | p95 ≤ 1500 ms |

The cohort gap gate is the one that carries the product's fairness claim. A good average that
hides harm in one accent cohort fails.

**Evidence sufficiency** — what the *data* must be before any of the above may be quoted:

| | |
| --- | --- |
| Consented child speakers | ≥ 24 total, ≥ 12 per cohort |
| Development / holdout split | ≥ 6 per cohort in each |
| Adjudicated non-correct events in holdout | ≥ 200 |
| Holdout sessions double-labelled | ≥ 20% |
| Reference token coverage | 100% |
| Corrective-action traceability | 100% |

And explicitly: **synthetic and adult voices do not satisfy the evidence claim.** Every probe
run so far — the 440 Hz tone, the adult reads, the browser instrumentation — is diagnostic
work, not evidence about children, and none of it counts towards a single one of these rows.

`require_all_gates_evaluable` means a metric with no valid denominator **fails** the stage
rather than being quietly skipped. The framework refuses to return a partial pass.

---

## 3. The critical path

### Stage A — consent and ethics (the long pole, and not engineering)

Nothing downstream can start without this, and it is measured in months.

1. A DPIA covering children's voice recordings, the lawful basis, retention and erasure.
2. Ethics approval from whichever body governs the schools involved.
3. Informed consent from parents, and age-appropriate assent from the children.
4. Recruitment: ≥ 12 children in the selected regional cohort and ≥ 12 in the comparison
   cohort, from a population that actually has both.
5. A recording protocol — supervised, one speaker, a quiet room. The instrumented read in
   `ENGINE_PROPOSAL.md` transcribed two bystander conversations, one containing a person's
   name. That is the finding this protocol exists to prevent.

**Done when:** consent is documented per child, and recordings exist that a data protection
officer would defend.

### Stage B — make the framework runnable

Engineering, and small, but it cannot start before A.

1. Ingest real audio through `asr-benchmark/src/ingest_audio.py` and `INGESTION.md`.
2. Build the adjudication step. This is the part with no tooling today: every event needs a
   human label, 20% of holdout sessions need a **second independent** labeller, and
   disagreements need resolving. That is the real cost of Stage B and it is people, not code.
3. Freeze the approved-variant list with a linguist, so `variant_acceptance_min` is measured
   against something defensible rather than against this repo's five generated rules.
4. Split development and holdout by speaker, never by session.

**Done when:** `evaluate_asr.py` runs on real data and reports every gate as evaluable.

### Stage C — choose an engine on the evidence

1. Run each candidate through the same harness, same data, same splits.
2. Read the cohort gap before the headline number.
3. If nothing passes, the honest output is that nothing passes. The gates exist to be failed.

**Done when:** one engine passes every gate on the holdout, with intervals reported, and the
run is reproducible from the manifest.

### Stage D — integrate it

Only now does the product change. `ENGINE_PROPOSAL.md` costs this at **40–45 hours** and says
what to cut at half that; most of the "honesty work" in that estimate is already done, so the
remaining work is the engine service, the Node integration, the processing and unavailable
states, and the tests.

---

## 4. Two things the product cannot do today, measured rather than assumed

These are concrete blockers, already established, and they are why "just plug an engine in" is
not the shape of the work.

**The review queue has no confidence to rank by.** `readingWords.alignmentConfidence` exists
and is constrained; `server/readerDb.ts` maps it into the `score` that
`shared/reviewRanking.ts` orders by — and **nothing writes a value to it**. It is null on
every row of every saved reading, which the code says in as many words: *"the column a forced
aligner would write, and null on every row."* The ranking, `recallAtK` and `reviewCost` are
implemented, tested and inert; the screen reports itself unordered.

**The browser cannot supply that confidence.** Web Speech returns `confidence === 1` on every
result under `processLocally`, including on the bystander conversations it transcribed. A
constant is not a score, and ordering a queue by a constant would produce a screen that looks
ranked and is not. So `corrective_action_traceability_min = 1.00`, which requires an ASR
confidence on every corrective event, **cannot be met by the current live path at all.**

That is the strongest single argument for a server-side engine, and it is an argument from a
measurement rather than from preference.

---

## 5. What in the product would have to change

| | |
| --- | --- |
| `server/_core/voiceTranscription.ts` | The provider-agnostic interface already exists. A new engine lands behind it; no other file learns its name. |
| `readingWords.alignmentConfidence` | Starts being written. The review queue stops being inert. |
| Processing and unavailable states | A server engine takes time and can be down. Both need bounded, honest UI — a hanging spinner is one of the two failures this project has been about. |
| Recording | Whole-reading capture rather than the current browser-only path. |
| Audio retention | A storage path exists on the authenticated save and is unconfigured, so nothing is stored today. Configuring it reopens `ENGINE_PROPOSAL.md`'s storage decision, which is explicitly a pre-pilot blocker. |
| The browser path | Demoted, kept behind a flag. Not deleted — it is the offline fallback. |

Four standing constraints apply to all of it, and are not negotiable by this document: no
speaker identification or voiceprints, ever; no inference of a child's emotion, engagement or
confidence from their voice; no stored per-child accent, dialect or EAL label; and no model
judgement is ever final.

---

## 6. If none of this happens

Worth stating, because it is the likely case for some time and it is not a failure.

The product works today without any of it. A child reads aloud, the browser follows along, a
teacher reviews word by word, and the record follows the teacher. Every figure it publishes is
derived from a human decision. Nothing in it claims an engine it does not have.

What the framework buys is the right to say something stronger — *this engine does not correct
an Irish-English child more often than a comparison cohort, and here is the interval* — and
that sentence is worth nothing at all until twenty-four children have been recorded with
consent and two people have labelled the events.

Keeping the contract in the repository while the evidence does not exist is the point. It is
written down before it can be met, so that meeting it cannot be quietly redefined later.

---

| see also | |
| --- | --- |
| `asr-benchmark/README-IN-THIS-REPO.md` | why the framework is here and inert |
| `asr-benchmark/ACCEPTANCE_GATES.md` | the thresholds in full, with exact interpretations |
| `asr-benchmark/INGESTION.md` | the dataset contract and how data enters |
| `ENGINE_PROPOSAL.md` | what was measured, what was refuted, the open findings |
| `DATA_MODEL.md` | how the product stores judgements, and where a teacher's decision lands |
