import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { analyseReadingText } from "./reader";
import { getDb } from "./db";
import { getChildProgress, getParentDashboard, saveReadingSession } from "./readerDb";
import { ensureTestSchool } from "./tenancyFixture";
import { scopeForUser } from "./tenantScope";
import { audienceForRole, progressForAudience } from "../shared/accuracyAudience";

const databaseAvailable = Boolean(process.env.DATABASE_URL);

const PASSAGE = "Amina carried a little lantern into the garden at dusk";
const HEARD = "Amina carried a little lantern into the garden at dust";

/** A real school, a real child, a real saved reading, and a parent linked to it. Everything
 *  below reads through the same functions the router calls, so a row that stores accuracy and
 *  a payload that withholds it are both observed rather than assumed. */
async function fixture() {
  const key = crypto.randomUUID().slice(0, 8);
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable for integration coverage.");
  const schoolId = await ensureTestSchool(`school-acc-${key}`.slice(0, 60));
  const { users, childProfiles, familyLinks } = await import("../drizzle/schema");
  await db.insert(users).values({ schoolId, openId: `${key}-t`, name: "T", loginMethod: "vitest", role: "teacher" });
  await db.insert(users).values({ schoolId, openId: `${key}-c`, name: "C", loginMethod: "vitest", role: "child" });
  await db.insert(users).values({ schoolId, openId: `${key}-p`, name: "P", loginMethod: "vitest", role: "parent" });
  const [teacher] = await db.select().from(users).where(eq(users.openId, `${key}-t`)).limit(1);
  const [child] = await db.select().from(users).where(eq(users.openId, `${key}-c`)).limit(1);
  const [parent] = await db.select().from(users).where(eq(users.openId, `${key}-p`)).limit(1);
  if (!teacher || !child || !parent) throw new Error("Could not create the audience fixture accounts.");
  await db.insert(childProfiles).values({ schoolId, userId: child.id, displayName: "Learner", familyCode: `F${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}` });
  const [profile] = await db.select().from(childProfiles).where(eq(childProfiles.userId, child.id)).limit(1);
  if (!profile) throw new Error("Could not create the audience fixture profile.");
  await db.insert(familyLinks).values({ schoolId, parentUserId: parent.id, childProfileId: profile.id });

  const analysis = analyseReadingText(PASSAGE, HEARD, 45);
  const scope = scopeForUser(teacher);
  const session = await saveReadingSession(scope, {
    childProfileId: profile.id, storyTitle: "Audience check", transcript: analysis.transcript,
    accuracy: analysis.accuracy, wordsCorrectPerMinute: analysis.pace, durationSeconds: analysis.durationSeconds,
    practiceWords: analysis.practiceWords, interventions: [], wordStates: analysis.wordStates,
  });
  return { scope, profileId: profile.id, parentUserId: parent.id, storedAccuracy: session.accuracy };
}

describe.skipIf(!databaseAvailable)("accuracy after it stops being shown", () => {
  it("is still on the saved row, because a teacher ranks her review queue by it", async () => {
    const { scope, profileId, storedAccuracy } = await fixture();
    // A check that would hold trivially against a perfect reading proves nothing: this passage
    // is deliberately misread, so the stored figure has to be a real number below 100.
    expect(storedAccuracy).toBeGreaterThan(0);
    expect(storedAccuracy).toBeLessThan(100);
    const teacherView = progressForAudience(await getChildProgress(scope, profileId), "teacher");
    expect(teacherView.sessions[0]?.accuracy).toBe(storedAccuracy);
    expect(teacherView.summary.averageAccuracy).toBe(storedAccuracy);
  });

  it("does not reach the child asking for her own progress", async () => {
    const { scope, profileId } = await fixture();
    const payload = progressForAudience(await getChildProgress(scope, profileId), audienceForRole("child"));
    expect(payload.sessions.length).toBeGreaterThan(0);
    expect(payload.sessions.every(session => !("accuracy" in session))).toBe(true);
    expect("averageAccuracy" in payload.summary).toBe(false);
    // The reading itself is still there - the figure went, the record did not.
    expect(payload.sessions[0]?.storyTitle).toBe("Audience check");
    expect(payload.summary.sessionsCompleted).toBe(1);
  });

  it("does not reach the parent dashboard", async () => {
    const { scope, parentUserId } = await fixture();
    const dashboard = await getParentDashboard(scope, parentUserId);
    const [linkedChild] = dashboard.children;
    expect(linkedChild, "the parent must actually be linked to a child").toBeTruthy();
    expect(linkedChild.sessions.length).toBeGreaterThan(0);
    expect(linkedChild.sessions.every(session => !("accuracy" in session))).toBe(true);
    expect("averageAccuracy" in linkedChild.summary).toBe(false);
    expect(linkedChild.summary.sessionsCompleted).toBe(1);
  });
});
