# Moving off live browser recognition

What the measurements say, and what the product has to become as a result.

## What was measured

One adult reading a 42-word passage aloud, clearly, with **one word deliberately misread**
("hedgerow" for "hedgehog"). Same recording through five configurations of faster-whisper.

| run | model | match | speed | the deliberate error |
|---|---|---|---|---|
| 1 | distil-small.en, defaults | 88% | 6.1x | caught |
| 2 | distil-small.en + VAD, no carry-over | 88% | 9.7x | caught |
| 3 | small.en + VAD, no carry-over | 88% | 8.6x | caught |
| 4 | small.en + hotwords | 88% | 8.2x | caught |
| 5 | **small.en + full passage as `initial_prompt`** | **100%** | 7.5x | **erased** |

### The engine runs, and it is fast enough

6–10x real time on this CPU. A 60-second reading is transcribed in 6–10 seconds. Word
timings and per-word probabilities are exposed. Record-then-transcribe is viable on timing.

### Unprompted, it produces a false-correction rate of 7.1%

Every unprompted run made the same three mistakes on words that were read correctly:
`little` → "literal", `Amina stood` → "administered" / "have nisted", `safely` → "sagely".
Three false errors in 42 words.

**The project's own gate is ≤2% overall.** This is three and a half times over it, on an
adult reading clearly in a quiet room. A child, hesitant, in a classroom, will be worse.

### Nothing in the configuration space fixes it

- **Model size: no effect.** distil-small.en and small.en made *the same three errors*.
- **`hotwords`: no effect.** Run 4 is byte-identical to run 3.
- **VAD: no effect on accuracy.** It improved speed and did not stop the hallucination —
  every run invented trailing words over silence ("Ignition, Ignition", "omniscient
  omniscient").

### Prompting with the expected passage fabricates the answer

Run 5 returned the passage **exactly as written**, 42/42, and the deliberately misread word
was gone. Not corrected — **erased**. It also repaired the three genuine model errors,
which is the tell: the output is a copy of the prompt, not a record of what was said.

A 100% score on a reading that contained a known error is the worst possible result. If we
had shipped the naive "transcribe against the expected passage" design, it would have
reported every child as a perfect reader and we would have believed it.

### Confidence cannot rescue the unprompted path

The obvious salvage is to flag only low-confidence words. It does not work:

- `literal` — a **false** error — p=0.403
- `head`/`-rog` — the **real** error — p=0.484 / 0.568

The false error scored *lower* than the real one. Any threshold that suppresses the
software's mistakes also suppresses the child's. Confidence is useful for ordering what a
teacher looks at first. It cannot decide anything.

## What follows

**The engine cannot produce an accuracy figure about a child, and neither could anything
else we have.** That is not a defect to tune away; it is what a general-purpose ASR model
does. So the product stops claiming one.

This is less of a change than it sounds, because the architecture built this week already
assumes it:

- `readingWords.resolution` starts `unreviewed`.
- `countsAgainstScore()` counts a word only when `resolution === "teacher_confirmed"`.
- The teacher review screen shows "after your decisions" at 100% until a human confirms.

A 7% false-flag rate degrades gracefully through that design: the teacher dismisses some
flags. It would be catastrophic through a design that wrote a score into a child's record.

**What has to change is the claim, not mainly the plumbing.** `readingSessions.accuracy`
is currently computed from a transcript diff and shown to the child as "Story match 98%"
and to a parent in a summary. On these numbers that figure is not defensible and should not
be shown to a child or a parent at all. It stays as an internal signal for ranking what a
teacher reviews.

## The proposed flow

    record the whole reading  ->  transcribe once, unprompted  ->  surface candidates
        ->  teacher confirms or overrides  ->  only then does anything count

### Where the recording happens

In the browser, `MediaRecorder` over the whole reading rather than per page, `start()` with
no timeslice so there is a single blob at `stop()`. The empty-blob abandon at
`recorder.start(1000)` bit because a one-second timeslice can produce an empty first chunk
and the client dropped the save silently. Three changes stop it recurring:

1. One blob, taken at `stop()`, not a chunk stream.
2. An empty or oversized blob is a **reported outcome**, not an early return — it already
   routes through the save-outcome state added this week, which cannot show success for a
   response the server rejected.
3. The reading is saved even with no audio. `audioStatus` already records *why* audio is
   absent, so this is a state the record can express.

### Where the engine runs, and what the child sees

A FastAPI service alongside the Node server, on the internal network only, model baked into
the image — the shape `compose.yaml` in the engine repo already has. Node calls it behind
the existing transcription interface, so no caller changes.

The child sees a bounded, honest wait: "Reader Leader is listening back to your reading" with
elapsed seconds. At 6–10x real time a 60-second read is under ten seconds. **There is a
deadline** — 60 seconds — after which the session saves as `transcriptionStatus: "guided"`
and the child moves on. No spinner that can hang.

### When the engine is unavailable

Show it, stop, and save the reading without a transcript. The session is still recorded,
still visible to the teacher, still reviewable from the audio. **No fallback to cloud
recognition, silent or otherwise.** This is the same rule already applied to on-device
speech and to object storage.

### What survives unchanged

Verified by reading it, not assumed:

| Component | Survives |
|---|---|
| `readingWords` table and `buildReadingWordRows` | **Yes** — needs a transcript and word states, indifferent to source |
| `countsAgainstScore`, `accuracyFromWords` | **Yes** — reads judgement and resolution only |
| Teacher override, `saveTeacherInterventionDecision` | **Yes** — already writes through to the word rows |
| `analyseReadingText` alignment and dialect matching | **Yes** — takes expected text and a transcript |
| `audioStatus`, `unrecordedReadingAttempts`, save-outcome | **Yes** — built for exactly this |
| `readingSessions.accuracy` shown to child and parent | **No** — must stop being presented as a measurement |
| Live Web Speech highlighting | Demoted behind a flag, allowed to fail |

The one that does not survive is the one this measurement was about.

## Cost

**40–45 hours.** Recording rework 6; engine service 6; Node integration 4; processing and
unavailable states 6; removing the accuracy claim from child and parent surfaces 6; tests
and browser journey 8; packaging and deploy 6.

**At half that, 20 hours, I would cut the engine integration and keep the honesty work.**
Whole-reading recording, the bounded processing state, the unavailable state, and removing
the automated accuracy figure are all required *by this measurement*, whatever engine
arrives later. They are also the parts that fail in front of a judge. The engine can land
behind them.

What I would not cut: the deadline on processing, and removing the accuracy claim. A
hanging spinner and a fabricated percentage are the two failures this week has been about.

---

# Forced alignment: what it answered, and what it did not

Added after the transcription measurement above. The transcription runs all asked one
question — *what did she say* — over a fifty-thousand-word vocabulary, and `initial_prompt`
and `hotwords` are both ways of leaning on that same decoder, so they failed the same way.
Forced alignment asks a different question: for each expected word in turn, how well does
this audio match *this* word. Closed vocabulary, one target, one score per word.

`torchaudio.functional.forced_align` with the `MMS_FA` bundle. One adult, one passage, one
quiet room, forty-two words. Indicative, not a number to quote.

## It fixes the failure that killed the transcription route

`little`, `Amina`, `stood` and `safely` were all reported wrong by transcription although
they were read correctly. Alignment scores them 0.9488, 0.8468, 0.9985 and 0.8422 — far
above both deliberate errors. The specific failure is gone.

## It does not produce a clean threshold

| | |
| --- | --- |
| omission `golden`, not read | 0.3978 |
| substitution `hedgerow` for `hedgehog`, not read | 0.4132 |
| lowest word **read correctly** — `gate` | **0.1864** |

No threshold separates them. The lowest threshold catching both errors also flags `gate`:
one false correction in forty words of reading opportunity, 2.5%, against a ≤2% gate.

An earlier version of the probe reported a clean gap of +0.086. That was wrong, and the
cause was in our own code: it held the two words flanking an inserted word out of the
comparison, which stopped a word that could only lower the threshold from lowering it. A
live system does not know an insertion happened and cannot exempt anything.

## The missing arc, confirmed for omissions and refuted for insertions

Both contaminated words sat beside a place where the script did not match the speech, and
linear forced alignment has no arc for a word that is not in the script: every frame must
be accounted for by some word in the chain, so unscripted audio is absorbed by a neighbour.

Tested directly — same audio, same emission computed once, only the word sequence differing:

| | before | after | change |
| --- | --- | --- | --- |
| `made`, with the omission written into the script | 0.4990 | **0.9560** | +0.4570 |
| `gate`, with the insertion written into the script | 0.1864 | **0.2359** | +0.0495 |

The omission mechanism is confirmed: `made` returned to the normal band and its span grew
from 0.38s to 0.62s, taking back the audio that had been forced onto the absent word. The
insertion mechanism is refuted: `gate` barely moved, while the inserted `wooden` scored
0.8415, so the aligner is confident the extra word is there and still does not find a
convincing `gate` after it. That word's low score has some other cause.

The control was exact both times — forty-one of forty-two words identical to four decimal
places, spans included. A script/speech mismatch stays local rather than spreading down the
reading. Caveat: Viterbi is globally optimal, so locality is a property of this recording's
strong acoustic evidence, not a guarantee of the method. Re-check it on a mumbling child
before relying on it.

## Deferred decision: a flexible alignment graph

**This is the correct engineering answer for insertions and omissions, and we are choosing
not to do it this week.**

Replace the linear chain of expected words with a graph carrying skip arcs, repeat arcs and
a garbage arc between every pair of words, so inserted speech has somewhere to go instead of
being absorbed by a neighbour. This is what reading tutors have done since the LISTEN work
at CMU, and it is the established approach rather than an invention.

The `gate` result narrows what it will buy us — it does not remove the missing arc, but it
shows that at least one contaminated word had a different cause, so a graph alone should not
be expected to clear the whole problem.

**Estimate: 16–24 hours.** Building the graph from the expected passage 4; a CTC decoder over
it rather than `forced_align`, which only takes a linear target 8; garbage-arc weighting and
the calibration that goes with it 4; tests and a measurement run 6. The wide end is because
`torchaudio.functional.forced_align` cannot express this, so it means either a custom Viterbi
over a hand-built graph or a dependency such as `k2`/`kaldi`, and that choice is not made.

## Deferred probe: the unprompted transcript as a second, differently-failing signal

The unprompted Whisper transcript is useless for scoring — that is the 7.1% above. But a word
in it that appears nowhere in the expected passage is *insertion evidence*, and it fails
differently from alignment. The timing signal cannot do this job: in the probe reading the
0.36s of uncovered audio at the insertion was smaller than five ordinary between-word pauses,
the longest of which was 1.34s. Two weak signals that fail in different ways may do what
neither does alone.

Probe-sized, perhaps 4 hours, and not now.

## Built, and not live — say it this way

**The review queue and its measurement are built. The engine that would feed them is measured
and not integrated.** That sentence is the accurate one and it is the one to use.

**We cannot say the product ranks words by confidence for teacher review.** It does not.
`alignmentConfidence` is null on every row of every saved reading, because the current
pipeline compares transcript text and has no per-word score to write there. So
`shared/reviewRanking.ts` is correct, tested and inert: in production the queue reports itself
unordered and the screen says the words are in reading order, not review order.

What is true today, and what is not:

| | |
| --- | --- |
| The ordering, recall@k and review cost are implemented and tested | true |
| The teacher review screen shows a per-word queue with audio spans | true |
| That queue is ordered by confidence | **false today** — nothing writes a confidence |
| The product ranks words by confidence for teacher review | **false today** |
| Forced alignment can produce such a score | measured, and it does not yet separate cleanly |

This is the fourth time in this project that something has existed without a live caller:
`readingWords` unreadable through the tenant seam while writes succeeded, `onWordAttempt`
declared and passed and never invoked, the derived word-score table built before anything
called it, and now this. Every one was found late and none was found by reading the code. The
only defence that has actually worked is writing it down where people read, so it is written
down here.

## The measurement changed

False-correction rate is the right metric for software that scores a child on its own. We are
not building that, and the last surface where we pretended to has been removed. What we are
building tells a teacher where to listen; she confirms or overturns, and nothing counts until
she does. A word ranked wrongly low costs her ten seconds; a word scored wrongly costs a child
a false record.

So the measurements are **recall@k** — with the k lowest-scoring words surfaced, what fraction
of the real errors does she see — and **review cost** in words and minutes against the ten to
fifteen minutes a running record costs today. Both live in `shared/reviewRanking.ts`. On the
probe reading both errors were ranks 2 and 3 of 42, which with two errors is an anecdote and
not a rate.

## What the multi-reader run must produce

Designed in now because it is expensive to retrofit:

- **Per-word scores retained per reader**, same passage for everyone, accumulating in
  `probe-results/reading-corpus.jsonl`. This is the reference distribution.
- **Every word tagged by shape** — syllable count, coda type, position against punctuation
  (`scripts/wordshape.py`). The open question is whether score varies with the *word* rather
  than with correctness. The two lowest correctly-read words were `gate` (short, stop-final,
  before a comma) and `hedge` (short, affricate-final, sentence-final). Two words is nothing,
  but a systematic underscore false-flags the same words for every child, which is far worse
  than a random one.
- **If that hypothesis survives, a single global threshold is the wrong instrument**, because
  a word's score would partly measure the word. The standard answer is normalisation: compare
  a word's score to the distribution for *that word* across readers who read it correctly.
  The corpus above is exactly that distribution.

## Words correct per minute, after the accuracy decision

Accuracy came off the child's and the parent's surfaces because it is a machine judgement
neither can check. WCPM was the same judgement in another unit — `correctWords / duration` —
and it stayed, which made the accuracy removal half a change.

It is not withheld outright, because unlike accuracy half of it is observed: duration is
measured, not judged. So the numerator is fixed instead. WCPM is now counted from the words a
teacher has confirmed, which is what a running record's WCPM has always meant; a
machine-derived one was the deviation.

**It is published only when the whole reading has been reviewed.** A figure from "confirmed so
far" would be a new unfounded assertion wearing the old one's clothes, and it would move under
a parent's feet as the teacher worked through the flags. Until then, an em dash.

There is **no reviewed state on a reading session**, so this is inferred: every word whose
judgement could be a miscue has a resolution of `teacher_confirmed` or `teacher_overridden`.
`auto` does not count — it means the system settled the word without a human. A reading with
no word rows at all returns false rather than true, because vacuous completeness is how a
figure gets published for a reading nobody has seen. The inference is a real cost: if a new
resolution value is added and not considered in `isReviewComplete`, this claim goes wrong
quietly. A stored flag would drift the same way `countsAgainstScore` exists to prevent, so the
inference is the better of two imperfect options — but it is the kind of thing to re-check
whenever `wordResolutionValues` changes.

When a teacher confirms real errors the figure drops, and it is left to drop. No floor, no
smoothing.

## Where a machine figure can still reach a person

Checked rather than assumed, because a screen is not the only way out of a system.

**There is no subject-access export in this codebase.** Searched for and absent. An Article 15
request returns the child's personal data, and a machine-derived accuracy held about that child
is personal data, so the obligation is unmet rather than leaking — and when that export is
built, the figure must be excluded or carry an explicit label saying it is an unverified
machine estimate no teacher has confirmed. `server/exportedFigures.test.ts` sweeps every path
that exists today and is where the new one belongs on the day it is written.

| path | audience | machine figure |
| --- | --- | --- |
| `reports.download` (markdown) | role-gated per audience | removed for child and parent |
| `reports.downloadPdf` | role-gated per audience | removed for child and parent |
| `sessions.childProgress` | child, parent, linked teacher | stripped at the boundary |
| `dashboards.parent` | parent | stripped at source |
| `sessions.processAndSave` / `save` | child | stripped, including the freshest copy |
| `sessions.audioUrl` | anyone linked to the profile | audio, transcript and timings only |
| `reports.monthlyTrend` / `monthlyTrendCsv` | **teacher only** | class-averaged story match |
| `reports.classVariationReviewPdf` | **teacher only** | none |
| `irishVariants.csv` | **teacher only** | none |
| `sessions.teacherReview` | **teacher only** | the full session row |

One thing to keep in mind about the trend export: it is a class average, but a class of a
single child makes that average an individual figure.

## Still unmeasured

Self-correction. It was missing from the first recording and it is the most common thing a
real child does: a child who says "hedge— hedgehog" has read the word correctly. If alignment
scores that like an error we flag exactly the readers working hardest, and no threshold fixes
it. `scripts/alignment-probe2.py` exists to answer it and has not been run.

And everything above is one adult in one quiet room. The multi-reader measurement still has to
happen, and it has to include Irish accents and at least one child.

---

# Storage, and three things the audit changed about how we review

## An error message is an assertion too

`reading.processRecording` stored the posted bytes and *then* transcribed them. On a
deployment without an `OPENAI_API_KEY` — which this project deliberately does not set —
transcription failed, the route returned an error, and the object stayed written. Every call
stored something and reported failure.

This is the project's characteristic defect arriving inverted. Every previous instance was the
system asserting a **success** it had not observed: "Your reading practice was saved" when it
was not, "no approved quiz yet" while serving one, "twenty seconds" for a three-second read, a
0% reading congratulated as perseverance. This one asserts a **failure** while having
succeeded. Same root: the reported outcome does not match what happened.

So the review question generalises. **"Does this claim have a source?" applies to the failure
path exactly as it applies to the happy path.** And the failure path is the worse place for it
to go wrong, because a route that appears broken gets ignored rather than investigated. This
one could have run for months looking like a bug.

The fix was to delete the write, not to reorder it. The bytes were already in memory for
transcription, nothing ever read the object back, and the key went into a variable that was
never used.

## A function that cannot reject is not validation

`safeAudioMimeType` maps `audio/webm`, `audio/ogg` and `audio/wav` to themselves and
**everything else to `audio/webm`**. It has no failure case. The bytes are never inspected, so
a zip, an image or an HTML file was accepted and stored as `.webm` with an audio content type.

A coercion cannot fail, so it never checks — and being named `safe…` it reads, at a glance,
like the check that is not happening. Whatever a normaliser is called, it is not validation,
and the two should not be confused in review.

## Assert the shape before matching the content

Three assertions in this repository have asserted nothing, and none was caught by reading it
back:

- `expect(true).toBe(true)`, standing in for a note that belonged in a comment.
- `all(... for r in [])`, vacuously true, short-circuiting past the real check behind it.
- Five `toMatch` assertions against a value that was always the empty string, because a
  response envelope was not being unwrapped. All five passed. The suite was green.

The third is the one worth recording, because it is this project's own defect — asserting
something that was never observed — appearing **inside the mechanism built to catch that
defect**. Only mutation testing found it.

**The rule: never match on a value you have not first proven is non-empty and of the type you
think it is.** `scripts/assert-test-quality.mjs` enforces the part that can be expressed
mechanically and runs in CI; the rest lives here, because a rule nobody can see is not a rule.

And the standard for a finding, which the audit settled: **pin it with a test whose assertions
go red when the fix lands**, and prove that by writing each plausible fix as a mutation and
checking which assertions it turns red. Whoever fixes it then has to come to that file and
state the new behaviour, so the fix cannot be partial and the finding cannot quietly evaporate.

## Teacher uploads and children's voices are in the same store

A stated fact about the current architecture, because it changes what the DPIA has to cover.

| prefix | contents |
| --- | --- |
| `reader-leader/recordings/{userId}/` | children's reading recordings |
| `reader-leader/materials/{teacherUserId}/` | teacher-uploaded source documents |
| `demo-playback/` | a generated test tone |

**Same bucket, same credentials, same proxy.** Every question asked about recordings applies
unchanged to teacher uploads, and the data protection summary does not mention them at all.

Open question, wanting a position rather than a code change: a product that invites teachers to
upload reading passages **will** receive copyrighted texts. The likely answer is a curated
licensed corpus so that teachers do not need to upload at all, plus a warranty at the point of
upload for the cases where they still do.

## Decision: object storage moves before any deployment that stores real audio

Not a question to answer — a decision with a deadline.

The presign call carries a full path and no bucket or prefix:

```
GET {forgeUrl}/v1/storage/presign/get?path={key}
Authorization: Bearer {forgeKey}
```

So the scope of what those credentials can reach is a property of the Forge key, which this
repository can neither see nor set. **We cannot ship children's voice recordings on a storage
credential whose scope we cannot inspect.** Not to a school, not with a DPIA, not with a
processor agreement that has to say where the data sits and who can reach it. "We do not know
what our storage key is bound to" is not an answerable position in front of a DPO.

**Before any deployment that stores real audio:** an S3-compatible bucket in an EU region that
we control, an explicit bucket policy, per-object keys we issue, and **no route anywhere that
presigns a caller-supplied path**. Consistent with the containerised deployment already chosen,
and it retires the class of problem rather than answering one question about it.

Still worth running once credentials are in hand, as diagnosis rather than a prerequisite:
presign a path outside the `reader-leader/` prefix and see whether Forge refuses. That tells us
what was historically exposed. It touches a possibly shared store, so it gets said out loud
before it is run.

---

# Found during the freeze

Four findings from the pre-final audit. Two were fixed because they broke what the product
claims to do; two are recorded so the judge brief can be corrected instead.

## Fixed: the five-error cap was discarding errors and storing them as correct

**The most serious defect found in this project.** `buildInterventions` keeps only the first
five non-correct events. Every expected word still becomes a row, but a word with no surviving
intervention is written with judgement `correct`, so **from the sixth error onward the
analyser's judgement was discarded and the word recorded as read correctly.**

Measured on a 20-word passage with 19 words misread:

| | |
| --- | --- |
| non-correct events found | 19 |
| interventions kept | 5 |
| **errors stored as `correct`** | **14** |
| settled accuracy after the teacher confirmed all five | **75%** |
| true accuracy | 5% |

The harm is not evenly distributed, and that is the point. A child with three errors has all
three recorded. A child with nineteen has fourteen stored as correct. **The worse a child
reads, the more accurate the record claims they are** — and the teacher cannot overrule what
she is never shown. A reading assessment that reports its weakest readers as perfect inverts
its own purpose, and inflates the record of exactly the children it exists to find.

**Fixed by refusing to assert, not by changing the scoring.** Two days before the final, moving
the cap would have changed the derived score, the review queue, the seeded data and the
browser journey at once. Instead the mismatch is now a hard stop: `isReviewComplete` returns
false, `accuracyFromWords` returns null, the settled WCPM follows, and the teacher's screen
says how many more errors were found than kept.

It needed nothing stored that was not stored already. `progress` carries what the analyser
decided about each word independently of whether an intervention survived, so a row that is
`incorrect` on progress and not an error on judgement is a discarded error. That detects all
14 of 14 with no migration.

**The real fix remains: record every non-correct event as a word row and cap at five only
where a teacher's screen renders them.** A display limit is being used as a data limit, and
that is the thing to undo. Estimated half a day, and it changes scoring, so it wants a quiet
week rather than a deadline.

## Fixed: the browser journey asserted a UI that no longer exists

The walkthrough failed at the teacher dashboard, waiting for `Ms Kelly's Reading Class`. Not a
regression — the tree from before this session's first commit fails identically. The dashboard
this repository was merged to adopt does not show the class name on its default view, and the
spec came from the older lineage and was never brought forward.

Two contributing facts worth keeping: the class label reads "All my classes" whenever a teacher
has more than one, and **the demo teacher has two**, because `provisionLocalDemoCohort` creates
"Ms Kelly's Reading Class" and `seed:preview` creates "Reader Leader Demo Class". So the
assertion was stale about data as well as about markup.

A test asserting something that had ceased to be true is this project's own defect appearing in
the test rather than the product — the same shape as an error message that reports a failure
which did not happen.

## To correct in the brief: there is no minimum group size anywhere

The brief states that fairness is measured at cohort level with a minimum group size so that
no number can identify one child. **No minimum is enforced in code.**

`buildMonthlyAssessmentTrend` averages however many entries a month has, including one. It
emits the session count into the CSV, so the n is visible, but nothing suppresses the row — and
because it groups by month, even a class of several produces a single-child row in a month
where only one child read. `computeFlagOverturnRate` divides by reviewed flags with no floor,
so n=1 yields 0% or 100%.

Both are behind `requireTeacher`, which limits the real disclosure, but the claim is about the
number and the number has no floor. Roughly an hour to add a floor and a suppression label to
both surfaces; until then the brief is wrong.

## To correct in the brief: lapse-and-delete is not implemented, and should not be built yet

The brief promises that a clip is kept until a teacher rules on it, and that an unreviewed flag
lapses, the clip is deleted, and it never counts against the child. **There is no lapse and no
deletion anywhere in the code.**

Not under two hours, and the reason is not code volume:

- `storage.ts` has presign-put and presign-get and **no delete**, and no Forge delete endpoint
  is known to us.
- There is **no scheduler** in the application at all.
- It **cannot be tested to the standard this project uses** — proving the object is gone, not
  that a row changed — because no environment, including CI, has storage configured.
- It would be **thrown away**: storage is already committed to move to an EU bucket we control.

Half a day to a day **after** the storage migration. Building it against Forge now is work for
a backend we are leaving.

The good half is worth keeping visible: `discarded_by_policy` means audio is scored and
discarded within the same request, so the ordinary production state is that nothing was ever
stored. That part of the story is true. Only the retained-clip path promises what it does not
do.

---

# The 21% was the cursor, not the recogniser

The finding that reframes most of this document. It was found by reading prior art from a
second build — `docs/Cursor_Reanchoring_Fix_v_003_2026-09-16.md`, which is in that zip and not
in this repository — before looking at our own code.

## What the prior art said

A single mis-heard word pinned their alignment cursor for the rest of a reading. Every word
after it, correctly recognised at up to 0.96 confidence, was compared against the wrong
expected token and discarded: **11 of 14 tokens never assessed, coverage 21.4%.** Their
conclusion, in their words: *"The recogniser was not the problem in these sessions. The tracker
was."*

The first human test of our live path reported **21%**.

## The same defect, independently, in our TypeScript

`deriveLiveWordStates` did not increment `expectedIndex` on a mismatch. `analyseReadingText`
looked exactly one expected word ahead. Measured on this project's own passage:

| transcript | live highlight | saved score |
| --- | --- | --- |
| perfect | 100% | 100% |
| one `a` dropped, word 3 | **7%** | 98% |
| one `the` dropped, word 11 | **17%** | 98% |
| two adjacent dropped | **7%** | **7%** |
| all thirteen function words | 5% | 10% |

**The adjacent pair in this passage is `into the`, at words 5 and 6** — precisely the two words
reported missing in the human test, and precisely what a recogniser drops when connected speech
reduces them to one blur.

So the 21% was never poor recognition. A dropped fifty-millisecond schwa forty seconds earlier
pinned the cursor, and everything after it was scored against the wrong word.

## What changed

Bounded re-anchoring in both, window 3, chosen from a sweep rather than taste — k=2 leaves
three adjacent drops collapsed, k=4 starts jumping to a later copy of a repeated word and costs
a legitimate hesitation 14 points. After: 95–98% on every single- and double-drop case, 93% on
three adjacent.

And the progress bar, which counted raw transcript words while the highlight counted matched
position, now counts matched position. Two elements telling a child where she is, from one
source.

## Any accent comparison made before this has to be re-run

The prior art notes they had attributed part of an accent fairness gap to the recogniser when it
was partly this bug: accent files produce more unstable observations, so they lose the cursor
sooner and score worse for a reason that has nothing to do with accent.

**The same applies to every fairness number in this project.** A fairness figure measured
through a matcher that pins on the first dropped function word is measuring the matcher, and
will read as a disadvantage to whichever cohort drops more function words. Any accent
comparison run before this fix is void and must be re-run after it — including anything the
multi-reader run would have inherited.

## Held deliberately: function-word handling

No special-casing of `a`, `the` or `into`. An isolated miss now costs one word instead of the
passage, and it may never need handling at all. That is measured before it is designed.

## The fixture lesson, again

Our 327 tests stayed green throughout, because the browser journey emits a perfect transcript:
the suite never contained the condition that breaks the code. The prior art reports the
identical failure — a regression suite clean through 45 releases because its fixtures held zero
unstable observations. A journey that drops a mid-passage word now exists, and with
re-anchoring removed it fails.

# First instrumented read from a real voice, and what it found

One recogniser instance, seventy-eight seconds, a real human reading aloud, zero recogniser
errors, 170 interim results and 9 finals. Measured by a browser agent instrumenting the live
page, not reasoned about. Three findings follow. The first is not a UI problem.

## The microphone is unconstrained, and that is a data protection finding

During the read, the recogniser transcribed **a conversation between bystanders** — about a
pub, and about someone called David — and then a second, unrelated conversation. Each ran
about twenty seconds and each was returned with full confidence, indistinguishable in the
result stream from the child's own reading.

This is not a robustness problem to be tuned. It is a processing question:

- **The recogniser records people who have not been asked.** A bystander in a classroom, a
  corridor or a kitchen is a data subject. Nobody obtained their consent, nobody told them,
  and the school's basis for processing a pupil's reading does not extend to whoever is
  audible near them.
- **Their speech enters the child's record.** Anything the recogniser returns becomes the
  transcript, is scored against the passage, and is stored on the child's session. A
  conversation about David is, in the database, part of a named child's reading.
- **Naming a bystander is worse than misrecording a word.** The example is not hypothetical
  colour: the transcript contained a person's name.

What this rules out, immediately: **the live recogniser must not run anywhere a reading is
unsupervised**, and a reading captured with bystanders audible is not fit to store. Note also
that this bears directly on the deferred storage decision in this document — the case for not
retaining audio is now stronger than the access-control argument alone made it, because the
audio does not only contain the child.

What it does not resolve, and must not be answered by guessing: whether a reading can be
constrained to one speaker at all without speaker identification, which this project will not
build. A push-to-talk boundary, a supervised-capture requirement in the deployment terms, or
both, are the candidates. **This is a decision for the DPO and the school, not a feature to
design.** It is recorded here so it is made before any pilot, not discovered during one.

## Web Speech `confidence` is always exactly 1, so it cannot feed the review queue

Every result in the instrumented read carried `confidence === 1`, exactly, including the
bystander conversations. This is what `processLocally = true` returns: the on-device path
reports no calibrated score.

This belongs beside `alignmentConfidence` in **Built, and not live — say it this way**, and it
closes off the shortcut someone will reach for. The review queue needs a per-word score to
order by. The browser cannot supply one. A constant is not a score, and ordering a queue by a
constant would produce a screen that looks ranked and is not — the same defect as the tricky
words list, one layer down.

So the table in that section gains a row:

| | |
| --- | --- |
| The browser recogniser could supply the confidence the queue needs | **false** — `confidence` is 1 on every result under `processLocally` |

## WCPM showed 23 against a passage that supports 32 to 46, and the duration is padded

The screen showed **23 WCPM**. Counted by hand from the same read: about **46** over the
55-second reading window, or about **32** over the full 78-second session. Neither is 23, and
no combination of the recorded figures produces it.

Two things are wrong and they should not be conflated:

1. **The formula is unexplained.** 23 is not the reading window, not the session, and not the
   settled-words figure. Until someone can derive it from stored values, the number on the
   screen is of unknown provenance. That is the same class of defect as the tricky words
   list: a figure presented as measured that nobody can trace to a measurement.
2. **Any session-derived duration is inflated.** The instrumented read contained **20.9
   seconds of dead time** after the child stopped, during which the recogniser continued and
   re-recognised. A denominator taken from the session rather than from speech is therefore
   about 27% too large here, which drags WCPM down by roughly the same proportion.

This does not reopen the settled-pace decision — WCPM is already withheld until a teacher has
reviewed, and already off the child's screen. It says that when a figure is published, its
duration must come from the span of speech, not the span of the session, and its formula must
be derivable from stored columns by someone who was not there.

## Latent, unconfirmed, and worth one measurement each

Recorded so they are not rediscovered. None is acted on.

- **`event.resultIndex` is never referenced** although the recogniser runs with
  `continuous: true`. The handler walks `event.results` from index 0 on every event. On this
  read it produced a correct transcript, so there is no observed defect — but it is the shape
  of code that reprocesses settled results, and one measurement would say whether it matters.
- **`SpeechRecognition.phrases` is unused** although the passage is known before the child
  starts. The API accepts a biasing vocabulary. Whether it helps, and whether it helps some
  readers more than others, is measurable and unmeasured. It is not to be enabled on the
  assumption that it helps: biasing towards expected words can also manufacture matches for
  words the child did not say, which would inflate accuracy for exactly the readers this
  product exists for.
- **`stop()` took 9 seconds** under continuous speech. That is the delay between a child
  pressing finish and the page responding, and it is a plausible contributor to the missing
  last sentence in the reading that produced the fabricated tricky words. Worth timing
  deliberately before anyone concludes the transcript truncation is fixed.
