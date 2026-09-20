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

## Still unmeasured

Self-correction. It was missing from the first recording and it is the most common thing a
real child does: a child who says "hedge— hedgehog" has read the word correctly. If alignment
scores that like an error we flag exactly the readers working hardest, and no threshold fixes
it. `scripts/alignment-probe2.py` exists to answer it and has not been run.

And everything above is one adult in one quiet room. The multi-reader measurement still has to
happen, and it has to include Irish accents and at least one child.
