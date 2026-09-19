import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { acknowledgeUnrecordedReadingAttempt, listUnrecordedReadingAttempts, recordUnrecordedReadingAttempt } from "./readerDb";
import { ensureTestSchool } from "./tenancyFixture";
import { scopeForUser } from "./tenantScope";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const testKey = `una-${crypto.randomUUID().slice(0, 8)}`;

async function fixture() {
  const key = `${testKey}-${crypto.randomUUID().slice(0, 8)}`;
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable for integration coverage.");
  const schoolId = await ensureTestSchool(`school-${key}`.slice(0, 60));
  const { users, childProfiles, readerClasses } = await import("../drizzle/schema");
  await db.insert(users).values({ schoolId, openId: `${key}-t`, name: "T", loginMethod: "vitest", role: "teacher" });
  await db.insert(users).values({ schoolId, openId: `${key}-c`, name: "C", loginMethod: "vitest", role: "child" });
  const [teacher] = await db.select().from(users).where(eq(users.openId, `${key}-t`)).limit(1);
  const [child] = await db.select().from(users).where(eq(users.openId, `${key}-c`)).limit(1);
  if (!teacher || !child) throw new Error("Could not create the unrecorded-attempt fixture accounts.");
  await db.insert(childProfiles).values({ schoolId, userId: child.id, displayName: "Learner", familyCode: `F${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}` });
  const [profile] = await db.select().from(childProfiles).where(eq(childProfiles.userId, child.id)).limit(1);
  if (!profile) throw new Error("Could not create the unrecorded-attempt fixture profile.");
  await db.insert(readerClasses).values({ schoolId, teacherUserId: teacher.id, name: `Class ${key}`.slice(0, 60), joinCode: crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase() });
  const [readerClass] = await db.select().from(readerClasses).where(eq(readerClasses.teacherUserId, teacher.id)).limit(1);
  if (!readerClass) throw new Error("Could not create the unrecorded-attempt fixture class.");
  const { classEnrollments } = await import("../drizzle/schema");
  await db.insert(classEnrollments).values({ schoolId, classId: readerClass.id, childProfileId: profile.id });
  return { scope: scopeForUser(teacher), teacherId: teacher.id, childProfileId: profile.id };
}

describe.skipIf(!databaseAvailable)("a reading that was not recorded", () => {
  it("is visible to the teacher who is responsible for the child", async () => {
    // The failed write is a bug. A gap in a child's history that nobody can see is the
    // governance failure, so the absence itself has to leave a record.
    const { scope, teacherId, childProfileId } = await fixture();
    expect(await listUnrecordedReadingAttempts(scope, teacherId)).toEqual([]);

    await recordUnrecordedReadingAttempt(scope, { childProfileId, storyTitle: "The Lantern in the Garden", reason: "save_rejected", detail: "Keep this practice recording under 4.5 MB and try again.", durationSeconds: 34 });

    const waiting = await listUnrecordedReadingAttempts(scope, teacherId);
    expect(waiting.length).toBe(1);
    expect(waiting[0]).toMatchObject({ childName: "Learner", storyTitle: "The Lantern in the Garden", reason: "save_rejected", durationSeconds: 34 });
    expect(waiting[0]!.detail).toMatch(/4.5 MB/);
  });

  it("leaves the list once a teacher has followed it up", async () => {
    const { scope, teacherId, childProfileId } = await fixture();
    const attempt = await recordUnrecordedReadingAttempt(scope, { childProfileId, storyTitle: "Garden Walk", reason: "request_failed" });
    expect((await listUnrecordedReadingAttempts(scope, teacherId)).length).toBe(1);
    const cleared = await acknowledgeUnrecordedReadingAttempt(scope, teacherId, attempt.id);
    expect(cleared.acknowledgedByTeacherId).toBe(teacherId);
    expect(await listUnrecordedReadingAttempts(scope, teacherId)).toEqual([]);
  });

  it("is not visible to a teacher in another school", async () => {
    const mine = await fixture();
    const theirs = await fixture();
    await recordUnrecordedReadingAttempt(mine.scope, { childProfileId: mine.childProfileId, storyTitle: "Mine", reason: "save_rejected" });
    expect(await listUnrecordedReadingAttempts(theirs.scope, theirs.teacherId)).toEqual([]);
  });
});
