import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { readingSessions } from "../drizzle/schema";
import { getDb } from "./db";
import { getSessionById, saveReadingSession } from "./readerDb";
import { ensureTestSchool } from "./tenancyFixture";
import { scopeForUser } from "./tenantScope";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const testKey = `aud-${crypto.randomUUID().slice(0, 8)}`;

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
  if (!teacher || !child) throw new Error("Could not create the audio-retention fixture accounts.");
  await db.insert(childProfiles).values({ schoolId, userId: child.id, displayName: "Learner", familyCode: `F${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}` });
  const [profile] = await db.select().from(childProfiles).where(eq(childProfiles.userId, child.id)).limit(1);
  if (!profile) throw new Error("Could not create the audio-retention fixture profile.");
  return { db, scope: scopeForUser(teacher), childProfileId: profile.id };
}

const baseSession = (childProfileId: number) => ({
  childProfileId, storyTitle: "Audio retention check", transcript: "the cat sat", accuracy: 90,
  wordsCorrectPerMinute: 100, durationSeconds: 60, practiceWords: [], interventions: [],
});

describe.skipIf(!databaseAvailable)("audio retention status", () => {
  it("saves a session that has no recording at all", async () => {
    const { scope, childProfileId } = await fixture();
    // The whole point of the change: a rejected upload must not reject the reading.
    const saved = await saveReadingSession(scope, { ...baseSession(childProfileId), audioStorageKey: null, audioStatus: "storage_rejected" });
    expect(saved.audioStorageKey).toBeNull();
    expect(saved.audioStatus).toBe("storage_rejected");
    expect((await getSessionById(scope, saved.id))?.audioStatus).toBe("storage_rejected");
  });

  it("records storage being unconfigured separately from storage failing", async () => {
    const { scope, childProfileId } = await fixture();
    const unavailable = await saveReadingSession(scope, { ...baseSession(childProfileId), audioStatus: "storage_unavailable" });
    expect(unavailable.audioStatus).toBe("storage_unavailable");
  });

  it("defaults to the honest reason when a caller never attempted storage", async () => {
    const { scope, childProfileId } = await fixture();
    const saved = await saveReadingSession(scope, baseSession(childProfileId));
    expect(saved.audioStorageKey).toBeNull();
    expect(saved.audioStatus).toBe("not_captured");
  });

  it("marks a stored recording as stored", async () => {
    const { scope, childProfileId } = await fixture();
    const saved = await saveReadingSession(scope, { ...baseSession(childProfileId), audioStorageKey: "reader-leader/recordings/1/x.webm" });
    expect(saved.audioStatus).toBe("stored");
  });

  it("never leaves a row whose key and status disagree", async () => {
    const { db, scope, childProfileId } = await fixture();
    const withKey = await saveReadingSession(scope, { ...baseSession(childProfileId), audioStorageKey: "reader-leader/recordings/1/y.webm" });
    const withoutKey = await saveReadingSession(scope, { ...baseSession(childProfileId), audioStatus: "storage_unavailable" });
    const rows = await db.select().from(readingSessions).where(eq(readingSessions.childProfileId, childProfileId));
    expect(rows.length).toBe(2);
    for (const row of rows) expect(row.audioStatus === "stored").toBe(row.audioStorageKey !== null);
    expect([withKey.audioStatus, withoutKey.audioStatus]).toEqual(["stored", "storage_unavailable"]);
  });
});
