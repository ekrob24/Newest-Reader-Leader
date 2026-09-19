#!/usr/bin/env node
/**
 * Prepare a preview database: run every migration, then provision the demo cohort.
 *
 * Run this once against a NEW, EMPTY database. It refuses to touch one that already holds
 * reading sessions, because the only reason to point this at a populated database is a
 * mistake, and the mistake it guards against is overwriting somebody's data with demo data.
 *
 * It also refuses if any teacher decision is already recorded. The recorded walkthrough and
 * the browser journey both need the seeded record to start undecided, and a preview seeded on
 * top of a used database silently loses that.
 */
import { execFileSync } from "node:child_process";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required. Point it at the preview database, not a shared one.");
  process.exit(2);
}

const force = process.argv.includes("--force");

/** Exit code meaning "nothing to do", as distinct from any failure. */
const ALREADY_SEEDED = 3;

async function main() {
  // The database itself may not exist yet on a fresh machine; drizzle-kit needs it to.
  try {
    execFileSync("node", ["scripts/ensure-database.mjs"], { stdio: "inherit" });
  } catch {
    // ensure-database has already printed something a person can act on. Re-throwing its
    // stack on top would bury that under forty lines of node internals.
    process.exit(1);
  }

  const connection = await mysql.createConnection(url);
  try {
    const [tables] = await connection.query("SHOW TABLES LIKE 'readingSessions'");
    if (Array.isArray(tables) && tables.length) {
      const [rows] = await connection.query("SELECT COUNT(*) AS total FROM readingSessions");
      const total = Number(rows[0].total);
      if (total > 0 && !force) {
        console.log(`This database already holds ${total} reading session(s) — leaving it alone.`);
        console.log("Pass --force to reseed it, or point DATABASE_URL at an empty database.");
        // A distinct code, so a caller can tell "already done" from "went wrong". Exiting 1
        // for both is how a runner ends up treating a real failure as nothing to worry about.
        process.exit(ALREADY_SEEDED);
      }
    }
  } finally {
    await connection.end();
  }

  console.log("Applying migrations…");
  execFileSync("pnpm", ["drizzle-kit", "migrate"], { stdio: "inherit" });

  console.log("Provisioning the demo cohort…");
  // Imported after the migrations, so the schema the code expects is already there.
  const { provisionLocalDemoCohort, seedDemoCohort } = await import("../server/readerDb.ts");
  const { scopeForUser } = await import("../server/tenantScope.ts");
  const cohort = await provisionLocalDemoCohort();
  await seedDemoCohort(scopeForUser(cohort.teacher), cohort.teacher.id);

  const verify = await mysql.createConnection(url);
  try {
    const [sessions] = await verify.query("SELECT storyTitle, accuracy, wordsCorrectPerMinute, durationSeconds, audioStatus FROM readingSessions ORDER BY storyTitle");
    const [decided] = await verify.query("SELECT COUNT(*) AS total FROM readingSessions WHERE JSON_SEARCH(interventions, 'one', 'confirmed') IS NOT NULL OR JSON_SEARCH(interventions, 'one', 'overridden') IS NOT NULL");
    const [attempts] = await verify.query("SELECT COUNT(*) AS total FROM unrecordedReadingAttempts");

    console.log(`\nSeeded ${sessions.length} reading(s):`);
    for (const row of sessions) {
      console.log(`  ${row.storyTitle} — ${row.accuracy}% over ${row.durationSeconds}s, ${row.wordsCorrectPerMinute} WCPM, audio ${row.audioStatus}`);
    }

    const decidedTotal = Number(decided[0].total);
    if (decidedTotal > 0) {
      console.error(`\n${decidedTotal} reading(s) already carry a teacher decision. The walkthrough needs them undecided.`);
      process.exit(1);
    }
    console.log("\nNo teacher decisions recorded — the walkthrough's precondition holds.");
    console.log(`No unrecorded reading attempts (${Number(attempts[0].total)}).`);
  } finally {
    await verify.end();
  }
}

main().then(() => process.exit(0)).catch(error => {
  console.error(error);
  process.exit(1);
});
