# Recurring defect classes in Reader Leader, and the check that catches each

**Purpose.** Thirty-two defect classes recurred across Reader Leader v2.2.0–v2.2.64 (the Stage-4 read-aloud
runtime, its browser client, the Docker/Windows deployment, the evidence layout, and the corpus tooling).
**Almost every one ran to completion and produced a plausible result** — a recording that ended early, an
SNR of 4.6 dB, a highlight that froze, a purge that printed "done" — rather than crashing. Most recurred
*after* being identified once, because the fix carried the code and not the lesson.

This is the same discipline as `LESSONS_recurring_defects_v2_1_16-08-2026.md` from the Elliptic notebook
lines, applied to a product with a child on the other end of it. The stakes are different in one way that
matters throughout: in a notebook a quiet wrong number misleads a reader; here a quiet wrong decision
tells a child they read incorrectly when they did not, and the design's headline metric — false-correction
rate — exists because that is the harm that ends adoption. Many classes below are therefore about the
**direction** of a failure, not just its presence.

---

## Document version control

**Version 1.1 · updated 19-09-2026** (supersedes 1.0 of 16-09-2026)

**Maintenance rule — for whoever updates this next, human or LLM.** Increment the version by **+0.1**,
set the date to the day you edit it in `dd-mm-yyyy`, add a row to the table below saying what changed,
and save under a filename carrying the new version and date. **Never edit in place under the same
version.** From v2.2.44 the changelog files follow the same rule (`CHANGELOG_v_<version>_<YYYY-MM-DD>.md`).

| version | date | change |
|---|---|---|
| 1.1 | 19-09-2026 | R23–R32 from the 2.2.44–2.2.64 releases: guessed values, tests that cannot fail, helpers whose output reaches nothing, generators destroying author content, success after failure, environment drift, confounded comparisons, a stronger model performing worse, denominators that hide, and guards a short input cannot reach. Ten checklist items added. |
| 1.0 | 16-09-2026 | R1–R22, distilled from the audits at 2.2.10, 2.2.31, 2.2.33, 2.2.38, 2.2.43 and the bug reports between them. Three meta-lessons. Pre-flight checklist. Tier C queued. |

---

**The meta-lesson that cost the most.** *A change that is correct in isolation has a second consumer.*
In three consecutive independent audits the most serious finding was the same shape: the layout move
that left `purge` deleting nothing (R1, 2.2.33); the WER guard on the per-session CSV that left the
cohort aggregate unguarded (R1, 2.2.31); the `openMic` throw caught on one screen and unhandled on the
screen before it (R1, 2.2.38). Every one was reviewed and believed. The fix is procedural: before
shipping a change to X, grep every reader of X and list them in the changelog.

**The second meta-lesson.** *"It ran" is not "it worked".* The health gate ran and said 4.6 dB. The
browser ran a cached client and reproduced a fixed bug. The corpus generator ran and would have said
"piper" over espeak output. In each case the artefact looked like the thing it was supposed to be. The
only defence that worked was measuring the artefact against an independent source: the WAV against the
SNR estimate, the console line numbers against the shipped file, the engine actually invoked against the
manifest field.

**The third.** *Predict the baseline; then run it.* I claimed downgrading `t_glottal` would move seven
fixture tokens. Running it showed **zero** — the rule had never fired in the fixtures. A prediction that
felt certain was wrong in the direction that would have caused a baseline to be re-accepted for a false
reason. The Tier A script now asserts byte-identity instead of trusting anyone's prediction.

---

## R1. A change with a second consumer that was not re-checked

**Shape.** Something is moved, renamed, made to throw, or guarded — and one of its consumers is updated.
The other consumer keeps working on the old assumption, silently.

**Instances — four, in four audits:**
1. **2.2.33.** `purge` still targeted `evidence\audio` after 2.2.30 moved recordings to
   `evidence\sessions\<id>\audio.wav`. It **reported success while leaving every child recording on
   disk** — the worst possible failure for a privacy control.
2. **2.2.31.** The per-session WER CSV was guarded against reference-conditioned (biased) sessions;
   `wer_by_cohort.json` aggregated through a separate path that never consulted `asr_mode`. A biased
   session would have contaminated the per-cohort WER — the number most likely to reach a slide.
3. **2.2.38.** `openMic` was made to throw when the AudioContext would not start; the read screen caught
   it. The mic-check screen, the *other* caller, did not — an unhandled rejection with no message.
4. **2.2.43.** `paths.audio_dir` remained in config after nothing read it — a trap for the next person to
   set it.

**Check.** Before changing anything with a name: `grep -rn <name>` and list every hit in the changelog
entry. A guard added to one consumer is a defect until it is added to all of them.

## R2. A stale client masquerading as an unfixed bug

**Shape.** A fix ships to the server; the browser keeps a cached copy of the old client; the symptom
persists; the fix is reported as not working.

**Instance — 2.2.24.** The 2.2.23 batch cap "didn't work": batches still grew 0.54 → 0.56 → 1.68 →
**4.36 s**. The console stack trace read `openMic @ app.js:317`, `startTransport @ app.js:381`; the shipped
file had them at 326 and 413. The browser was running last week's code against this week's server.

**Why it survived.** nginx served `/web/` with no cache headers, and nothing compared the client's idea of
its version with the server's.

**Check.** `no-store` on the app; a build string baked into the client; the header turns **red** and
reads `server vX · app vY` on mismatch. A stale cache can no longer look like an unfixed bug.

## R3. An estimator gated by an absolute threshold on a quantity of unknown scale

**Shape.** A detector decides "is this speech?" against a fixed dBFS number. Recordings differ in overall
gain by tens of dB, so the fixed line sits in the wrong place for most of them.

**Instance — 2.2.32.** `speech_energy_gate_dbfs = -50`. A recording whose noise floor sat at −50 dBFS had
its pauses and quiet syllables counted as speech, so SNR was computed as pause-minus-floor: **4.6 dB**
reported, microphone UNUSABLE for **21.5 of 27.9 s**, every token abstained, accuracy 18.2%. Independent
measurement of the same WAV: noise −50, speech −29, peaks −3 — **~22 dB**. Reproduced exactly: median
4.6 dB, p90 40 dB. The p90 was the speech. After the fix, same audio: **OK in 134 of 139 windows, median
38.6 dB**; next real session, SNR 33.16, accuracy 58.3%.

**The lesson within the lesson (2.2.33).** The first fix corrected the *speech* gate and left the *noise
floor* estimate on the absolute line — so in a room with a floor above −50 dBFS, no window qualified,
`noise_floor` was None, and SNR was **never assessed at all**. The detector went silent precisely where
it was most needed.

**Check.** Every gate is relative to a measured floor (the quiet end of the observed distribution). Test
the estimator against **five acoustic regimes** — the real reported recording, noisy-and-clear,
noisy-and-weak, quiet-and-clear, silence — and assert the verdict for each. One regime is not a test.

## R4. "Not assessable" defaulting to OK

**Shape.** A measurement cannot be made (insufficient dynamic range, no floor, no samples). The code has
a guard for that case, and the guard's fall-through is the *healthy* verdict.

**Instance — 2.2.33.** ~4 dB SNR gives too little spread to measure; that tripped the "not assessable"
guard, which returned OK. So the single worst real case — a room as loud as the child, where the
recogniser hears only mush — was reported as healthy audio. Circular: the condition that makes the
measurement impossible is the condition the measurement exists to catch.

**Why it survived.** My first attempt at a fix used a *consecutive-run* counter, and speech arrives in
bursts separated by pauses, so it never fired. A rolling comparison was needed.

**Check.** Audible energy with no assessable SNR is a **finding**, not an absence. For a child-facing gate
the safe default when the input is present but unmeasurable is *flag it*, never *pass it*.

## R5. A performance knob coupled to the wrong lever

**Shape.** Two parameters are bundled into a preset. One governs cost, the other governs quality. The
preset moves both to save cost and destroys quality.

**Instance — 2.2.28.** Presets shrank `window_ms` alongside `hop_ms`. `window_ms` is what gives Whisper
context; a 1500 ms window left it almost none. Recognition collapsed to *"Dave nights"*, *"Marriage?"*,
*"Peace"*, every word timed out as a stall, and a 14-word sentence produced **23 interventions** in a
71.9-second recording — a cascade of false corrections caused by a performance setting.

**Check.** Before bundling parameters, name which property each one governs. Presets vary the cost lever
(`hop_ms`) only; the quality lever stays fixed. Then `check_timing_sanity` warns when the confirmation
delay (`hop + stability`) is not comfortably below every challenge band's stall threshold, because the fix
exposed that interaction too.

## R6. A queue with no backpressure

**Shape.** A producer keeps enqueueing while a consumer is slow. Each batch is bigger than the last, so
the consumer is slower still. On stop, whatever is still queued is discarded.

**Instance — 2.2.23.** HTTP fallback POSTs: audio 0.54 / 0.56 / 0.56 / 1.68 / **4.74 s**; server time
0.05 / 0.05 / 1.6 / 4.7 / **17.3 s**. `finishRead` never drained. The WAV was **8.08 s** — exactly the
total audio POSTed — with speech at full level to the last sample. *Truncated, not silenced.*

**Check.** Cap the batch (1 s), cap the backlog (5 s, drop oldest, **count the drops and show them in
red**), keep draining while a backlog exists, and `await drain()` before finalising. Silence that is
logged with a reason is restraint; silence that is not logged is indistinguishable from failure.

## R7. A test whose subject changed underneath it

**Shape.** A test selects "the first" of something. Adding an item changes which one is first. The test
now measures a different subject and reports a wrong result for the right reason.

**Instance — 2.2.23.** The browser test picked the first story radio button. Adding stories in 2.2.19
made that `brave_knight` (14 words) rather than `fox_gate` (18). The fixture audio is a fox reading, so
the test reported 11 spans instead of 17 — and I spent an hour looking for a regression in that day's
changes.

**Check.** A test pins its subject explicitly (`fox_gate_v1`) and fails loudly if the subject is not
offered. Adding content must never silently change what a test measures.

## R8. A privacy boundary broken by a layout change

**Shape.** Data that must not leave the machine, or must be deletable, is moved — and a control built
around its old location keeps working on the old location.

**Instances — three:**
1. **2.2.33** — `purge` (see R1). Now counts recordings before, deletes, and **verifies** no `.wav`
   remains, reporting in red if one does.
2. **2.2.35** — no `.dockerignore`; `COPY . /app` baked `evidence/sessions/*/audio.wav` — **child
   recordings** — into the image layer. The bind-mount hid them at run time, which is exactly why it was
   invisible. Build context had grown from 18 MB to **222 MB**.
3. **2.2.43** — rendered corpus WAVs would have gone the same way on the next rebuild.

**Check.** A privacy control that reports success without checking is not a control. `.dockerignore`
excludes everything produced at run time; `purge` verifies; every new directory that can hold audio is
added to both on the day it is created.

## R9. A timing track that disagrees with its audio

**Shape.** Word timings and the audio they describe come from different runs, or the aligner emits gaps
or disorder. The highlight follows the timings, not the sound.

**Instances — three, each a different failure of the same contract:**
1. **2.2.29** — timings ran to 7.23 s over a **3.3 s** file. Highlight froze at *cold*, then jumped to the
   end when playback finished.
2. **2.2.36** — the aligner wrote `start_ms: null` for words it missed; the UI skipped nulls; the cursor
   sat on the last matched word while audio played on.
3. **2.2.38** — my gap-filler preserved out-of-order aligner timestamps, so the cursor could jump
   *backwards*.

**Check.** At build time: reconcile to the real WAV duration, interpolate gaps (marked `interpolated`),
force monotone. At run time: rescale to `audio.duration`, fill gaps again, and show the track's quality
under the player so a bad one is visible rather than inferred from a frozen highlight.

## R10. A diagnostic that names the wrong cause

**Shape.** A failure message is written for the condition the author imagined, and fires for a different
one. The reader goes to the wrong place.

**Instance — 2.2.37.** No audio reached the server (0 frames; audio hash `e3b0c442…`, the hash of empty
input). The free pass reported *"save_audio was off"* — and `save_audio` was **on**. I wrote that message;
it sent the reader to the wrong setting.

**Check.** One branch per condition, each naming its own. "The setting was off" and "audio was requested
but none arrived (0 frames received)" are different facts and point at different fixes.

## R11. A resource acquired after an `await` that consumed the permission to acquire it

**Shape.** Browser APIs that need a user gesture are called after an `await`. The activation window can
expire across the await; the call succeeds but returns a suspended object.

**Instance — 2.2.37.** `new AudioContext()` after `await getUserMedia`. The context started *suspended*;
`onaudioprocess` never fired; the microphone was open and the browser sent **zero bytes**. Intermittent by
nature, which is why it looked like lag.

**Check.** `await ctx.resume()`, then assert `ctx.state === "running"` or release the mic and say so. Plus
a 3-second watchdog: if no audio has reached the server, say it in red rather than let a child read into
nothing.

## R12. A label that excludes the case the test exists to detect

**Shape.** In a labelled corpus, a token is marked `unsure` (excluded from the denominator) when the
honest label is *right*. The file can then never register the false correction it was built to catch.

**Instances — and I made it twice, one version apart:**
1. **2.2.41** — `err_04` (2.5 s hesitation before *find*) and `err_05` (*house* then *horse*): the words
   *were* read correctly. The 2.5 s pause sits below the level-10 stall threshold and above level-50, so
   the file has a sharp expected outcome — no prompt at 10, a prompt at 50 that would be a **false
   correction**. `unsure` removed it from the count.
2. **2.2.43** — one version after fixing that, I labelled `cork_04`'s seven glottalled tokens `unsure`.
   Same flaw.

**Check.** The question is only ever *was the word produced?* If yes, the label is **right**, and the
expectation of the system's behaviour goes in `expect_by_level`. `unsure` is for tokens the labeller
genuinely cannot judge, and nothing else.

## R13. A test placed where the mechanism cannot run

**Shape.** A test targets a position where the code path it exercises is never reached.

**Instance — 2.2.43.** The repetition test repeated the **last** token, where the cursor is already at
the end of the passage and the repetition logic never executes. (The same shape as the lessons
document's D18/D28: a mechanism verified where its failure mode cannot occur.)

**Check.** For every test, ask *is the code I am testing reachable from this input?* Mid-passage, not
final token; a room above −50 dBFS, not a quiet studio; the HTTP transport, not only the WebSocket.

## R14. A formatting step that can raise inside the path that writes the record

**Shape.** Cosmetic work — building a relative path, a label, a URL — runs inside the critical section
that persists a session, and raises on an input the author did not anticipate.

**Instance — 2.2.41.** `finish()` called `audio_path.relative_to(root)`, which **raises** when
`paths.evidence` is configured outside the repository (a Docker volume on another disk). It ran after the
child had read. A path-formatting choice would have cost the session its record.

**Check.** Nothing in the finish path may raise for a presentational reason. `try/except ValueError` →
absolute path. The free pass was built on the same rule: a failed *measurement* must never cost the adult
their running record (proved by sabotaging the adapter mid-session).

## R15. Tests that write into live state

**Shape.** The test helper constructs the product with its default paths, so every test run leaves
artefacts in the real data directory. Eventually a test reads them.

**Instance — 2.2.41.** `service()` wrote into the repository's `evidence/`. The collate test finally
failed against **56 accumulated sessions** from earlier runs. The failure looked like a regression in that
day's edits and was not.

**Check.** Each test gets a temp evidence directory. Run the suite **twice** and assert the live
directory holds zero sessions after both.

## R16. Shell and PowerShell typing traps in operational scripts

**Shape.** A script that manages the deployment mis-parses because of a quoting or typing rule the
author did not know applied.

**Instances — two, each breaking an install:**
1. **2.2.22** — `for st in stories/*/; do … $st` inside a Compose `command:`. Compose interpolates `$VAR`
   before the shell runs; `$st` became empty; `add_story.py` got no path; the seed aborted.
2. **2.2.26** — `$lines = Get-Content | Where-Object …` returns a **string** when one line matches, so
   `$lines + "RL_AUDIO_PRESET=x"` concatenated: `RL_PORT=8080RL_AUDIO_PRESET=balanced`, and Compose failed
   on `invalid hostPort`. Worse: the script printed "preset set, runtime restarted" **after** the failure.

**Check.** `tools/lint_compose.py` fails on any single-`$` shell variable in a Compose command (in `make
test`). `.env` is rewritten through a parser, never string-appended. Every operational script checks the
exit code before printing success.

## R17. A tool that renders one thing and labels it another

**Shape.** A generator has a fallback path. The fallback engages silently; the metadata still records the
primary.

**Instance — 2.2.43.** `make_corpus.py` looked for Piper voices in `<repo>/voices`; the container has
them in `/models/piper`. Every file would have fallen back to **espeak** while the manifest named the
Piper voice — and the engine actually used was computed by `synth()` and then **discarded** by the caller.
Nothing could have told the user. The run instructions I had just written would have produced it.

**Check.** Whatever a tool actually did goes in the artefact it produced: `engine_used` per file. Read the
field after the first real render.

## R18. A claim about a baseline made by inference rather than by running it

**Shape.** "This change will/won't move the baseline" is asserted from reading the code.

**Instance — 2.2.44 lessons.** I claimed downgrading `t_glottal` would move seven fixture tokens (seven
tokens contain /t/). Running it showed **0 of 72** decisions had ever resolved through that rule. Had the
script trusted the prediction it would have re-accepted a baseline for a false reason — and a re-accepted
baseline is a permanent loss of the ability to detect drift.

**Check.** The Tier A script runs the fixtures and asserts **byte-identity**; it refuses to re-accept.
Any deliberate baseline change is a separate, named, human step.

## R19. A feature attributed to a variety it does not belong to

**Shape.** An accent rule is marked `accept` for a variety whose speakers do not produce it. The system
scores that realisation as correct for the wrong reason, and the fairness claim measures the wrong thing.

**Instance — 2.2.41.** `t_glottal: accept` in `rules/ie_cork.yaml`. Glottalling is Estuary/Cockney/
Scottish; the Cork /t/ is t-lenition (the slit-t). I had said exactly this when choosing rules for the
synthetic Niamh *voice* and left it out — but never removed it from the *decision* profile. The corpus
then built two "Cork" test files around it, entrenching the error.

**Check.** No `accept` rule without a variety-speaker's sign-off; the design already requires this and the
rule file now says so in the note. Every corpus file that renders a rule inherits that rule's review
status.

## R20. A cost attributed to the wrong component

**Shape.** Something is slow. The obvious component is blamed. The actual cost is in how the component
is being called.

**Instance — 2.2.32.** Live recognition ran at 1.2–3.4× real time; the finish-time free pass transcribed
27.88 s in **2.52 s — 0.09× real time**. Same model, same machine. The model was never slow; transcribing
a 3 s window every 0.5–1.5 s does two to six times the work of the audio itself. "Get a bigger GPU" was
the wrong first conclusion.

**Check.** Before blaming a component, measure the same component under a different calling pattern. A
number without that comparison attributes cost to whatever was nearest.

## R21. A rule file used both to generate the test and to judge it

**Shape.** Synthetic test audio is rendered from the same accent rules the decision layer uses to accept
variants. A pass means the rule file agrees with itself.

**Instance — 2.2.40.** The `cork_feature` corpus files are rendered from `rules/ie_cork.yaml` and judged
against variants generated from `rules/ie_cork.yaml`. "The system accepted the Cork *the*" proves nothing
about whether the Cork model is right.

**Check.** State the circularity in the recipe and the generated README. Read a synthetic pass as *"the
recogniser can hear the feature"*, never as *"the accent model is validated"*. Only recordings of actual
speakers of the variety validate it, and the corpus is marked `synthetic: true` on every entry so a number
from it cannot be quoted as a measurement.

## R22. A patch that reports success while writing nothing

**Shape.** A string replacement whose anchor matches nothing returns without error; the changelog
written alongside it claims the change.

**Instance — 2.2.42.** The `./corpus:/app/corpus` mount: my first pattern did not match the one-line
`volumes: [ … ]` form; the file was unchanged; the changelog entry saying "mounted" was already written.
Caught only because I printed the volumes list after the edit and read it.

**Check.** Assert the occurrence count of every anchor before and after (`count(old) == 1`, then
`count(new) == 1`) — the same rule the notebook lessons record as D29, arrived at independently here.
Print the resulting state, and look at it.

## R23. A value written from a log, a memory, or a guess, and presented as observed

**Shape.** A version, a digest, a threshold or a count is recorded as fact when it was never measured.
The artefact then looks authoritative and is wrong.

**Instances — three, in three days:**
1. **2.2.60.** Pinning `PyYAML==6.0.2`, `jsonschema==4.25.1`, `fastapi==0.118.0`, `uvicorn==0.37.0` — all
   four **invented**, none in the `pip list`. When finally observed they were `6.0.3`, `4.26.0`,
   **`0.141.1`** and **`0.53.0`**. Two were wildly wrong. That build would have failed or silently
   installed a stack other than the one that produced the results.
2. **2.2.61.** Pinning the base image to the digest **as printed in a build log**, where Docker had
   elided it to 52 of 64 hex characters. `invalid checksum digest length`. A log is a display, not a
   source.
3. **A.135/A.182.** Two predictions stated as findings — "the slow read will give the best coverage" (it
   gave the worst) and "stop marking every token right" (that would have blinded false-correction rate
   entirely).

**Check.** Observe, then write. A range beats a guessed pin. An unverified value is recorded **as
unverified**, in the artefact, with the command that would verify it. Where a figure can be checked
mechanically — a digest is exactly 64 hex characters — assert it.

## R24. A test that cannot fail

**Shape.** The test runs, passes, and is incapable of ever failing. It is worse than no test, because it
is counted as coverage.

**Instances — five, all mine, all found by running the failing case rather than the passing one:**
1. **2.2.54.** Tests asserted on a verdict that is only emitted after a 2 s hold expires. They fed three
   words and never advanced time, so they passed **vacuously**. Three of them.
2. **2.2.54.** The variant test used the string `"duh"`, which the lexicon does not recognise, so it
   passed under both the old and the new behaviour.
3. **2.2.59.** Three tests matched the table body with `<table class="wbw">.*?<tbody>`. Once the record
   was split into cards the pattern **silently retargeted** to the next section's table.
4. **2.2.62.** `^` without `(?m)` anchored to the file start, so the test only ever checked the first
   line and would have passed a file full of ranges.
5. **2.2.63.** A corpus-word check that guessed the recipe keys as `to`/`word`/`insert` when they are
   `with`. It reported "clean" against a dictionary with the word deliberately removed.

**Check.** Every regression test is **run against the unfixed code and shown to fail**, and the changelog
says so. Assert the *setup* before the behaviour (`assertEqual(status, "approved")` before asserting what
happens to an approved variant). Prefer asserting on the artefact over the helper (see R26).

## R25. A test that exercises a helper whose output reaches nothing

**Shape.** A function is unit-tested and works. The pipeline that should carry its output drops it. Both
look correct in isolation, and the feature has never once worked.

**Instance — 2.2.64, undetected for eleven releases.** `compute()` omitted `snr_measurement` from the
record dict, so `_snr_note(rec)` always received `{}` and rendered `""`. **The session-level SNR
explanation added in 2.2.53 had never appeared in a single real document.** The tests called `_snr_note()`
directly with a hand-built dict; the rendered-HTML tests checked the header's `not measured` text, which
comes from a different field.

**Check.** At least one test per feature asserts on the **rendered artefact** — the HTML, the CSV, the
session file — not on the function that produces a fragment of it. Testing the function is not testing the
document.

## R26. A generated file that destroys an author's contribution

**Shape.** A generator rebuilds a file from one source of truth. A second, human source of truth lives in
the same file and is silently erased.

**Instance — 2.2.63.** `manage.ps1 seed` reduced `brave_knight/pron.json` from **16 entries to 13**,
destroying `gold`, `house` and `very` — added so the corpus could render substitutions. `add_story.py`
regenerates from the passage, and those words are not in the passage. The only symptom was one line in a
long log: `pron.json: 13 words`. Without `gold`, `cold`/`gold` falls back to **spelling** similarity, and
only the `dist is not None` guard from the 2.2.54 audit stopped that being accepted as a *homophone* —
i.e. the planted error passing silently as a correct reading.

**Check.** Author-owned content lives in its **own file** that no generator writes (`pron.extra.json`,
`homophones.json`), and the generator merges it. Generated entries win over overrides, and a dropped
override is **reported**. The tool states what it merged: `13 from the passage + 3 from pron.extra.json`.

## R27. Success reported after a failure

**Shape.** A step fails; the script carries on; a later step prints a success message. The operator reads
the last line.

**Instance — 2.2.61.** `docker compose build` failed with `invalid checksum digest length`. `up` ran
anyway and the version stamp printed `Reader Leader 2.2.60 - update complete`. **The old image was still
serving, under a success message** — and the stamp had been added one release earlier precisely to make
deployments legible.

**Check.** Every operational step checks its exit code before the next one runs, and **no success message
is printed for a failed step**. The failure names what failed and what is still running. A test asserts
the guard appears *before* the step it guards — a check placed after the thing it protects is not a check.
This is R16 with a second instance; it recurred inside the very function added to report success.

## R28. The environment moving underneath a measurement

**Shape.** Nothing in the repository changes, and the results change, because a dependency was a moving
target.

**Instance — 2026-09-18.** `python:3.12-slim` was republished. An 8 s build became **186.7 s**, **0 of 10
layers cached**, and the whole dependency stack was reinstalled at new versions **in the middle of a week
of measurements**. `numpy` moved to 2.x. Nothing recorded the old versions, so a week of coverage figures,
model comparisons and false-correction counts became unattributable. The comparison run afterwards was
**confounded** — the stack *and* four releases of code had changed — and could not be un-confounded
retrospectively, because the old stack no longer existed.

**Check.** Base image pinned by **digest**, dependencies pinned **exactly**, and every session records the
versions that produced it plus a hash of the pronunciation dictionary (`meta.json` → `environment`). A
change of environment is then a decision with a date, not an event.

## R29. A comparison with two variables

**Shape.** A before/after run is proposed to test one change, while a second change has also landed.
The result cannot be attributed.

**Instance — A.197.** I proposed re-running `real3` to test whether the rebuilt stack changed anything.
Between the two runs, the stack **and** four releases of code had changed (homophone fix, unbiased
default, cursor changes). Coverage moved from 21.4% to 64.3% on one file and nothing could be concluded.
The one clean signal was a file that came back **byte-identical**, which is weak evidence and was the only
evidence available.

**Check.** Before proposing a comparison, list everything that differs between the two runs. If more than
one thing does, either hold one constant or say plainly what the result cannot show.

## R30. A stronger model making the product worse

**Shape.** Capacity is assumed to be the binding constraint. A larger model is measured and is better at
the sub-task while being worse at the job.

**Instance — 2.2.51.** `medium.en` raised coverage on correct reads (28.6% → 64.3%) and took **error
detection from 2 to 0**. Cause: conditioned on the passage, a fluent model **reconstructs the prompt from
weak acoustic evidence** and reports the word it expected. On the same audio the biased pass read *"the
brave knight went…"* while the free pass read *"The brave light entered…"*. The weaker model kept the
error precisely because it could not override the audio.

**Check.** Judge a model on the **product's** metric, never on transcript quality. For a system whose job
is to notice when the child did *not* say the expected word, conditioning the live pass on the expected
words is the wrong default — corrected in 2.2.55.

## R31. A metric whose denominator hides the thing it measures

**Shape.** A rate excludes the cases that matter, so the number improves as the system gets worse.

**Instances — two:**
1. **2.2.44.** Accuracy was `correct ÷ (tokens − abstained)`. A token the system failed to judge left the
   denominator, so **a missed error raised the score**. One session read 100% while six words were never
   heard. Fixed by reporting the machine's own verdict beside the adjudicated one, and **coverage beside
   accuracy** — "13 of 18 judged" is now the primary figure.
2. **2.2.57.** Marks were counted **per event**, so a stalled token collecting eight events weighted
   eight times in the false-correction denominator.

**Check.** Every rate is published with its denominator and its coverage. A figure that can only be read
correctly alongside another is printed alongside it, not in a different section.

## R32. A guard whose threshold a short input cannot reach

**Shape.** A safeguard needs N observations. A small input produces N−1. The guard never fires, and its
absence reads as health.

**Instance — 2.2.53.** The weak-speech safeguard needs **8** weak windows; a 4.76 s recording produced
**7**. The session reported no SNR *and* no incident — indistinguishable from a healthy one. The floor
estimator had also failed on the same file for an unrelated reason (a near-continuous read makes the 10th
percentile a quiet *speech* window, so the gate sits above the speech and nothing qualifies).

**Check.** A safeguard that depends on a count needs a **session-level, count-independent** companion:
"speech was present and not one window yielded a sample" is a finding regardless of length. Two wrong
explanations of mine preceded the right one here — both plausible, neither measured. Instrument before
concluding.


---

## Pre-flight checklist

Before shipping a change:

- [ ] Every name I moved, renamed, guarded or made to throw: `grep -rn` it, list every consumer in the
      changelog, and confirm each was updated (R1).
- [ ] The client carries a build string and the header goes red on mismatch; `/web/` is `no-store` (R2).
- [ ] Every gate on a signal is relative to a measured floor; the estimator is tested on five regimes (R3).
- [ ] Every "not assessable" branch falls through to *flag*, never to *OK* (R4).
- [ ] For each bundled parameter: which property does it govern? Presets move the cost lever only (R5).
- [ ] Every queue has a batch cap, a backlog cap, a drop counter shown to the user, and a drain on stop (R6).
- [ ] Every test pins its subject by name (R7).
- [ ] Every directory that can hold child audio is in `.dockerignore` and covered by a verifying `purge` (R8).
- [ ] Timing tracks are reconciled to their audio, gap-filled, and monotone (R9).
- [ ] Every failure message names the condition that actually fired (R10).
- [ ] Every gesture-gated browser API is acquired before, or resumed and verified after, any `await` (R11).
- [ ] Every corpus label answers *was the word produced?* — `unsure` only when genuinely unjudgeable (R12).
- [ ] Every test's input reaches the code path it claims to test (R13).
- [ ] Nothing in the finish path can raise for a presentational reason (R14).
- [ ] The test suite, run twice, leaves zero artefacts in live directories (R15).
- [ ] `tools/lint_compose.py` passes; operational scripts check exit codes before printing success (R16).
- [ ] Every generator records what it actually did (`engine_used`) in the artefact it produced (R17).
- [ ] Baseline claims are made by running, and the baseline is asserted byte-identical, never re-accepted
      inside a script (R18).
- [ ] Every `accept` rule names its reviewer; every corpus file inherits its rule's review status (R19).
- [ ] Before blaming a component for cost, measure it under a different calling pattern (R20).
- [ ] Every synthetic result is marked synthetic and read as "audible", never as "validated" (R21).
- [ ] Every string replacement asserts its occurrence count, and the result is printed and read (R22).
- [ ] Every version, digest or figure I wrote was **observed**, not remembered or inferred (R23).
- [ ] Every regression test was **run against the unfixed code and seen to fail** (R24).
- [ ] At least one test asserts on the rendered artefact, not only on the helper (R25).
- [ ] No generator overwrites a file a human also owns; merges are reported (R26).
- [ ] Every operational step checks its exit code, and no success line follows a failure (R27).
- [ ] The environment is pinned, and this session's stack is recorded in the evidence (R28).
- [ ] If I proposed a comparison, only one thing differs between the two runs (R29).
- [ ] Any model or threshold change is judged on the product's metric, not a proxy (R30).
- [ ] Every rate is printed with its denominator and its coverage (R31).
- [ ] Every count-based guard has a count-independent companion (R32).
- [ ] For each guard just written: what input should trip it, and has that input been run? (meta)

Before quoting a number about the recogniser or a child:

- [ ] Was the microphone gate healthy for the session, and does the WAV agree with the gate's SNR? (R3)
- [ ] Is the false-correction rate computed from an adult's marks, or estimated by the system about
      itself? Only the first is a number.
- [ ] Is it from synthetic audio? Then it is not accuracy and not a model comparison (R21).
- [ ] Which pass produced the transcript — biased (`reference_conditioned`) or free? Only the free pass
      measures the recogniser.
- [ ] Is it a per-accent figure, or an average that hides one group? The design says never average.
- [ ] Was the client version confirmed at the time of the session? (R2)

---

## Queued for the next version (not yet implemented) — Tier C

**Q1. `t_lenition` as Cork's /t/ accept-rule.** *(R19.)* The Cork slit-t is acoustically closest to [s], so
a lenited *what* may be heard as *was* — and approving that also approves a child who genuinely read *was*
for *what* (the "missed error" direction). The honest first status is probably `ambiguous`. **Blocked on a
Cork speaker's review**; no model supplies that.

**Q2. Orthography-conditioned rhoticity.** *(R19, and the proposal review's P2.)* `ie_cork` has no
rhoticity rule; Cork is rhotic. A blanket "append /r/ after long vowels" over-applies (it would add one to
*path*); word-level entries do not scale. The correct mechanism: insert /ɹ/ after a long vowel **iff the
spelling has ⟨r⟩ in that position**. Needs a small extension to the rule format and the phone tokeniser.

**Q3. Listen to the corpus.** *(R17.)* The 22-file brave_knight corpus has been dry-run and its manifest
validated, but never rendered where Piper exists. First render: confirm `engine_used == "piper"`
throughout and listen to `err_04` (the spliced hesitation) by ear.

**Q4. Real recordings.** *(R21.)* Everything above is scaffolding. Eight to twelve reads in a real voice,
labelled by token index, are the asset — and the only thing that turns the offline harness from a
regression tool into evidence.

---

*Provenance: every figure above is traceable to a `CHANGELOG` entry between 2.2.10 and 2.2.43 and to the
session evidence uploaded during those releases (`sess_1f4d4876` … `sess_24073daf`). The audits that
produced R1, R8, R12, R14, R15, R17, R22 are recorded under 2.2.31, 2.2.33, 2.2.38, 2.2.41 and 2.2.43.*
