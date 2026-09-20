import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { readingWords } from "../drizzle/schema";
import { analyseReadingText, buildInterventions } from "./reader";
import { getDb } from "./db";
import { getSettledAccuracy, saveReadingSession, saveTeacherInterventionDecision } from "./readerDb";
import { ensureTestSchool } from "./tenancyFixture";
import { scopeForUser, scopedDb } from "./tenantScope";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const testKey = `ovr-${crypto.randomUUID().slice(0, 8)}`;

const PASSAGE = "Amina carried a little lantern into the garden at dusk";
const HEARD = "Amina carried a little lantern into the garden at dust";

async function fixture() {
  const key = `${testKey}-${crypto.randomUUID().slice(0, 8)}`;
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable for integration coverage.");
  const schoolId = await ensureTestSchool(`school-${key}`.slice(0, 60));
  const { users, childProfiles } = await import("../drizzle/schema");
  await db.insert(users).values({ schoolId, openId: `${key}-t`, name: "T", loginMethod: "vitest", role: "teacher" });
  await db.insert(users).values({ schoolId, openId: `${key}-c`, name: "C", loginMethod: "vitest", role: "child" });
  const [teacher] = await db.select().from(users).where(eq(users.openId, `${key}-t`)).limit(1);
  const [child] = await db.select().from(users).where(eq(users.openId, `${key}-c`)).limit(1);
  if (!teacher || !child) throw new Error("Could not create the override fixture accounts.");
  await db.insert(childProfiles).values({ schoolId, userId: child.id, displayName: "Learner", familyCode: `F${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}` });
  const [profile] = await db.select().from(childProfiles).where(eq(childProfiles.userId, child.id)).limit(1);
  if (!profile) throw new Error("Could not create the override fixture profile.");

  const analysis = analyseReadingText(PASSAGE, HEARD, 45);
  const interventions = buildInterventions(analysis.events);
  expect(interventions.length).toBeGreaterThan(0);
  const scope = scopeForUser(teacher);
  const session = await saveReadingSession(scope, {
    childProfileId: profile.id, storyTitle: "Override check", transcript: analysis.transcript,
    accuracy: analysis.accuracy, wordsCorrectPerMinute: analysis.pace, durationSeconds: analysis.durationSeconds,
    interventions, wordStates: analysis.wordStates,
  });
  return { scope, sessionId: session.id, storedAccuracy: session.accuracy };
}

describe.skipIf(!databaseAvailable)("a teacher decision reaches the derived score", () => {
  it("counts nothing against a reading until a human confirms it", async () => {
    // The whole Article 14 claim: a machine judgement no human has checked must not enter a
    // child's record. Before any decision the flagged word is unreviewed, so it counts for
    // nothing, even though the stored story-match figure already reflects it.
    const { scope, sessionId, storedAccuracy } = await fixture();
    const before = await getSettledAccuracy(scope, sessionId);
    expect(before.wordCount).toBeGreaterThan(0);
    expect(before.countedAgainst).toBe(0);
    expect(before.accuracy).toBe(100);
    expect(storedAccuracy).toBeLessThan(100);
  });

  it("moves the number when a teacher confirms, and moves it back when they override", async () => {
    const { scope, sessionId } = await fixture();
    const confirmed = await saveTeacherInterventionDecision(scope, sessionId, 0, "confirmed").then(() => getSettledAccuracy(scope, sessionId));
    expect(confirmed.countedAgainst).toBe(1);
    expect(confirmed.accuracy).toBeLessThan(100);

    const overridden = await saveTeacherInterventionDecision(scope, sessionId, 0, "overridden").then(() => getSettledAccuracy(scope, sessionId));
    expect(overridden.countedAgainst).toBe(0);
    expect(overridden.accuracy).toBe(100);
  });

  it("writes the decision onto the word row, not only the session JSON", async () => {
    // Updating the JSON alone is how an override and the number on screen drift apart.
    const { scope, sessionId } = await fixture();
    await saveTeacherInterventionDecision(scope, sessionId, 0, "confirmed");
    const db = await scopedDb(scope);
    const rows = await db.select().from(readingWords).where(eq(readingWords.sessionId, sessionId));
    const settled = rows.filter(row => row.resolution === "teacher_confirmed");
    expect(settled.length).toBe(1);
    expect(settled[0]!.referenceWord).toBe("dusk");
  });
});
