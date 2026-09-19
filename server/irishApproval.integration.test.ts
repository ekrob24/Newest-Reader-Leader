import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { childProfiles, classEnrollments, educatorApprovedIrishVariants, learnerReadingSettings, provisionalMatchReviews, readerClasses, readingSessions, users } from "../drizzle/schema";
import { getDb } from "./db";
import { ensureTestSchool } from "./tenancyFixture";
import { addLearnerToTeacherClass, approveIrishVariantForClass, confirmProvisionalMatchReview, createAdditionalClassForTeacher, createProvisionalMatchReviews, getLearnerReadingSettings, getTeacherClassVariationReview, getTeacherIrishVariantExport, listEducatorApprovedIrishVariants, listTeacherProvisionalMatches, saveClassLanguageSupportDefault, saveReadingSession } from "./readerDb";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const compactId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();

describe.skipIf(!databaseAvailable)("Irish English educator approval workflow", () => {
  it("inherits the class profile, records an approved variant, and confirms a provisional reading match", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database is unavailable for integration coverage.");
    const key = `ia-${compactId().toLowerCase()}`;
    let teacherId: number | undefined;
    let childUserId: number | undefined;
    let childProfileId: number | undefined;
    let classId: number | undefined;
    try {
      await db.insert(users).values({ schoolId: await ensureTestSchool(`school-${key}`), openId: `${key}-t`, name: "Irish Approval Teacher", loginMethod: "vitest", role: "teacher" });
      const [teacher] = await db.select().from(users).where(eq(users.openId, `${key}-t`)).limit(1);
      if (!teacher) throw new Error("Could not create the teacher test account.");
      teacherId = teacher.id;
      const readerClass = await createAdditionalClassForTeacher(teacher.id, "Irish Approval Owls", `T${compactId()}`);
      classId = readerClass.id;
      await saveClassLanguageSupportDefault(teacher.id, readerClass.id, "IRISH_ENGLISH_SUPPORT");
      const learner = await addLearnerToTeacherClass({ teacherUserId: teacher.id, classId: readerClass.id, displayName: "Irish Approval Learner", bookBand: "Level 3 · Sky Blue", familyCode: `F${compactId()}` });
      childUserId = learner.profile.userId;
      childProfileId = learner.profile.id;
      expect((await getLearnerReadingSettings(learner.profile.id)).languageSupport).toBe("IRISH_ENGLISH_SUPPORT");

      const approved = await approveIrishVariantForClass({ teacherUserId: teacher.id, classId: readerClass.id, expectedWord: "three", recognisedVariant: "tree" });
      expect(await listEducatorApprovedIrishVariants(teacher.id, readerClass.id)).toEqual(expect.arrayContaining([expect.objectContaining({ id: approved.id, expectedWord: "three", recognisedVariant: "tree" })]));
      expect(await getTeacherIrishVariantExport(teacher.id, readerClass.id)).toEqual(expect.objectContaining({ className: "Irish Approval Owls", variants: [expect.objectContaining({ expectedWord: "three", recognisedVariant: "tree" })] }));
      const session = await saveReadingSession({ childProfileId: learner.profile.id, storyTitle: "Irish reading check", transcript: "tree", accuracy: 100, wordsCorrectPerMinute: 90, durationSeconds: 60, languageSupport: "IRISH_ENGLISH_SUPPORT", practiceWords: [], interventions: [] });
      const [review] = await createProvisionalMatchReviews({ sessionId: session.id, childProfileId: learner.profile.id, classId: readerClass.id, matches: [{ expectedWord: "three", recognisedWord: "tree", source: "educator_approved" }] });
      expect(await listTeacherProvisionalMatches(teacher.id)).toEqual(expect.arrayContaining([expect.objectContaining({ id: review.id, status: "pending", expectedWord: "three" })]));
      expect(await listTeacherProvisionalMatches(teacher.id, { classId: readerClass.id, childProfileId: learner.profile.id, startDate: new Date().toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10) })).toEqual(expect.arrayContaining([expect.objectContaining({ id: review.id })]));
      expect(await getTeacherClassVariationReview(teacher.id, readerClass.id)).toEqual(expect.objectContaining({ readerClass: expect.objectContaining({ id: readerClass.id }), variants: expect.arrayContaining([expect.objectContaining({ expectedWord: "three" })]), reviews: expect.arrayContaining([expect.objectContaining({ expectedWord: "three", status: "pending" })]) }));
      expect((await confirmProvisionalMatchReview(teacher.id, review.id)).reviewId).toBe(review.id);
      expect(await listTeacherProvisionalMatches(teacher.id)).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: review.id })]));
    } finally {
      if (classId) await db.delete(provisionalMatchReviews).where(eq(provisionalMatchReviews.classId, classId));
      if (classId) await db.delete(educatorApprovedIrishVariants).where(eq(educatorApprovedIrishVariants.classId, classId));
      if (childProfileId) await db.delete(readingSessions).where(eq(readingSessions.childProfileId, childProfileId));
      if (childProfileId) await db.delete(learnerReadingSettings).where(eq(learnerReadingSettings.childProfileId, childProfileId));
      if (classId) await db.delete(classEnrollments).where(eq(classEnrollments.classId, classId));
      if (childProfileId) await db.delete(childProfiles).where(eq(childProfiles.id, childProfileId));
      if (classId) await db.delete(readerClasses).where(eq(readerClasses.id, classId));
      if (childUserId) await db.delete(users).where(eq(users.id, childUserId));
      if (teacherId) await db.delete(users).where(eq(users.id, teacherId));
    }
  });
});
