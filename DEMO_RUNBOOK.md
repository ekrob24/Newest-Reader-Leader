# Demo runbook

The journey shown at the final, in order. `e2e/demo-journey.spec.ts` walks exactly these
steps and asserts what is on screen at each one. **They are the same artefact in two forms —
change one and change the other.**

> Written during Task 4. Tasks 1–3 were not run in this session, so if they produce their own
> runbook, reconcile the two rather than keeping both.

## Before you start

Five variables. Each one breaks the demo in a way that does not name itself, so the symptom is
in the table. **Read this before diagnosing anything on the day** - every one of these was hit
from scratch while producing the walkthrough, and none is guessable from the screen.

| Variable | If it is missing, what you actually see |
| --- | --- |
| `DATABASE_URL` | MySQL 8. Run `pnpm drizzle-kit migrate` against it first, then `pnpm seed:preview`. Without the seed, sign-in works and the library is empty. |
| `JWT_SECRET` | Sign-in fails with **`Zero-length key is not supported`** in the server log and a generic failure on screen. The password is correct; the cookie cannot be signed. |
| `VITE_APP_ID` | **Read at runtime by the server**, despite the `VITE_` prefix. Sign-in *succeeds*, sets a cookie, and then every following request is rejected: **`[Auth] Session payload missing required fields`**. On screen the password box simply sits there having apparently done nothing. |
| `READER_LEADER_{CHILD,TEACHER,PARENT}_DEMO_PASSWORD` | The three sign-in passwords. Unset means an empty expected password and nothing matches. |

`OAUTH_SERVER_URL` is **not** needed for the demo. The server logs
`[OAuth] ERROR: OAUTH_SERVER_URL is not configured!` at startup and the demo sign-in path does
not use it. Ignore that line; it is not the problem.

One command, everything set, from a clean database:

```bash
export DATABASE_URL="mysql://USER:PASS@127.0.0.1:3306/readerleader"
export JWT_SECRET="any-non-empty-string"
export VITE_APP_ID="reader-leader-demo"
export READER_LEADER_CHILD_DEMO_PASSWORD="..." \
       READER_LEADER_TEACHER_DEMO_PASSWORD="..." \
       READER_LEADER_PARENT_DEMO_PASSWORD="..."
pnpm drizzle-kit migrate && pnpm seed:preview && pnpm build && pnpm demo:record
```

`pnpm demo:record` writes `demo-recording/reader-leader-walkthrough.webm` plus one screenshot
per beat in `demo-recording/frames/`. It needs a database with **no teacher decisions on the
seeded record** - the journey asserts that precondition and says so rather than failing
obscurely, but a second run against a used database will stop there.

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

## Running it on your own machine

macOS or Linux: `./scripts/run-local.sh`
Windows PowerShell: `.\scripts\run-local.ps1`

Both install, migrate, seed, build and start in one go. They need Node 22, pnpm and a MySQL 8
on 127.0.0.1:3306; the Windows one tells you the `docker run` command if no MySQL is listening.

Open **http://localhost:3100**, not 127.0.0.1 — browsers only grant microphone access on
localhost or HTTPS.

## Deploying it somewhere people can click

See `DEPLOY_PREVIEW.md`. It is a dashboard checklist, not a code change: region, database,
variables, seeding, app sleeping, and four one-line checks against the live URL.

## What the demo does not show

- Live audio playback, unless object storage is configured. Everything else works without it.
- Live speech recognition is the browser's own Web Speech API. It works in Chrome against
  Google's service; it does not work in a bare Chromium, which is why the browser test
  substitutes it (see the spec's header comment).
