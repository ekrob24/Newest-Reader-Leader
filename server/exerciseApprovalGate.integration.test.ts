import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { childProfiles, readingExercises, users, type ExerciseSet } from "../drizzle/schema";
import { getDb } from "./db";
import {
  addLearnerToTeacherClass, approveReadingMaterial, assignReadingMaterialToClasses,
  createAdditionalClassForTeacher, createReadingMaterial, getAssignedMaterialForChild,
  makeReadingMaterialAssignable, saveGeneratedExercises,
} from "./readerDb";
import { ensureTestSchool } from "./tenancyFixture";
import { scopeForUser } from "./tenantScope";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const compact = () => crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();

const EXERCISES: ExerciseSet = {
  vocabulary: [{ word: "lantern", childFriendlyMeaning: "a small lamp you can carry" }],
  questions: [{ prompt: "What did she carry?", options: ["A lantern", "A kite", "A basket"], answer: "A lantern", explanation: "The story says a lantern." }],
  activity: "Draw the lantern.",
};

/** A teacher with an assigned passage and a learner who can see it. */
async function assignedPassage() {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable for integration coverage.");
  const key = `gate-${crypto.randomUUID().slice(0, 8)}`;
  const schoolId = await ensureTestSchool(`school-${key}`);
  await db.insert(users).values({ schoolId, openId: `${key}-t`, name: "T", loginMethod: "vitest", role: "teacher" });
  const [teacher] = await db.select().from(users).where(eq(users.openId, `${key}-t`)).limit(1);
  if (!teacher) throw new Error("Could not create the approval-gate teacher.");
  const scope = scopeForUser(teacher);

  const readerClass = await createAdditionalClassForTeacher(scope, teacher.id, "Gate Owls", `T${compact()}`);
  const learner = await addLearnerToTeacherClass(scope, { teacherUserId: teacher.id, classId: readerClass.id, displayName: "Gate Learner", bookBand: "Level 3 · Sky Blue", familyCode: `F${compact()}` });
  const material = await createReadingMaterial(scope, {
    teacherUserId: teacher.id, title: `Gate Passage ${key}`, author: "A", rightsSource: "original",
    interestAge: "8–10", genre: "Adventure", readingLevel: "Level 3 · Sky Blue",
    sourceText: "Amina carried a little lantern into the garden at dusk.",
  });
  // The full three-step lifecycle, then assignment — the passage is legitimately visible.
  await approveReadingMaterial(scope, teacher.id, material.id);
  await makeReadingMaterialAssignable(scope, teacher.id, material.id);
  await assignReadingMaterialToClasses(scope, teacher.id, material.id, [readerClass.id]);
  const [profile] = await db.select().from(childProfiles).where(eq(childProfiles.id, learner.profile.id)).limit(1);
  if (!profile) throw new Error("Could not read the approval-gate learner profile.");
  return { db, scope, teacher, materialId: material.id, childUserId: profile.userId };
}

describe.skipIf(!databaseAvailable)("exercise approval gate", () => {
  it("does not serve a generated quiz to a child before a teacher approves it", async () => {
    const { db, scope, materialId, childUserId } = await assignedPassage();

    // The passage is already assigned and visible to the child.
    const beforeGeneration = await getAssignedMaterialForChild(scope, childUserId, materialId);
    expect(beforeGeneration, "the passage itself must be visible").toBeDefined();
    expect(beforeGeneration?.exerciseSet ?? null).toBeNull();

    // A teacher now generates exercises. Nobody has reviewed them.
    await saveGeneratedExercises(scope, materialId, EXERCISES, "gpt-5-mini");
    const [row] = await db.select().from(readingExercises).where(eq(readingExercises.materialId, materialId)).limit(1);
    expect(row?.approvedAt ?? null, "generated exercises start unapproved").toBeNull();

    // The child must still see no quiz.
    const afterGeneration = await getAssignedMaterialForChild(scope, childUserId, materialId);
    expect(afterGeneration?.exerciseSet ?? null, "an unapproved quiz must not reach a child").toBeNull();
  });

  it("serves the quiz once a teacher has approved it", async () => {
    const { db, scope, teacher, materialId, childUserId } = await assignedPassage();
    await saveGeneratedExercises(scope, materialId, EXERCISES, "gpt-5-mini");
    // Approval is what makeReadingMaterialAssignable performs on the exercises.
    await makeReadingMaterialAssignable(scope, teacher.id, materialId);

    const [row] = await db.select().from(readingExercises).where(eq(readingExercises.materialId, materialId)).limit(1);
    expect(row?.approvedAt, "the approval must actually have been recorded").not.toBeNull();

    // Positive control: without this the gate test above would pass against a query that
    // never returns an exercise set at all.
    const served = await getAssignedMaterialForChild(scope, childUserId, materialId);
    expect(served?.exerciseSet?.activity).toBe("Draw the lantern.");
  });
});
