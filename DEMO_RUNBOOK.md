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

## What the demo does not show

- `TeacherSessionReviewScreen` exists in the codebase but is not routed, so the per-word
  confirm/override screen is unreachable. The teacher decision in the journey is the
  *Pending speech matches* confirmation, which is the reachable one.
- Live speech recognition is the browser's own Web Speech API. It works in Chrome against
  Google's service; it does not work in a bare Chromium, which is why the browser test
  substitutes it (see the spec's header comment).
