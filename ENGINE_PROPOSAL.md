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
