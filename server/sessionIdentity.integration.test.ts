import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { readingSessions } from "../drizzle/schema";
import { CAPTURE_CLOCK_TOLERANCE_MS } from "../shared/captureTime";
import { isSessionId, sessionIdTime } from "../shared/sessionId";
import { getDb } from "./db";
import { addSessionComment, createProvisionalMatchReviews, getSessionById, saveReadingSession } from "./readerDb";
import { ensureTestSchool } from "./tenancyFixture";
import { scopeForUser } from "./tenantScope";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const testKey = `sid-${crypto.randomUUID().slice(0, 8)}`;

/** A fresh teacher, learner and school per test, so tests cannot collide on unique keys. */
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
  if (!teacher || !child) throw new Error("Could not create the session-identity fixture accounts.");
  await db.insert(childProfiles).values({ schoolId, userId: child.id, displayName: "Learner", familyCode: `F${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}` });
  const [profile] = await db.select().from(childProfiles).where(eq(childProfiles.userId, child.id)).limit(1);
  if (!profile) throw new Error("Could not create the session-identity fixture profile.");
  return { scope: scopeForUser(teacher), teacherId: teacher.id, childProfileId: profile.id };
}

const baseSession = (childProfileId: number) => ({
  childProfileId, storyTitle: "Identity check", transcript: "t", accuracy: 90,
  wordsCorrectPerMinute: 100, durationSeconds: 60, practiceWords: [], interventions: [],
});

describe.skipIf(!databaseAvailable)("session identity", () => {
  it("persists a ULID minted at capture and reads the row back by it", async () => {
    const { scope, childProfileId } = await fixture();
    const saved = await saveReadingSession(scope, baseSession(childProfileId));
    expect(isSessionId(saved.id)).toBe(true);
    // The id encodes its own capture time, so ordering needs no extra column.
    expect(Math.abs(sessionIdTime(saved.id) - Date.now())).toBeLessThan(60_000);
    expect((await getSessionById(scope, saved.id))?.id).toBe(saved.id);
  });

  it("gives two sessions saved back to back distinct, ascending ids", async () => {
    const { scope, childProfileId } = await fixture();
    const first = await saveReadingSession(scope, baseSession(childProfileId));
    const second = await saveReadingSession(scope, baseSession(childProfileId));
    expect(first.id).not.toBe(second.id);
    expect(first.id < second.id).toBe(true);
  });

  it("links child rows to the session by its ULID", async () => {
    const { scope, teacherId, childProfileId } = await fixture();
    const session = await saveReadingSession(scope, baseSession(childProfileId));
    const comment = await addSessionComment(scope, { sessionId: session.id, teacherUserId: teacherId, comment: "Lovely pace." });
    expect(comment.sessionId).toBe(session.id);
    expect(isSessionId(comment.id)).toBe(true);
    const [review] = await createProvisionalMatchReviews(scope, { sessionId: session.id, childProfileId, matches: [{ expectedWord: "three", recognisedWord: "tree" }] });
    expect(review.sessionId).toBe(session.id);
    expect(isSessionId(review.id)).toBe(true);
  });

  it("keeps a plausible device clock and marks it authoritative", async () => {
    const { scope, childProfileId } = await fixture();
    const device = new Date(Date.now() - 30_000);
    const saved = await saveReadingSession(scope, { ...baseSession(childProfileId), capturedAt: device });
    expect(saved.capturedAtSource).toBe("device");
    expect(saved.capturedAt).not.toBeNull();
  });

  it("prefers server time for a tablet whose clock is far out, without discarding the reading", async () => {
    const { scope, childProfileId } = await fixture();
    const device = new Date(Date.now() + CAPTURE_CLOCK_TOLERANCE_MS + 60 * 60 * 1000);
    const openedAt = Date.now();
    const saved = await saveReadingSession(scope, { ...baseSession(childProfileId), capturedAt: device });
    const closedAt = Date.now();
    expect(saved.capturedAtSource).toBe("server");
    // The device's claim is still on the row, so the bad clock stays diagnosable.
    expect(saved.capturedAt).not.toBeNull();
    expect(Math.abs((saved.capturedAt as Date).getTime() - device.getTime())).toBeLessThan(1000);
    // ...and the server's own timestamp is unaffected.
    //
    // The message carries every number the comparison used. This assertion failed on a real
    // machine reporting only "expected 3599498 to be less than 60000", which is a difference
    // with no inputs attached: it cost three rounds of guessing at causes, and two diagnostics
    // that measured the wrong thing, before anyone could see what the row actually held.
    const evidence = [
      `createdAt=${saved.createdAt.toISOString()}`,
      `insert window=${new Date(openedAt).toISOString()}..${new Date(closedAt).toISOString()}`,
      `capturedAt=${saved.capturedAt ? (saved.capturedAt as Date).toISOString() : "null"}`,
      `device claimed=${device.toISOString()}`,
      `id minted=${new Date(sessionIdTime(saved.id)).toISOString()}`,
      `source=${saved.capturedAtSource}`,
    ].join("  ");
    expect(Math.abs(saved.createdAt.getTime() - Date.now()), evidence).toBeLessThan(60_000);
  });

  it("records no device clock when none is supplied", async () => {
    const { scope, childProfileId } = await fixture();
    const db = await getDb();
    if (!db) throw new Error("Database is unavailable for integration coverage.");
    const saved = await saveReadingSession(scope, baseSession(childProfileId));
    const [row] = await db.select().from(readingSessions).where(eq(readingSessions.id, saved.id)).limit(1);
    expect(row?.capturedAt).toBeNull();
    expect(row?.capturedAtSource).toBe("server");
  });
});
