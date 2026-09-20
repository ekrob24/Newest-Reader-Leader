# Reader Leader: the whole stack

What this product is built from, how the pieces fit, and — where it matters — why a piece was
chosen over the obvious alternative. Read `RUNNING_LOCALLY.md` first if you just want it
running.

Reader Leader is a **reading fluency tool for primary classrooms**. A child reads a passage
aloud; the app follows along, records what it heard, and presents it to a teacher as a running
record the teacher can overrule. The product's claim is not that the software is right. It is
that a person decides, and the child's record follows the person.

That claim shapes the architecture more than any framework choice does, so it appears
throughout this document.

---

## 1. At a glance

| layer | what it is |
| --- | --- |
| Client | React 19, TypeScript, Vite, Wouter, TanStack Query, Radix UI + Tailwind, Recharts, Framer Motion |
| API | tRPC 11 over Express 4, superjson |
| Data | MySQL 8 via Drizzle ORM, `mysql2` driver, SQL migrations in `drizzle/` |
| Speech | Web Speech API in the browser; a provider-agnostic server interface behind it |
| Auth | Demo sign-in with per-role passwords from the environment; signed session cookie (`jose`) |
| Documents | `pdfkit` out, `mammoth` and `pdf-parse` in |
| Tests | Vitest (unit + integration), Playwright (two browser journeys), plus custom guards |
| Tooling | pnpm 10.4.1, Node 22, TypeScript 5.9, Prettier, esbuild |

Versions, checked against `package.json`: React 19.2, Vite 7.1, Express 4.21, tRPC 11.6,
Drizzle 0.44, `mysql2` 3.15, Tailwind 4.1, Vitest 2.1, Playwright 1.63, Wouter 3.3,
superjson 1.13, `jose` 6.1.

Roughly **67 test files**, **21 SQL migrations**, **23 database tables**.

---

## 2. Repository layout

```
client/src/        the React app
  pages/Home.tsx     the child's journey: library, reading view, report
  components/        teacher dashboard, parent dashboard, charts, shadcn/ui primitives
  index.css          the product's own stylesheet
  globals.css        design tokens; imported by index.css, and the source of --ink, --red …
  assets/story-art/  the four story illustrations (WebP, bundled with content hashes)

server/            the API and everything that touches the database
  routers/readerLeader.ts   every tRPC procedure, in fourteen namespaces
  readerDb.ts               the data layer: reads, writes, dashboards, seeding
  reader.ts                 the transcript analyser — scoring, events, word states
  tenantScope.ts            multi-tenancy: every query is scoped to a school
  demoAuth.ts               the three demo accounts
  _core/                    Express, tRPC setup, cookies, Vite middleware, storage proxy

shared/            pure logic, imported by both sides. No database, no framework.
  liveWordStates.ts   the matcher: alignment, bounded re-anchoring, the live cursor
  readingPagination.ts  splitting a passage into pages, on the same word boundaries
  readingWordScore.ts   what counts against a reading, and when
  readingPace.ts        words correct per minute, and when it may be published
  dialectSupport.ts     Irish-English variants, held as provisional matches
  accuracyAudience.ts   which figures each audience may see
  sessionId.ts          ULIDs, minted where a reading happens

drizzle/           schema.ts plus 21 generated SQL migrations
e2e/               two Playwright journeys
scripts/           the local runners, the gate, seeding, diagnostics, ASR probes
```

`asr-benchmark/`, `corpus/`, `probe-results/` and `docs/evaluation/` hold the speech-engine
evaluation work. They run beside the product, not inside it, and nothing in `client/` or
`server/` imports them.

---

## 3. The client

**React 19 + TypeScript, built by Vite.** Routing is **Wouter** rather than React Router —
the app has a handful of screens and Wouter is about 2 KB.

**TanStack Query** holds all server state, driven by the tRPC React bindings, so components
never hand-roll fetching or caching.

**Radix UI primitives with Tailwind** (the shadcn/ui pattern) provide accessible dialogs,
tabs, selects and so on in `client/src/components/ui`. The product's own screens are written
against a hand-authored stylesheet, `index.css`, in a flat Bauhaus style, with design tokens
in `globals.css`. The two coexist: Radix supplies behaviour and accessibility, the stylesheet
supplies the look.

**Recharts** draws the assessment trend. **Framer Motion** handles the small transitions.
**Lucide** provides the icons.

### The reading view

The one screen with real complexity. Three things happen at once and are deliberately kept
apart:

- **Judgement** — which words were read correctly — is derived from **finalised** speech
  results only. Interim results are the recogniser thinking aloud; it revises them
  continuously, and deriving colour from them made a word turn green, then red, then green.
- **Position** — where the reader is — is derived from finals **plus the interim in flight**,
  because a cursor that waits for finals can sit twenty words behind a child who is reading
  perfectly well. It only ever moves forwards.
- **The record** — what the child said, for saving — is finals plus any interim speech rescued
  from a recogniser that was about to stop. It never feeds judgement.

Three streams, three requirements, one module: `shared/liveWordStates.ts`.

---

## 4. The API

**tRPC 11 over Express 4**, with **superjson** so `Date` survives the wire. There is one
router, `server/routers/readerLeader.ts`, in fourteen namespaces: `account`, `materials`,
`sessions`, `learners`, `weeklyGoals`, `classes`, `irishVariants`, `termPresets`,
`homePractice`, `quizzes`, `reports`, `branding`, `dashboards`, `demo`.

tRPC rather than REST or GraphQL because the client and server share one TypeScript project:
procedure types reach the client without a code generation step, and a renamed field is a
compile error rather than a runtime surprise.

In development, Vite runs as Express middleware, so one process serves both. In production,
`pnpm build` produces a static client bundle and an esbuild-bundled server, and
`node dist/index.js` serves both from one port.

---

## 5. Data

**MySQL 8** through **Drizzle ORM** on the `mysql2` driver. Drizzle over Prisma for two
reasons: the schema is ordinary TypeScript that the rest of the codebase can import types
from, and migrations are plain SQL files you can read in review.

**Migrations are generated, never hand-written** — `pnpm drizzle-kit generate`, then
`drizzle-kit migrate`. The journal and snapshot files under `drizzle/meta/` are tooling state
and are never edited by hand.

Twenty-three tables. The ones that carry the product's argument:

| table | what it holds |
| --- | --- |
| `readingSessions` | one row per reading: transcript, duration, mode, the JSON word states and interventions |
| `readingWords` | one row per word, with its judgement, the reader's progress, and the teacher's resolution |
| `provisionalMatchReviews` | dialect variants awaiting a teacher, never scored as errors |
| `unrecordedReadingAttempts` | readings the server rejected, so a failed save is visible to someone |
| `schools`, `classEnrollments`, `familyLinks` | who may see whose reading |

### Three rules the data layer enforces

**Every query is scoped to a school.** `server/tenantScope.ts` yields a `scopedDb(scope)`, and
the data layer takes a scope rather than a raw connection. A missing scope is a type error,
not a data leak.

**Scores are derived, never stored.** There is no accuracy column that anyone can set. A word
counts against a reading only when the judgement is an error *and* a teacher has confirmed it
(`shared/readingWordScore.ts`). Overturning a decision changes the figure because the figure
was never written down.

**Pace is withheld until the review is finished.** `settledWordsCorrectPerMinute` returns
`null` for a reading a teacher has not finished reviewing, and every surface renders that as
an em dash. An absence is not a measurement of zero.

### Identity and time

Session ids are **ULIDs minted in the application** at the moment of capture
(`shared/sessionId.ts`) — a reading knows its own identity before it is sent, which an
autoincrement key cannot offer, and the leading 48 bits sort in capture order.

`readingSessions.createdAt` is supplied by the application on every insert, from the same
clock reading used to judge the device's clock, rather than left to MySQL's `DEFAULT (now())`.
Measured on one row of one insert: a `Date` the application wrote round-tripped correct to
444ms, while the MySQL-generated value came back exactly an hour out on a machine whose
timezone is not UTC. Thirty-two columns across the schema still declare `defaultNow()` or
`onUpdateNow()` — every other `createdAt`, every `updatedAt`, `lastSignedIn` — and each is
still written by the database and carries the same hour. Nothing in the demo depends on them.
See `ENGINE_PROPOSAL.md` for the two options for closing it.

---

## 6. Speech

**In the browser:** the Web Speech API, `continuous` with interim results, biased to `en-IE`,
and `processLocally` requested where the browser supports it so a child's voice can stay on
the device.

**On the server:** transcription and alignment sit behind a single interface. No provider's
name, response shape or SDK appears anywhere else in the codebase. With no `OPENAI_API_KEY`
set — and the project's rule is that it is not set — the server falls back to the transcript
the browser produced. That fallback is the demo path and is covered by a browser journey.

**The matcher** is `shared/liveWordStates.ts`, and it is the same code on both sides. It
aligns what was heard against what was expected, with **bounded re-anchoring**: on a
mismatch it looks up to three words ahead for the word it just heard. Three is not a taste —
it came from a sweep, and it is the largest window that recovers a run of dropped words
without matching a later copy of a word the child has not reached. Before it existed, one
dropped `a` — fifty milliseconds of unstressed schwa — pinned the cursor and took a perfect
reading from 42 words matched to 3.

**Dialect** is handled as evidence, not correction. An Irish-English variant such as
TH-stopping is recorded as a *provisional match* and sent to teacher review. It is never
scored as an error, and the product stores no per-child accent, dialect or EAL label.

---

## 7. Auth and tenancy

Demo sign-in: three accounts in `server/demoAuth.ts`, each with a password read from the
environment (`READER_LEADER_{CHILD,TEACHER,PARENT}_DEMO_PASSWORD`) and compared in constant
time. Unset means an empty expected password and nothing matches — it fails closed.

The session is a **JWT signed with `jose`** (`server/_core/sdk.ts`, `SignJWT` / `jwtVerify`),
carried in a cookie whose options are set in `server/_core/cookies.ts`. The cookie is
`SameSite=None`, which is only legal together with `Secure` — which is why the browser
journeys send `x-forwarded-proto: https`. Over plain HTTP the browser discards the cookie and
nothing can sign in.

An OAuth scaffold exists in `server/_core/oauth.ts` and is unused; the error it logs at
startup is expected.

---

## 8. Documents and storage

**Out:** `pdfkit` renders three PDFs — a child celebration, a parent summary and a teacher
running record — each carrying only the figures its audience may see
(`shared/accuracyAudience.ts`).

**In:** `mammoth` reads `.docx` and `pdf-parse` reads PDFs, so a teacher can upload a passage.

**Audio:** none is stored. The upload path was deliberately removed. `@aws-sdk/client-s3`
remains a dependency of the storage proxy for teacher materials; a reading's recording does
not go through it.

---

## 9. Testing

Four layers, each answering a different question.

**Unit tests (Vitest)** over `shared/` and `server/` — the matcher, the scoring rules, the
pace rules, the audience rules. No database.

**Integration tests (Vitest)** that need `DATABASE_URL`. Without it they are **skipped, not
passed**, and the gate reports a skipped gate as red.

**Browser journeys (Playwright)** — two. The demo journey walks the runbook and asserts what
is on screen, including the four figures a teacher sees move. The second drops a word
mid-passage, because the first emits a perfect transcript and that is why a cursor bug once
survived a green suite.

**The gate** — `scripts/gate.mjs`. Drops and re-seeds its own database before each phase, runs
the suite and both journeys, and ends with a plain-English **GREEN** or **RED** naming
anything that failed. It has a named-exception mechanism whose conditions are re-measured on
every run; the list is currently empty.

Two guards run alongside:

- `scripts/assert-test-quality.mjs` bans assertions that cannot fail, and fails if it scans
  zero files.
- `scripts/assert-test-coverage.mjs` fails the build unless every test actually ran. Seven
  suites are gated on `DATABASE_URL` and skip silently without one, so a run with no database
  would report green while quietly covering none of the tenancy isolation, the exercise
  approval gate or the `readingWords` write path.

### The habit behind all of this

This codebase has repeatedly found **software asserting something it did not observe**:
accuracy shown to people who could not check it; a write that reported success before it
happened; a validator that was a coercion; a "tricky words" list that named the first three
words of wherever the comparison came apart. Every fix has the same shape — make the claim
derivable, or stop making it.

The testing practice follows from that. Every check is **mutation-tested**: break the thing it
guards, watch it go red, restore it, watch it go green. A verification that cannot fail is
worse than no verification, because it produces a green result someone will quote later.

---

## 10. Environment variables

| variable | what happens without it |
| --- | --- |
| `DATABASE_URL` | No database. Integration tests skip; the app cannot start usefully. |
| `JWT_SECRET` | Sessions cannot be signed. |
| `VITE_APP_ID` | Baked into the client at **build** time. Its absence looks exactly like a wrong password. |
| `PORT` | Defaults to 3100 locally. |
| `READER_LEADER_{CHILD,TEACHER,PARENT}_DEMO_PASSWORD` | Sign-in fails closed; the demo-auth tests skip. |
| `OPENAI_API_KEY` | **Deliberately unset.** The server falls back to the browser's transcript. |
| `OAUTH_SERVER_URL` | Logs an error at startup. Unused. Ignore it. |

`scripts/run-local.ps1` and `scripts/run-local.sh` set all of these for you.

---

## 11. Choices worth knowing about

**Why not a hosted speech API for the live path.** The live path is the Web Speech API because
it runs in the browser, can be asked to stay on the device, and costs nothing per child. The
server-side interface exists for the case where that is not good enough, and adding a
third-party provider is a decision already taken: not without a measurement that justifies it.

**Why the five-intervention cap was removed.** `buildInterventions` once truncated at five,
and the errors past the cap were stored as correct. A display limit had become a data limit.

**Why accuracy is not on the child's screen.** A machine's judgement no person has checked is
not something to put in front of a nine-year-old. Nor is a count of the times she went back.
The child's report says what she did, in words; the numbers live where a teacher can act on
them.

**Why the demo data is arithmetically real.** Every seeded reading is derived from its own
passage, transcript and duration by the same analyser the live path uses. The seeds once
carried hand-written figures — one claimed 108 words per minute over 72 seconds against a
ten-word transcript. Now only the reading time is chosen; everything else is computed.

---

## 12. Where to read further

| | |
| --- | --- |
| `RUNNING_LOCALLY.md` | Getting it running, and what to test |
| `DEMO_RUNBOOK.md` | The demo journey, step by step, including the no-microphone fallback |
| `ENGINE_PROPOSAL.md` | The speech-engine evaluation, the open findings, and what is built but not live |
| `DEPLOY_PREVIEW.md` | Standing up a preview instance |
| `drizzle/schema.ts` | The database, and the comments explaining each decision |
| `shared/liveWordStates.ts` | The matcher, with the measurements behind its constants |
