# Running Reader Leader on your own machine

Written for someone who has never seen this repository. You do not need to understand the
code to follow it. Every command here is one you can copy.

**What you will end up with:** the whole product running at `http://localhost:3100`, filled
with synthetic demo data, with three sign-ins — a child, a teacher and a parent.

**Nothing here touches anything public.** The app and its database both run on your machine.

> For the scripted demo journey — what to click, in what order, and the figures that should
> appear — see **`DEMO_RUNBOOK.md`**. This file is about getting it running and testing it.
> For what the pieces are and why, see **`TECH_STACK.md`**; for the tables, the models and
> the lexicons, see **`DATA_MODEL.md`**.

---

## 1. What you need first

| | | how to check |
| --- | --- | --- |
| **Node 22** | the runtime | `node --version` → `v22.x` |
| **pnpm** | the package manager | `pnpm --version` → `10.x` |
| **MySQL 8** | the database | something answering on `127.0.0.1:3306` |
| **Git** | to get the code | `git --version` |

Node from [nodejs.org](https://nodejs.org). Then pnpm:

```
npm install -g pnpm
```

**MySQL**, easiest first: with Docker Desktop running,

```
docker run -d --name rl-mysql -e MYSQL_ROOT_PASSWORD=rlroot -p 3306:3306 mysql:8.0
```

then **wait thirty seconds** before the next step. Without Docker, install MySQL Server 8,
start it, and remember the root password you set — you will pass it in below.

MySQL 8 specifically. The app uses MySQL's `JSON` columns and enum types through Drizzle, and
migrations are generated against MySQL 8.

---

## 2. Get the code

```
git clone https://github.com/ekrob24/Newest-Reader-Leader reader-leader
cd reader-leader
```

---

## 3. Run it

One command. It installs dependencies, creates the database, runs every migration, seeds the
demo data, builds the client and server, and starts the app.

**Windows** (PowerShell):

```
powershell -ExecutionPolicy Bypass -File .\scripts\run-local.ps1 -MysqlPassword "yourpassword"
```

**macOS or Linux**:

```
MYSQL_ROOT_PASSWORD="yourpassword" ./scripts/run-local.sh
```

Leave out the password entirely if you used the Docker line above — `rlroot` is the default.

The first run takes a few minutes. It is ready when the window says:

```
Server running on http://localhost:3100/
```

Leave that window open. `Ctrl+C` stops it. Running the same command again is how you restart;
it will say `(already seeded — continuing)`, which is correct and not an error.

### One message you should ignore

```
[OAuth] ERROR: OAUTH_SERVER_URL is not configured!
```

It appears on every start. The demo sign-in does not use OAuth. It is not your problem.

---

## 4. Open it

Go to **`http://localhost:3100`**.

**Type `localhost`, not `127.0.0.1`.** Browsers only grant microphone access on `localhost` or
over HTTPS. On `127.0.0.1` the microphone will silently never start and reading aloud will
appear to do nothing.

Use **Chrome or Edge**. The live word highlighting uses the Web Speech API, which Firefox does
not implement and Safari implements differently.

| | username | password |
| --- | --- | --- |
| Child | `child1` | `reader-child-2026` |
| Teacher | `teacher2` | `reader-teacher-2026` |
| Parent | `parent3` | `reader-parent-2026` |

Those are the defaults the local script sets. They are demo passwords for synthetic data on
your own machine, and they are printed in the window just above `Server running`.

---

## 5. What to test

### The child's reading

Continue as Child → **Start today's read** → **Start guided reading** → **Tap to Read**, then
read the passage out loud.

- Four story cards, each with its own illustration.
- One highlighted word, moving with you as you read. It should follow your voice, not lag
  several words behind, and it must never jump to the end of the page.
- Pages turn as you reach them.
- **Finish story** → the report. No scores on this screen — reading speed and accuracy are
  not the child's to see until a teacher has reviewed them, and the screen says so.

### The teacher's review — the part that matters

Sign out, Continue as Teacher → **Saved reading sessions** → on **The Lantern in the Garden ·
last week**, click **Review word by word**.

1. Before any decision: **100%**, and reading speed shows **—**. Nothing counts against a
   child until a person has confirmed it.
2. Confirm the miscue on **hedgehog** → **98%**, **91 WCPM**.
3. **Override** it → back to **100%**, **93 WCPM**. The teacher overruled the software and the
   record followed the teacher.
4. Confirm the **accent variation** → the figures do not move. An Irish-English variation is a
   correct reading in the child's dialect and never counts as an error.

Those four figures are checked automatically — see the gate below.

### Reading with no microphone at all

Everything in the teacher path above works with the microphone unplugged and the wifi off.
`DEMO_RUNBOOK.md` calls this THE FALLBACK and it is the safest thing to show.

---

## 6. Running the tests

```
pnpm check                 # TypeScript, no emit
pnpm test                  # the unit suite
pnpm build                 # client + server bundles
```

`pnpm test` needs three environment variables or the demo-auth tests are skipped:

```
READER_LEADER_CHILD_DEMO_PASSWORD, READER_LEADER_TEACHER_DEMO_PASSWORD,
READER_LEADER_PARENT_DEMO_PASSWORD
```

Set `DATABASE_URL` as well and another 58 integration tests run against it. Without it they
are **skipped, not passed** — a distinction this project cares about.

### The gate

One command runs everything, against a database, and ends with a plain verdict:

```
node scripts/gate.mjs --mysql-password "yourpassword"
```

It uses its own `rl_gate` database, dropped and re-seeded before each phase, so it never
disturbs the one you are demoing. It runs the whole suite and both browser journeys, then says
**GREEN** or **RED** and names anything that failed. This is the check to trust.

---

## 7. When something goes wrong

| what you see | what it means |
| --- | --- |
| `No MySQL is listening on 127.0.0.1:3306` | MySQL is not running, or not ready yet. Give it thirty seconds. |
| The login is rejected | You set your own MySQL root password — pass it with `-MysqlPassword` / `MYSQL_ROOT_PASSWORD`. |
| The microphone never starts | You are on `127.0.0.1`. Use `localhost`. Or you are in Firefox. |
| `[OAuth] ERROR: OAUTH_SERVER_URL` | Expected on every start. Ignore. |
| `StorageUnavailableError` | Expected. Audio is not stored; there is nothing configured to store it in. |
| `URIError: Failed to decode param` | Gone as of the analytics removal. If you see it on an older checkout, it is noise. |
| The demo shows decisions already made | You reviewed that reading earlier. Drop the database and start again (below). |

**Starting from a clean database:**

```
node -e "const m=require('mysql2/promise');m.createConnection({host:'127.0.0.1',user:'root',password:process.argv[1]}).then(c=>c.query('DROP DATABASE IF EXISTS rl_local').then(()=>c.end())).then(()=>console.log('dropped'))" "yourpassword"
```

then run the start command from step 3 again.

---

## 8. What this build will not do

Worth knowing before you test it, so you do not report these as faults.

- **No audio is stored** — because object storage is not configured, not because there is no
  code for it. The save path attempts it, gets `StorageUnavailableError`, and records the
  reading with `audioStatus: "storage_unavailable"`. That is why the "no recording was saved"
  line appears on the report, and why `StorageUnavailableError` in the log is expected.
- **Transcription is the browser's.** With no `OPENAI_API_KEY` set — and the project's rule is
  that it is not set — the server falls back to the transcript the browser produced. That is a
  deliberate resilience path, not a failure.
- **The live recogniser is the Web Speech API.** It hears whatever is in the room, including
  other people. Do not use it anywhere a conversation you have not consented to could be
  picked up. This is recorded as a data protection finding in `ENGINE_PROPOSAL.md`.
- **Everything is synthetic.** No real child, no real school, no real recording is in this
  repository or in the seeded data, and every screen says so.
