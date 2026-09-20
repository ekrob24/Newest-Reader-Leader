import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { analyseReadingText, buildInterventions } from "./reader";
import { getDb } from "./db";
import { getChildProgress, getSettledAccuracy, saveReadingSession, saveTeacherInterventionDecision } from "./readerDb";
import { ensureTestSchool } from "./tenancyFixture";
import { scopeForUser } from "./tenantScope";
import { progressForAudience } from "../shared/accuracyAudience";

const databaseAvailable = Boolean(process.env.DATABASE_URL);

// Long enough that pace is meaningful, and misread in two places so there is something to decide.
const PASSAGE = "Amina carried a little lantern into the garden at dusk and the light made golden circles on the winding garden path";
const HEARD = "Amina carried a little lantern into the garden at dust and the light made golden circles on the winding garden pass";
const SECONDS = 60;

async function fixture() {
  const key = crypto.randomUUID().slice(0, 8);
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable for integration coverage.");
  const schoolId = await ensureTestSchool(`school-pace-${key}`.slice(0, 60));
  const { users, childProfiles } = await import("../drizzle/schema");
  await db.insert(users).values({ schoolId, openId: `${key}-t`, name: "T", loginMethod: "vitest", role: "teacher" });
  await db.insert(users).values({ schoolId, openId: `${key}-c`, name: "C", loginMethod: "vitest", role: "child" });
  const [teacher] = await db.select().from(users).where(eq(users.openId, `${key}-t`)).limit(1);
  const [child] = await db.select().from(users).where(eq(users.openId, `${key}-c`)).limit(1);
  if (!teacher || !child) throw new Error("Could not create the pace fixture accounts.");
  await db.insert(childProfiles).values({ schoolId, userId: child.id, displayName: "Learner", familyCode: `F${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}` });
  const [profile] = await db.select().from(childProfiles).where(eq(childProfiles.userId, child.id)).limit(1);
  if (!profile) throw new Error("Could not create the pace fixture profile.");

  const analysis = analyseReadingText(PASSAGE, HEARD, SECONDS);
  const interventions = buildInterventions(analysis.events);
  // Two flagged moments, so "partly reviewed" is a state this reading can actually be in.
  expect(interventions.length).toBeGreaterThanOrEqual(2);
  const scope = scopeForUser(teacher);
  const session = await saveReadingSession(scope, {
    childProfileId: profile.id, storyTitle: "Pace check", transcript: analysis.transcript,
    accuracy: analysis.accuracy, wordsCorrectPerMinute: analysis.pace, durationSeconds: analysis.durationSeconds,
    practiceWords: analysis.practiceWords, interventions, wordStates: analysis.wordStates,
  });
  return { scope, profileId: profile.id, sessionId: session.id, flagged: interventions.length, machinePace: session.wordsCorrectPerMinute };
}

describe.skipIf(!databaseAvailable)("the pace a parent sees follows the teacher, not the recogniser", () => {
  it("is withheld before she has decided anything", async () => {
    const { scope, sessionId, machinePace } = await fixture();
    // The machine figure exists and is non-trivial - this is not passing because there is
    // nothing to show.
    expect(machinePace).toBeGreaterThan(0);
    const settled = await getSettledAccuracy(scope, sessionId);
    expect(settled.reviewComplete).toBe(false);
    expect(settled.wordsCorrectPerMinute).toBeNull();
  });

  it("is still withheld when she has decided some but not all of them", async () => {
    const { scope, sessionId, flagged } = await fixture();
    expect(flagged).toBeGreaterThanOrEqual(2);
    await saveTeacherInterventionDecision(scope, sessionId, 0, "confirmed");
    const partway = await getSettledAccuracy(scope, sessionId);
    expect(partway.countedAgainst).toBeGreaterThan(0);
    expect(partway.reviewComplete).toBe(false);
    expect(partway.wordsCorrectPerMinute).toBeNull();
  });

  it("appears once every flagged word has a decision, and is lower for the confirmed errors", async () => {
    const { scope, sessionId, flagged } = await fixture();
    for (let index = 0; index < flagged; index += 1) {
      await saveTeacherInterventionDecision(scope, sessionId, index, "confirmed");
    }
    const done = await getSettledAccuracy(scope, sessionId);
    expect(done.reviewComplete).toBe(true);
    expect(done.wordsCorrectPerMinute).not.toBeNull();
    const expected = Math.round(((done.wordCount - done.countedAgainst) / SECONDS) * 60);
    expect(done.wordsCorrectPerMinute).toBe(expected);
    // It dropped, and was not smoothed back up.
    expect(done.wordsCorrectPerMinute!).toBeLessThan(Math.round((done.wordCount / SECONDS) * 60));
  });

  it("goes back up when she overrules the machine instead", async () => {
    const { scope, sessionId, flagged } = await fixture();
    for (let index = 0; index < flagged; index += 1) {
      await saveTeacherInterventionDecision(scope, sessionId, index, "confirmed");
    }
    const strict = await getSettledAccuracy(scope, sessionId);
    for (let index = 0; index < flagged; index += 1) {
      await saveTeacherInterventionDecision(scope, sessionId, index, "overridden");
    }
    const lenient = await getSettledAccuracy(scope, sessionId);
    expect(lenient.reviewComplete).toBe(true);
    expect(lenient.countedAgainst).toBe(0);
    expect(lenient.wordsCorrectPerMinute!).toBeGreaterThan(strict.wordsCorrectPerMinute!);
  });

  it("reaches a parent as the settled figure, with the machine one gone", async () => {
    const { scope, profileId, sessionId, flagged } = await fixture();
    const before = progressForAudience(await getChildProgress(scope, profileId), "parent");
    expect(before.summary.averageWcpm).toBeNull();
    expect(before.summary.readingsWithSettledPace).toBe(0);
    expect(before.sessions.every(session => !("wordsCorrectPerMinute" in session))).toBe(true);

    for (let index = 0; index < flagged; index += 1) {
      await saveTeacherInterventionDecision(scope, sessionId, index, "overridden");
    }
    const after = progressForAudience(await getChildProgress(scope, profileId), "parent");
    expect(after.summary.averageWcpm).not.toBeNull();
    expect(after.summary.readingsWithSettledPace).toBe(1);
    expect(after.sessions[0].settledWordsCorrectPerMinute).toBe(after.summary.averageWcpm);
  });

  it("averages only the readings that have been finished", async () => {
    const { scope, profileId, sessionId, flagged } = await fixture();
    // A second reading on the same child, left entirely unreviewed.
    const analysis = analyseReadingText(PASSAGE, HEARD, SECONDS);
    await saveReadingSession(scope, {
      childProfileId: profileId, storyTitle: "Second, unreviewed", transcript: analysis.transcript,
      accuracy: analysis.accuracy, wordsCorrectPerMinute: analysis.pace, durationSeconds: SECONDS,
      practiceWords: analysis.practiceWords, interventions: buildInterventions(analysis.events),
      wordStates: analysis.wordStates,
    });
    for (let index = 0; index < flagged; index += 1) {
      await saveTeacherInterventionDecision(scope, sessionId, index, "overridden");
    }
    const progress = progressForAudience(await getChildProgress(scope, profileId), "parent");
    expect(progress.summary.sessionsCompleted).toBe(2);
    // Two readings saved, one reviewed: the average is of the one, not of both.
    expect(progress.summary.readingsWithSettledPace).toBe(1);
    const published = progress.sessions.filter(session => session.settledWordsCorrectPerMinute !== null);
    expect(published).toHaveLength(1);
    expect(progress.summary.averageWcpm).toBe(published[0].settledWordsCorrectPerMinute);
  });
});
