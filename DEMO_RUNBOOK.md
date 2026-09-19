# Demo runbook

The journey shown at the final, in order. `e2e/demo-journey.spec.ts` walks exactly these
steps and asserts what is on screen at each one. **They are the same artefact in two forms —
change one and change the other.**

> Written during Task 4. Tasks 1–3 were not run in this session, so if they produce their own
> runbook, reconcile the two rather than keeping both.

## Before you start

Three environment facts, each of which silently breaks the demo if missed:

| Variable | Why it matters |
| --- | --- |
| `DATABASE_URL` | MySQL 8. Run `pnpm drizzle-kit migrate` against it first. |
| `JWT_SECRET` | Signs the demo session cookie. |
| `VITE_APP_ID` | **Read at runtime by the server.** Without it the session token carries an empty `appId`, the server rejects every request with `[Auth] Session payload missing required fields`, and demo sign-in *appears to succeed then silently returns to the landing page*. |
| `READER_LEADER_{CHILD,TEACHER,PARENT}_DEMO_PASSWORD` | The three sign-in passwords. |

**Serve over HTTPS.** The session cookie is `SameSite=None` and is only marked `Secure` when
the request looks like HTTPS. Over plain HTTP the browser discards it and nobody can sign in.
Behind a proxy, `x-forwarded-proto: https` is enough.

`OPENAI_API_KEY` is deliberately **not** set. Transcription then fails and the session save
falls back to the guided transcript, which is the resilience path the merge preserved. Audio
storage is likewise unconfigured, so the report says no recording was saved.

## The journey

1. **Open the app.** The landing page offers Child, Teacher and Parent demo cards.
2. **Sign in as the child.** Choose *Continue as Child*, enter the child demo password.
   Amina's reading library appears.
3. **Start today's read.** The warm-up appears; choose *Start guided reading*.
4. **The passage appears** — *The Lantern in the Garden*.
5. **Read aloud** (*Tap to Read*), then **Finish story**.
6. **The reading report appears** and confirms the practice was saved.
7. **Sign in as the teacher.** The dashboard opens on Ms Kelly's class.
8. **Open *Pending speech matches*.** The regional pronunciation from the read is waiting
   for a decision.
9. **Confirm the match.** The queue reflects the teacher's decision on screen.

## The teacher decision, and the number that follows it

Reachable at **Review word by word** on any saved reading. The screen shows two figures: the
story match as the model scored it, and the accuracy after the teacher's decisions. The second
starts at 100% however many words the model flagged, because an unchecked machine judgement
does not enter a child's record. Confirming a miscue is what lets it count; overriding takes
it back out. An Irish English variation is a separate category and never counts, confirmed or
not.

## What happens when a reading cannot be saved

Worth showing deliberately, because it is the part most demos hide. If the save is
rejected, the child's report says "We could not save your reading just now. Shall we try
again?" with a retry button, rather than the success screen; and the reading appears on
the teacher dashboard under **Readings that were not recorded**, with the child, the
story, the time and the reason. A saved reading and an unsaved one are different screens,
which is what lets the browser test detect a broken save at all.

Two related honesty notes visible in the demo:

- No recording is stored unless object storage is configured, so the teacher's review
  surface says why rather than showing a player that cannot play. `audioStatus` carries
  the reason on every session row.
- A read shorter than twenty seconds shows no words-per-minute figure, on either the
  child's report or the teacher's running record. The accent showcase is four seconds
  long, so it demonstrates this.

## The recorded walkthrough

`pnpm demo:record` runs the same browser journey with video and a trace turned on, and writes
`demo-recording/reader-leader-walkthrough.webm` plus one PNG per moment in
`demo-recording/frames/`. It is about 45 seconds at 1280x800 and roughly 4 MB, small enough to
attach to an email. Nothing is staged: it is the real application doing the journey the test
asserts, so a recording can only exist if the journey passes.

Two things it needs:

- **A database with no teacher decisions on the seeded record.** Decisions persist, and the
  journey asserts both flagged moments start undecided, so run it against a fresh database.
  The assertion says so by name if you forget.
- `READER_LEADER_RECORD=1`, which `pnpm demo:record` sets. Video, the trace and the pauses are
  off in every other run, so CI neither films itself nor uploads a video.

## What the demo does not show

- Live audio playback, unless object storage is configured. Everything else works without it.
- Live speech recognition is the browser's own Web Speech API. It works in Chrome against
  Google's service; it does not work in a bare Chromium, which is why the browser test
  substitutes it (see the spec's header comment).
