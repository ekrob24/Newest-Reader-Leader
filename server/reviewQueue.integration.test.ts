import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { analyseReadingText, buildInterventions } from "./reader";
import { getDb } from "./db";
import { getTeacherSessionReview, listReviewWords, saveReadingSession } from "./readerDb";
import { ensureTestSchool } from "./tenancyFixture";
import { scopeForUser } from "./tenantScope";
import { buildReviewQueue } from "../shared/reviewRanking";

const databaseAvailable = Boolean(process.env.DATABASE_URL);

const PASSAGE = "Amina carried a little lantern into the garden at dusk";
const HEARD = "Amina carried a little lantern into the garden at dust";

async function fixture() {
  const key = crypto.randomUUID().slice(0, 8);
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable for integration coverage.");
  const schoolId = await ensureTestSchool(`school-rq-${key}`.slice(0, 60));
  const { users, childProfiles } = await import("../drizzle/schema");
  await db.insert(users).values({ schoolId, openId: `${key}-t`, name: "T", loginMethod: "vitest", role: "teacher" });
  await db.insert(users).values({ schoolId, openId: `${key}-c`, name: "C", loginMethod: "vitest", role: "child" });
  const [teacher] = await db.select().from(users).where(eq(users.openId, `${key}-t`)).limit(1);
  const [child] = await db.select().from(users).where(eq(users.openId, `${key}-c`)).limit(1);
  if (!teacher || !child) throw new Error("Could not create the review-queue fixture accounts.");
  await db.insert(childProfiles).values({ schoolId, userId: child.id, displayName: "Learner", familyCode: `F${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}` });
  const [profile] = await db.select().from(childProfiles).where(eq(childProfiles.userId, child.id)).limit(1);
  if (!profile) throw new Error("Could not create the review-queue fixture profile.");

  const analysis = analyseReadingText(PASSAGE, HEARD, 45);
  const scope = scopeForUser(teacher);
  const session = await saveReadingSession(scope, {
    childProfileId: profile.id, storyTitle: "Queue check", transcript: analysis.transcript,
    accuracy: analysis.accuracy, wordsCorrectPerMinute: analysis.pace, durationSeconds: analysis.durationSeconds,
    practiceWords: analysis.practiceWords, interventions: buildInterventions(analysis.events),
    wordStates: analysis.wordStates,
  });
  return { scope, sessionId: session.id, expectedWords: analysis.wordStates.length };
}

describe.skipIf(!databaseAvailable)("the review queue reads what is actually stored", () => {
  it("returns one row per word of reading opportunity", async () => {
    const { scope, sessionId, expectedWords } = await fixture();
    const words = await listReviewWords(scope, sessionId);
    // A check against an empty list would hold trivially, so the count is asserted against
    // the analyser's own word count rather than against "more than zero".
    expect(expectedWords).toBeGreaterThan(5);
    expect(words).toHaveLength(expectedWords);
    expect(words.map(word => word.tokenIndex)).toEqual([...words].map((_, index) => index));
  });

  it("carries no score, because nothing writes one", async () => {
    const { scope, sessionId } = await fixture();
    const words = await listReviewWords(scope, sessionId);
    expect(words.every(word => word.score === null)).toBe(true);
  });

  it("so the queue reports itself unordered rather than inventing an order", async () => {
    const { scope, sessionId } = await fixture();
    const queue = buildReviewQueue(await listReviewWords(scope, sessionId));
    expect(queue.unordered).toBe(true);
    expect(queue.ranked).toEqual([]);
    expect(queue.unscored.length).toBeGreaterThan(5);
  });

  it("orders by score as soon as one is written, and does not sink the unscored", async () => {
    const { scope, sessionId } = await fixture();
    const db = await getDb();
    const { readingWords } = await import("../drizzle/schema");
    const stored = await listReviewWords(scope, sessionId);
    const [first, second] = stored;
    await db!.update(readingWords).set({ alignmentConfidence: "0.180" })
      .where(eq(readingWords.wordEventId, first.wordEventId));
    await db!.update(readingWords).set({ alignmentConfidence: "0.910" })
      .where(eq(readingWords.wordEventId, second.wordEventId));

    const words = await listReviewWords(scope, sessionId);
    const queue = buildReviewQueue(words);
    expect(queue.unordered).toBe(false);
    expect(queue.ranked.map(word => word.referenceWord))
      .toEqual([first.referenceWord, second.referenceWord]);
    expect(queue.ranked[0].score).toBeCloseTo(0.18);
    expect(queue.unscored).toHaveLength(words.length - 2);
    // The unscored words must not have become rank 3 onwards by being read as zero or one.
    expect(queue.ranked).toHaveLength(2);
  });

  it("reaches the teacher review screen with the session", async () => {
    const { scope, sessionId } = await fixture();
    const review = await getTeacherSessionReview(scope, sessionId);
    expect(review?.reviewWords.length).toBeGreaterThan(5);
    expect(review?.reviewWords.every(word => "score" in word && "startMs" in word)).toBe(true);
  });
});
