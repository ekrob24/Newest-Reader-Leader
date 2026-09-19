import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { readingSessions } from "../drizzle/schema";
import { getDb } from "./db";
import { provisionLocalDemoCohort, seedDemoCohort } from "./readerDb";
import { scopeForUser } from "./tenantScope";
import { scopedDb } from "./tenantScope";
import { isPaceMeaningful } from "../shared/readingPace";

const databaseAvailable = Boolean(process.env.DATABASE_URL);

/** Words a child is claimed to have read correctly, implied by the pace and the reading time. */
function impliedCorrectWords(wordsCorrectPerMinute: number, durationSeconds: number) {
  return (wordsCorrectPerMinute * durationSeconds) / 60;
}

function spokenWordCount(transcript: string) {
  return transcript.trim().split(/\s+/).filter(Boolean).length;
}

describe.skipIf(!databaseAvailable)("seeded demo readings state only what their transcript supports", () => {
  // Note on what a green run proves. The seeders are idempotent: they insert only when the row
  // is absent. Against a database that was already seeded, this suite checks the rows that are
  // there, which is a real check of that data but not of the current seeding code. CI starts
  // from an empty MySQL service, so there it checks what the code in the diff produces.
  it("never claims more words read correctly than the child said", async () => {
    // The invariant the old hand-written seeds broke by an order of magnitude: "The Lantern in
    // the Garden" claimed 108 WCPM over 72 seconds against a ten-word transcript, which is 130
    // words that were never spoken. Three of the offenders were the monthly-assessment rows
    // behind the progress trend a teacher is shown.
    const cohort = await provisionLocalDemoCohort();
    const scope = scopeForUser(cohort.teacher);
    await seedDemoCohort(scope, cohort.teacher.id);

    const db = await scopedDb(scope);
    const rows = await db.select().from(readingSessions);
    expect(rows.length).toBeGreaterThan(4);

    for (const row of rows) {
      const spoken = spokenWordCount(row.transcript);
      const implied = impliedCorrectWords(row.wordsCorrectPerMinute, row.durationSeconds);
      expect(
        implied,
        `${row.storyTitle}: ${row.wordsCorrectPerMinute} WCPM over ${row.durationSeconds}s implies ${implied.toFixed(1)} words read correctly, but the transcript has ${spoken}`,
      ).toBeLessThanOrEqual(spoken);
    }
  });

  it("never claims an accuracy no transcript of that length could reach", async () => {
    const cohort = await provisionLocalDemoCohort();
    const db = await scopedDb(scopeForUser(cohort.teacher));
    const rows = await db.select().from(readingSessions).where(eq(readingSessions.childProfileId, cohort.profile.id));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.accuracy).toBeGreaterThanOrEqual(0);
      expect(row.accuracy).toBeLessThanOrEqual(100);
      // An accuracy above zero needs words to have been read.
      if (row.accuracy > 0) expect(spokenWordCount(row.transcript)).toBeGreaterThan(0);
    }
  });

  it("shows a believable reading pace on every demo row long enough to measure one", async () => {
    // Honest numbers are not enough for a demo: figures derived from a short passage read
    // slowly are consistent and also absurd. Any row long enough for the pace to mean
    // something has to look like a real reader of this age.
    const cohort = await provisionLocalDemoCohort();
    const scope = scopeForUser(cohort.teacher);
    await seedDemoCohort(scope, cohort.teacher.id);
    const db = await scopedDb(scope);
    const rows = (await db.select().from(readingSessions)).filter(row => isPaceMeaningful(row.durationSeconds));
    expect(rows.length).toBeGreaterThan(3);
    for (const row of rows) {
      expect(row.wordsCorrectPerMinute, `${row.storyTitle} reads at ${row.wordsCorrectPerMinute} WCPM`).toBeGreaterThanOrEqual(60);
      expect(row.wordsCorrectPerMinute, `${row.storyTitle} reads at ${row.wordsCorrectPerMinute} WCPM`).toBeLessThanOrEqual(160);
    }
  });

  it("shows a rising monthly trend that comes from rising readings", async () => {
    const cohort = await provisionLocalDemoCohort();
    const db = await scopedDb(scopeForUser(cohort.teacher));
    const rows = (await db.select().from(readingSessions).where(eq(readingSessions.childProfileId, cohort.profile.id)))
      .filter(row => row.storyTitle.startsWith("Garden Walk"))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    expect(rows.map(row => row.storyTitle)).toEqual(["Garden Walk · June", "Garden Walk · July", "Garden Walk · August"]);
    // Derived, not asserted: fewer slips and less time each month must produce the rise.
    expect(rows[0]!.accuracy).toBeLessThan(rows[2]!.accuracy);
    expect(rows[0]!.wordsCorrectPerMinute).toBeLessThan(rows[2]!.wordsCorrectPerMinute);
    expect(rows[0]!.durationSeconds).toBeGreaterThan(rows[2]!.durationSeconds);
  });
});
