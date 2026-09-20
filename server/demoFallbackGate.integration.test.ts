import { describe, expect, it } from "vitest";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { getSettledAccuracy, provisionLocalDemoCohort, saveTeacherInterventionDecision } from "./readerDb";
import { scopeForUser } from "./tenantScope";

/**
 * The four numbers the fallback demo rests on.
 *
 * They were observed in the recorded walkthrough, on screen, not derived from the code. The
 * fallback is what E shows if the microphone fails, so these are the figures a room will see,
 * and any change to matching or scoring that moves them has broken the demo.
 *
 * This is a gate, not a description. If a change moves a number here, the number is wrong and
 * the change is at fault - do not adjust the expectation to match.
 */
const SEEDED_RECORD = "The Lantern in the Garden · last week";
const EXPECTED = {
  // Reading speed is withheld until the review is finished, so before any decision the screen
  // shows an em dash and says why. Observed in frames/09-review-before-decisions.png. An
  // earlier draft of the runbook claimed 93 here; that was inferred and wrong, and this gate
  // is written from the frame rather than from that claim.
  beforeAnyDecision: { accuracy: 100, wcpm: null },
  afterConfirmingTheMiscue: { accuracy: 98, wcpm: 91 },
  afterOverridingIt: { accuracy: 100, wcpm: 93 },
  afterConfirmingTheAccentVariation: { accuracy: 100, wcpm: 93 },
};

const databaseAvailable = Boolean(process.env.DATABASE_URL);

/**
 * Put the seeded record back to "no decisions made".
 *
 * Teacher decisions persist, and the runbook tells a presenter to drop the database before
 * showing the sequence twice. A gate cannot ask that of CI, and a gate that only passes on a
 * virgin database would pass once and then be quietly disabled by its own failure. So it
 * resets what it is about to walk, and it resets both places a decision is written - the
 * session JSON and the word rows - because a reset that missed one would leave the figures
 * unreachable and look like a regression in whatever change ran next.
 */
async function clearDecisions(sessionId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable for integration coverage.");
  const { readingSessions, readingWords } = await import("../drizzle/schema");
  const [session] = await db.select().from(readingSessions).where(eq(readingSessions.id, sessionId)).limit(1);
  if (!session) throw new Error("Cannot reset a session that is not there.");
  const cleared = (session.interventions ?? []).map(item => {
    const { teacherDecision: _decided, ...rest } = item as Record<string, unknown>;
    return rest;
  });
  await db.update(readingSessions).set({ interventions: cleared as typeof session.interventions }).where(eq(readingSessions.id, sessionId));
  await db.update(readingWords).set({ resolution: "unreviewed" })
    .where(and(eq(readingWords.sessionId, sessionId), inArray(readingWords.judgement, ["substitution", "omission", "insertion"])));
}

async function seededReading() {
  const cohort = await provisionLocalDemoCohort();
  const scope = scopeForUser(cohort.teacher);
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable for integration coverage.");
  const { readingSessions } = await import("../drizzle/schema");
  const [session] = await db.select().from(readingSessions)
    .where(eq(readingSessions.storyTitle, SEEDED_RECORD))
    .orderBy(desc(readingSessions.createdAt)).limit(1);
  if (!session) throw new Error(`The seeded record "${SEEDED_RECORD}" is missing; the fallback demo has no reading to open.`);
  await clearDecisions(session.id);
  const [reset] = await db.select().from(readingSessions).where(eq(readingSessions.id, session.id)).limit(1);
  return { scope, session: reset! };
}

/** Which flagged moment is the miscue and which is the accent variation, by position. */
function momentIndexes(interventions: { eventType?: string; provisionalIrishEnglish?: boolean }[]) {
  const accent = interventions.findIndex(item => item.eventType === "dialect_variation" || item.provisionalIrishEnglish === true);
  const miscue = interventions.findIndex((item, index) => index !== accent);
  return { accent, miscue };
}

describe.skipIf(!databaseAvailable)("the fallback demo's four numbers", () => {
  it("walks the demo exactly as the runbook does, and every figure matches what was on screen", async () => {
    const { scope, session } = await seededReading();
    const interventions = (session.interventions ?? []) as { eventType?: string; provisionalIrishEnglish?: boolean }[];
    // Two flagged moments and no decisions yet: the runbook's stated precondition. Asserted
    // rather than assumed, so a used database says so here instead of failing on a figure.
    expect(interventions).toHaveLength(2);
    expect(interventions.every(item => !("teacherDecision" in item) || !(item as { teacherDecision?: string }).teacherDecision)).toBe(true);
    const { accent, miscue } = momentIndexes(interventions);
    expect(accent, "the seeded record must carry one accent variation").toBeGreaterThanOrEqual(0);
    expect(miscue, "and one ordinary miscue").toBeGreaterThanOrEqual(0);

    const before = await getSettledAccuracy(scope, session.id);
    expect({ accuracy: before.accuracy, wcpm: before.wordsCorrectPerMinute }).toEqual(EXPECTED.beforeAnyDecision);
    // The five-intervention cap threw nothing away here. If it ever did, every figure below
    // would become an em dash and the demo would show nothing at all.
    expect(before.discardedErrors).toBe(0);
    expect(before.wordCount).toBe(42);
    // The pace is withheld because the review is genuinely unfinished, not because it failed.
    expect(before.reviewComplete).toBe(false);

    await saveTeacherInterventionDecision(scope, session.id, miscue, "confirmed");
    const confirmed = await getSettledAccuracy(scope, session.id);
    expect({ accuracy: confirmed.accuracy, wcpm: confirmed.wordsCorrectPerMinute }).toEqual(EXPECTED.afterConfirmingTheMiscue);

    await saveTeacherInterventionDecision(scope, session.id, miscue, "overridden");
    const overridden = await getSettledAccuracy(scope, session.id);
    expect({ accuracy: overridden.accuracy, wcpm: overridden.wordsCorrectPerMinute }).toEqual(EXPECTED.afterOverridingIt);

    await saveTeacherInterventionDecision(scope, session.id, accent, "confirmed");
    const accentConfirmed = await getSettledAccuracy(scope, session.id);
    expect({ accuracy: accentConfirmed.accuracy, wcpm: accentConfirmed.wordsCorrectPerMinute }).toEqual(EXPECTED.afterConfirmingTheAccentVariation);

    // The demo's point, restated as an assertion: confirming moves the record, overriding
    // takes it back, and an accent variation never moves it at all.
    expect(confirmed.accuracy).toBeLessThan(before.accuracy!);
    expect(overridden.accuracy).toBe(before.accuracy);
    expect(accentConfirmed.accuracy).toBe(overridden.accuracy);
  });

});
