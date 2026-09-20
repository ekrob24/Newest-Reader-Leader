# Demo runbook

The journey shown at the final, in order. `e2e/demo-journey.spec.ts` walks exactly these
steps and asserts what is on screen at each one. **They are the same artefact in two forms —
change one and change the other.**

> Written during Task 4. Tasks 1–3 were not run in this session, so if they produce their own
> runbook, reconcile the two rather than keeping both.

## Start here: getting it running, step by step

Written for someone tired, in a hotel, the night before. You do not need to know what any of
these do. Do them in order.

**On Windows** (open PowerShell):

1. Install **Node 22** from nodejs.org, if it is not already there.
2. Install **pnpm**: `npm install -g pnpm`
3. Start a **MySQL 8**. With Docker Desktop running, this one line is enough:
   `docker run -d --name rl-mysql -e MYSQL_ROOT_PASSWORD=rlroot -p 3306:3306 mysql:8.0`
   Then **wait thirty seconds** before the next step.
4. Get the code: `git clone <repo-url> reader-leader` then `cd reader-leader`
5. Run the one command:
   `powershell -ExecutionPolicy Bypass -File .\scripts\run-local.ps1`
6. Wait. It installs, creates and fills the database, builds, and starts the app. The first
   run takes a few minutes. It is finished when you see **`Server running`**.
7. Open **`http://localhost:3100`** in Chrome.
   Use **localhost**, not `127.0.0.1` — browsers only allow the microphone on localhost or
   HTTPS, and on `127.0.0.1` the microphone will simply never start.
8. Sign in. The passwords are printed in the window just above `Server running`:
   | | username | password |
   | --- | --- | --- |
   | Child | `child1` | `reader-child-2026` |
   | Teacher | `teacher2` | `reader-teacher-2026` |
   | Parent | `parent3` | `reader-parent-2026` |

**On macOS or Linux**, steps 1–4 are the same, and step 5 is `./scripts/run-local.sh`.

**To stop it:** press `Ctrl+C` in that window. **To start it again:** the same command. It will
say `(already seeded — continuing)`, which is correct and not an error.

### If something goes wrong

- **`No MySQL is listening on 127.0.0.1:3306`** — step 3 did not finish. Give it thirty
  seconds and run step 5 again.
- **The login is rejected, and you set your own MySQL password** — re-run step 5 as
  `powershell -ExecutionPolicy Bypass -File .\scripts\run-local.ps1 -MysqlPassword "yourpassword"`
- **`[OAuth] ERROR: OAUTH_SERVER_URL is not configured`** in the window — **ignore it.** It
  appears on every start and the demo does not use OAuth. It is not your problem.
- **Anything else** — the table below names the five environment variables and what each one
  looks like when it is missing. `run-local.ps1` sets all five for you, so you should not need
  it unless you are starting the app by hand.

---

## THE FALLBACK: the override, with no microphone and no network

**Use this if the microphone fails, the venue wifi dies, or anything at all goes wrong with the
live read.** It reaches the moment the product is actually about — a teacher overturning the
software's judgement and the child's record following her — using reading data that was seeded
before you arrived. It needs no voice, no microphone and no internet.

Unplug the microphone and turn the wifi off if you like; it behaves identically. The app runs
on your own machine and talks to a database on your own machine.

From the app running at `http://localhost:3100`:

1. **Continue as Teacher** → password `reader-teacher-2026` → **Open my reading space**.
2. Scroll to **Saved reading sessions**.
3. On the row **The Lantern in the Garden · last week**, click **Review word by word**.
4. The running record opens. **After your decisions** reads **100%**, and **Reading speed**
   reads **—** with the line "Reading speed appears once the teacher has finished reviewing
   this reading." Nothing counts against this child yet, because no human has confirmed
   anything, and the pace is withheld for the same reason. Two moments below say
   **Decision needed**.
5. Under **Other flagged moments**, find the word **hedgehog**. Click **Confirm event**.
   → The figures change in front of you: **98%** and **91 WCPM**. Confirming is what lets a
   flag count.
6. Click **Override** on the same moment.
   → It returns to **100%** and **93 WCPM**. The teacher overruled the software and the child's
   record followed the teacher. **This is the point of the whole product.**
7. Under **Accent variations**, click **Confirm variation**.
   → The figures do **not** move. An Irish-English variation is a correct reading in the
   child's dialect and can never count as an error. The fairness claim, shown rather than
   asserted.

**What to say while doing it:** nothing counts against a child until a teacher confirms it, the
teacher can always overrule the machine, and an accent variation is never a mistake.

**Every screen on this path carries the synthetic-data statement** — "Demonstration build —
everything here is synthetic" — at the top. It is rendered outside the router in `App.tsx`, so
it is on every screen; it cannot be dismissed and does not depend on a variable anybody
remembered to set. A seeded reading shown without it would be the product asserting something
that did not happen.

**Resetting it.** Teacher decisions persist. To run the sequence a second time, stop the app,
drop the database and run `run-local.ps1` again — or just use a different saved session, of
which there are several.

### The recorded version

`pnpm demo:record` produces `demo-recording/reader-leader-walkthrough.webm` — 46 seconds,
1280x800, the whole journey including this override — plus one screenshot per step in
`demo-recording/frames/`. **Have it on the laptop before you travel.** If the machine will not
run, the video is the demo.

---

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
