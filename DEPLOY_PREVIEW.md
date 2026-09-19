# Deploying the preview

A link a teammate, a teacher or a judge can click. Not a pilot environment: synthetic data
only, and the app says so on every screen.

Everything here is done in the Railway dashboard. Nothing in this file needs the repository
open, and no step needs a token handed to anyone.

---

## Before you start

- Railway **Hobby**, $5/month including $5 of usage.
- Run `node scripts/generate-preview-secrets.mjs` in the repo. It writes
  `preview-secrets.local.txt` (gitignored, mode 0600) with three demo passwords and a
  `JWT_SECRET`. You will paste from it in step 4. Share those passwords out of band — a
  different channel from the URL, not the same email.

---

## 1. Point the service at the right code

The existing project serves a pre-fork build. **Confirm what is running before you change
anything**, so the "after" means something:

1. Open the service → **Deployments**. Note the commit SHA and date of the active deployment.
   Write it down.
2. **Settings → Source**. Set the repository to `ekrob24/Newest-Reader-Leader` and the branch
   to the merged branch (`main` after merge; `claude/reader-leader-foundation-pmyqn1` if you
   are previewing before merge).
3. After deploying, check **Deployments** again and confirm the SHA matches the branch head.
   If it still shows the old SHA, the source did not change — do not proceed.

## 2. Region

**Settings → Region** (set it before the first deploy; changing it later redeploys).
Choose **EU West (Amsterdam)** — `europe-west4`. Any EU region is acceptable; the point is
that a children's product demo does not put its database outside the EU.

Set the **database service region to match**. A service in the EU talking to a US database
has not achieved anything.

## 3. Database

**New → Database → Add MySQL**, in the same project and the same region.

It gets its own database and must not be able to reach any other. Railway's private
networking is per-project, so:

- Do **not** paste a `DATABASE_URL` from another project or from Railway's shared examples.
- Use the reference variable `${{ MySQL.MYSQL_URL }}` (step 4), which resolves to this
  project's database only.
- Check **Settings → Networking** on the database: TCP proxy / public networking **off**
  unless you need to connect from your laptop. If you turn it on to run the seed, turn it
  off again afterwards.

## 4. Variables

**Settings → Variables** on the app service. The full list is in the next section. Paste the
three passwords and `JWT_SECRET` from `preview-secrets.local.txt`.

`VITE_APP_ID` is the one to get right. It is read at **build** time, not run time. If it is
missing, the app builds and deploys and looks fine, then every sign-in silently bounces back
to the login screen — it presents as a wrong password, and the only clue is
`[Auth] Session payload missing required fields` in the browser console. If you change it,
you must **redeploy**, not restart: a restart reuses the old build.

## 5. Seed the database

Once the service is up and the database is attached, run the seeder **once**:

- Easiest: Railway **Shell** on the app service, then `pnpm seed:preview`.
- Or locally with the database's public connection string:
  `DATABASE_URL='<the MySQL public URL>' pnpm seed:preview` — then turn public networking
  back off.

It refuses to run against a database that already holds readings, and it fails if any teacher
decision is already recorded, because the walkthrough needs the flagged moments undecided.
Expect it to print seven readings and "No teacher decisions recorded".

## 6. App sleeping

**Settings → Serverless** (Railway also labels this *App Sleeping*). Turn it **on**.

An idle preview otherwise bills for every hour it sits there and will consume the $5 in
roughly a week. With sleeping on, the first request after idle takes a few seconds to wake —
mention that to anyone you send the link to, so a slow first load is not read as a broken app.

Leave the **database** running. Sleeping a database does not help and complicates the wake.

## 7. Check the usage after a day

**Project → Usage** (or **Settings → Usage**). Note the figure 24 hours after deploying and
compare it against the $5 allowance. A sleeping app service plus a small MySQL should be well
inside it; if it is not, the likely cause is sleeping not actually being on, or something
pinging the URL and keeping it awake.

## 8. HTTPS

Nothing to configure — Railway terminates TLS and the generated `*.up.railway.app` domain is
HTTPS only. The app also redirects any plain-HTTP hop to HTTPS (308) on its own. This matters
because the session cookie is `SameSite=None; Secure`: over plain HTTP the browser discards it
and sign-in fails looking exactly like a wrong password.

## 9. Confirm the hardening on the live URL

Four one-line checks. Replace `<url>` with the deployed address.

```
curl -s <url>/robots.txt                      # expect: User-agent: *  /  Disallow: /
curl -sI <url> | grep -i x-robots-tag         # expect: noindex, nofollow, noarchive, ...
curl -sI http://<host>/ | grep -i location    # expect: a 308 to https://
```

And open the URL: the dark strip at the top of every screen must read
**"Demonstration build — everything here is synthetic."**

---

## Environment variables

Set on the **app service**. Everything not listed should be left unset.

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL` | `${{ MySQL.MYSQL_URL }}` | A reference, so it can only resolve to this project's database. |
| `JWT_SECRET` | from `preview-secrets.local.txt` | Signs the session cookie. |
| `VITE_APP_ID` | `reader-leader-preview` | **Build-time.** Missing → sign-in silently bounces, looks like a bad password. Changing it needs a redeploy, not a restart. |
| `NODE_ENV` | `production` | Serves the built client instead of Vite. |
| `PORT` | leave unset | Railway injects it. |
| `READER_LEADER_CHILD_DEMO_PASSWORD` | from the secrets file | Rotated for the preview. |
| `READER_LEADER_TEACHER_DEMO_PASSWORD` | from the secrets file | Rotated for the preview. |
| `READER_LEADER_PARENT_DEMO_PASSWORD` | from the secrets file | Rotated for the preview. |

Deliberately **not** set:

| Variable | Why not |
|---|---|
| `OPENAI_API_KEY` | Transcription degrades to the live transcript without it, which is the path the demo runs. Setting it would send audio to a provider whose terms this project has already concluded do not cover under-13s. |
| `BUILT_IN_FORGE_API_URL` / `BUILT_IN_FORGE_API_KEY` | No object storage means no recording is ever stored. The app says why on the review screen. For a public preview that is the safer configuration, not a limitation. |
| `READER_LEADER_ALLOW_INDEXING` | Absent means the build refuses crawlers. Set it to `1` only if you ever want it indexed, which for this you do not. |

---

## What this preview is not

It is a demonstration with synthetic data. It is not a pilot, it holds nothing about a real
child, and the data protection summary says so. Do not put a real recording, a real pupil name
or a real school into it.
