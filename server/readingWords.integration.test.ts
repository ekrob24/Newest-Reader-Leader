import { describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { childProfiles, readingSessions, readingWords, users, type StoredIntervention } from "../drizzle/schema";
import { countsAgainstScore } from "../shared/readingWordScore";
import { analyseReadingText } from "./reader";
import { getDb } from "./db";
import { saveReadingSession } from "./readerDb";
import { ensureTestSchool } from "./tenancyFixture";
import { scopeForUser } from "./tenantScope";

const databaseAvailable = Boolean(process.env.DATABASE_URL);

async function fixture() {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable for integration coverage.");
  const key = `rw-${crypto.randomUUID().slice(0, 8)}`;
  const schoolId = await ensureTestSchool(`school-${key}`);
  await db.insert(users).values({ schoolId, openId: `${key}-t`, name: "T", loginMethod: "vitest", role: "teacher" });
  await db.insert(users).values({ schoolId, openId: `${key}-c`, name: "C", loginMethod: "vitest", role: "child" });
  const [teacher] = await db.select().from(users).where(eq(users.openId, `${key}-t`)).limit(1);
  const [child] = await db.select().from(users).where(eq(users.openId, `${key}-c`)).limit(1);
  if (!teacher || !child) throw new Error("Could not create the readingWords fixture accounts.");
  await db.insert(childProfiles).values({ schoolId, userId: child.id, displayName: "Learner", familyCode: `F${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}` });
  const [profile] = await db.select().from(childProfiles).where(eq(childProfiles.userId, child.id)).limit(1);
  if (!profile) throw new Error("Could not create the readingWords fixture profile.");
  return { db, scope: scopeForUser(teacher), childProfileId: profile.id };
}

/** A real reading: one word misread, the rest correct, analysed by the real engine. */
const EXPECTED_TEXT = "the small brown fox sat quietly by the gate";
const TRANSCRIPT = "the small brown box sat quietly by the gate";

async function saveAnalysedSession() {
  const { db, scope, childProfileId } = await fixture();
  const analysis = analyseReadingText(EXPECTED_TEXT, TRANSCRIPT, 30, "ASSISTED_PRACTICE", undefined, "STANDARD_ENGLISH");
  const interventions: StoredIntervention[] = analysis.events
    .filter(event => event.eventType !== "correct")
    .map(event => ({
      word: event.expectedWord,
      action: "teacher_review" as const,
      note: "flagged",
      eventType: event.eventType,
      heardWord: event.recognisedWord ?? undefined,
      provisionalIrishEnglish: event.provisionalIrishEnglish,
    }));
  const saved = await saveReadingSession(scope, {
    childProfileId, storyTitle: "Word rows", transcript: analysis.transcript,
    accuracy: analysis.accuracy, wordsCorrectPerMinute: analysis.pace,
    durationSeconds: analysis.durationSeconds, practiceWords: analysis.practiceWords,
    interventions, wordStates: analysis.wordStates,
    wordTimings: analysis.wordStates.map((state, index) => ({ id: state.id, text: state.text, startMs: index * 500, endMs: index * 500 + 400 })),
  });
  return { db, scope, savedId: saved.id, interventions };
}

describe.skipIf(!databaseAvailable)("readingWords agrees with the JSON columns", () => {
  it("describes the same reading: same count, same order, same per-word outcome", async () => {
    const { db, savedId } = await saveAnalysedSession();

    // Read BOTH back from the database, not from the objects we passed in.
    const [session] = await db.select().from(readingSessions).where(eq(readingSessions.id, savedId)).limit(1);
    if (!session) throw new Error("The session was not saved.");
    const rows = await db.select().from(readingWords).where(eq(readingWords.sessionId, savedId)).orderBy(asc(readingWords.tokenIndex));

    // Guard against a vacuous pass: if the write path wrote nothing, or the passage were
    // empty, every comparison below would hold trivially. It must not.
    expect(rows.length, "the write path must have written rows").toBeGreaterThan(0);
    expect(session.wordStates.length).toBe(9);

    // Same count.
    expect(rows.length).toBe(session.wordStates.length);
    // Same order, word for word.
    expect(rows.map(row => row.referenceWord)).toEqual(session.wordStates.map(state => state.text));
    expect(rows.map(row => row.tokenIndex)).toEqual(session.wordStates.map((_, index) => index));
    // Same per-word progress and attempts.
    expect(rows.map(row => row.progress)).toEqual(session.wordStates.map(state => state.status));
    expect(rows.map(row => row.attempts)).toEqual(session.wordStates.map(state => state.attempts));
    // Same word ids, so a row can be traced back to its JSON entry.
    expect(rows.map(row => row.wordEventId)).toEqual(session.wordStates.map(state => state.id));
    // Timings carried across.
    expect(rows.map(row => row.startMs)).toEqual(session.wordStates.map((_, index) => index * 500));
  });

  it("marks the misread word as a miscue and the rest as correct", async () => {
    const { db, savedId, interventions } = await saveAnalysedSession();
    const rows = await db.select().from(readingWords).where(eq(readingWords.sessionId, savedId)).orderBy(asc(readingWords.tokenIndex));

    // The reading really did contain exactly one flagged word, so the rows must not be uniform.
    expect(interventions).toHaveLength(1);
    expect(interventions[0].word).toBe("fox");

    const fox = rows.find(row => row.referenceWord === "fox");
    expect(fox?.judgement).toBe("substitution");
    expect(fox?.heardWord).toBe("box");
    expect(fox?.resolution, "nobody has reviewed it yet").toBe("unreviewed");
    expect(fox?.pronunciationContext).toBe("not_matched");

    const others = rows.filter(row => row.referenceWord !== "fox");
    expect(others).toHaveLength(8);
    expect(new Set(others.map(row => row.judgement))).toEqual(new Set(["correct"]));
    expect(new Set(others.map(row => row.resolution))).toEqual(new Set(["auto"]));
  });

  it("counts nothing against the child until a teacher confirms it", async () => {
    const { db, savedId } = await saveAnalysedSession();
    const rows = await db.select().from(readingWords).where(eq(readingWords.sessionId, savedId));
    // The miscue exists...
    expect(rows.some(row => row.judgement === "substitution")).toBe(true);
    // ...and still counts for nothing, because no human has settled it.
    expect(rows.filter(countsAgainstScore)).toHaveLength(0);
  });

  it("reports every confidence as null rather than inventing one", async () => {
    const { db, savedId } = await saveAnalysedSession();
    const rows = await db.select().from(readingWords).where(eq(readingWords.sessionId, savedId));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.audioConfidence).toBeNull();
      expect(row.alignmentConfidence).toBeNull();
      expect(row.lexicalConfidence).toBeNull();
      expect(row.pronunciationConfidence).toBeNull();
      expect(row.provider).toBe("reader-leader-aligner");
      expect(row.policyVersion).toBe("2026-09-19");
    }
  });
});
