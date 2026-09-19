import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { childProfiles, readingSessions, schools, users, type StoredIntervention } from "../drizzle/schema";
import { getAccentFairnessSummary, computeLiveFairness } from "./accentMetrics";
import { getDb } from "./db";
import { listSessionsForAccentFairness } from "./readerDb";
import { ensureTestSchool } from "./tenancyFixture";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const testKey = `fair-${crypto.randomUUID().slice(0, 8)}`;
const createdSchoolIds: number[] = [];

/** One reviewed word. `confirmed` upholds the system's reading, `overridden` reverses it. */
const decided = (word: string, treatedAsVariant: boolean, decision: "confirmed" | "overridden"): StoredIntervention => ({
  word,
  action: "teacher_review",
  note: "fixture",
  eventType: treatedAsVariant ? "dialect_variation" : "substitution",
  heardWord: `${word}-heard`,
  provisionalIrishEnglish: treatedAsVariant,
  teacherDecision: decision,
});

async function seedSchool(slug: string, name: string, sessions: StoredIntervention[][]) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable for integration coverage.");
  const schoolId = await ensureTestSchool(slug, name);
  createdSchoolIds.push(schoolId);
  await db.insert(users).values({ schoolId, openId: `${slug}-child`, name: "Learner", loginMethod: "vitest", role: "child" });
  const [child] = await db.select().from(users).where(eq(users.openId, `${slug}-child`)).limit(1);
  if (!child) throw new Error("Could not create the fairness fixture learner.");
  await db.insert(childProfiles).values({ schoolId, userId: child.id, displayName: "Learner", familyCode: `F${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}` });
  const [profile] = await db.select().from(childProfiles).where(eq(childProfiles.userId, child.id)).limit(1);
  if (!profile) throw new Error("Could not create the fairness fixture profile.");
  for (const [index, interventions] of sessions.entries()) {
    await db.insert(readingSessions).values({
      schoolId, childProfileId: profile.id, storyTitle: `${name} ${index}`, transcript: "t",
      accuracy: 90, wordsCorrectPerMinute: 100, durationSeconds: 60,
      practiceWords: [], interventions, wordStates: [],
    });
  }
  return schoolId;
}

afterAll(async () => {
  if (!databaseAvailable) return;
  const db = await getDb();
  if (!db) return;
  for (const schoolId of createdSchoolIds) await db.delete(schools).where(eq(schools.id, schoolId));
});

describe.skipIf(!databaseAvailable)("accent fairness is measured per school", () => {
  it("reports each school its own live figure, not a pooled cross-tenant one", async () => {
    // Oakfield: 2 upheld variants, 1 reversal  -> false-correction 1/3 = 33%
    const oakfield = await seedSchool(`${testKey}-oakfield`, "Oakfield NS", [
      [decided("three", true, "confirmed"), decided("path", true, "confirmed")],
      [decided("brought", false, "overridden")],
    ]);
    // Rivermount: 1 upheld variant, 3 reversals -> false-correction 3/4 = 75%
    const rivermount = await seedSchool(`${testKey}-rivermount`, "Rivermount NS", [
      [decided("with", true, "confirmed"), decided("month", false, "overridden")],
      [decided("north", false, "overridden"), decided("teeth", false, "overridden")],
    ]);

    const oakfieldLive = computeLiveFairness(await listSessionsForAccentFairness({ schoolId: oakfield }));
    const rivermountLive = computeLiveFairness(await listSessionsForAccentFairness({ schoolId: rivermount }));

    expect(oakfieldLive).toMatchObject({ totalReviewed: 3, falseCorrectionRatePct: 33 });
    expect(rivermountLive).toMatchObject({ totalReviewed: 4, falseCorrectionRatePct: 75 });

    // What the dashboard reported before the predicate landed: one figure pooled across every
    // school in the database. Recorded here so the bug stays evidenced rather than asserted.
    const db = await getDb();
    if (!db) throw new Error("Database is unavailable for integration coverage.");
    const pooled = computeLiveFairness(
      await db.select({ id: readingSessions.id, interventions: readingSessions.interventions })
        .from(readingSessions)
        .where(eq(readingSessions.schoolId, oakfield)),
    );
    const bothSchools = computeLiveFairness([
      ...(await listSessionsForAccentFairness({ schoolId: oakfield })),
      ...(await listSessionsForAccentFairness({ schoolId: rivermount })),
    ]);
    expect(bothSchools).toMatchObject({ totalReviewed: 7, falseCorrectionRatePct: 57 });
    // Neither school's own figure equals the pooled one, which is the whole point.
    expect(bothSchools.falseCorrectionRatePct).not.toBe(oakfieldLive.falseCorrectionRatePct);
    expect(bothSchools.falseCorrectionRatePct).not.toBe(rivermountLive.falseCorrectionRatePct);
    expect(pooled).toMatchObject({ totalReviewed: 3 });
  });

  it("leaves the curated contrast untouched at 16 pairs", async () => {
    const summary = getAccentFairnessSummary(await listSessionsForAccentFairness({ schoolId: createdSchoolIds[0] ?? 1 }));
    expect(summary.curated.total).toBe(16);
    expect(summary.curated.baseline.flagged).toBeGreaterThan(summary.curated.readerLeader.flagged);
  });
});
