import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { childProfiles, classEnrollments, familyLinks, homePracticeChecklists, learnerReadingSettings, materialAssignments, parentReminders, readerClasses, schools, teacherTermPresets, users, weeklyReadingGoals } from "../drizzle/schema";
import { getDb } from "./db";
import { ensureTestSchool } from "./tenancyFixture";
import { scopeForUser, type TenantScope } from "./tenantScope";
import { MissingTenantScopeError, addLearnerToTeacherClass, addLearnersToTeacherClass, approveReadingMaterial, assignReadingMaterialToClasses, createAdditionalClassForTeacher, createReadingMaterial, currentWeekStart, deleteTeacherTermPreset, getLearnerReadingSettings, getTeacherDashboard, listParentReminders, listTeacherTermPresets, makeReadingMaterialAssignable, markAllParentRemindersRead, markParentReminderRead, saveHomePracticeChecklist, saveLearnerReadingSettings, saveTeacherTermPreset, saveWeeklyReadingGoal } from "./readerDb";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const testKey = `rlt-${crypto.randomUUID()}`;
const createdUserIds: number[] = [];
const createdClassIds: number[] = [];
const createdParentIds: number[] = [];
const testSchoolId = async () => ensureTestSchool(`school-${testKey}`);

async function insertUser(openId: string, name: string, role: "teacher" | "child" | "parent") {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable for integration coverage.");
  await db.insert(users).values({ schoolId: await testSchoolId(), openId, name, loginMethod: "vitest", role });
  const [user] = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  if (!user) throw new Error("Could not create test account.");
  createdUserIds.push(user.id);
  if (role === "parent") createdParentIds.push(user.id);
  return user;
}

afterEach(async () => {
  if (!databaseAvailable) return;
  const db = await getDb();
  if (!db) return;
  for (const parentId of createdParentIds) {
    await db.delete(parentReminders).where(eq(parentReminders.parentUserId, parentId));
    await db.delete(homePracticeChecklists).where(eq(homePracticeChecklists.parentUserId, parentId));
    await db.delete(familyLinks).where(eq(familyLinks.parentUserId, parentId));
  }
  for (const userId of createdUserIds) await db.delete(teacherTermPresets).where(eq(teacherTermPresets.teacherUserId, userId));
  for (const userId of createdUserIds) await db.delete(weeklyReadingGoals).where(eq(weeklyReadingGoals.teacherUserId, userId));
  for (const classId of createdClassIds) await db.delete(classEnrollments).where(eq(classEnrollments.classId, classId));
  for (const userId of createdUserIds) {
    await db.delete(learnerReadingSettings).where(eq(learnerReadingSettings.childProfileId, userId));
  }
  for (const userId of createdUserIds) {
    const [profile] = await db.select().from(childProfiles).where(eq(childProfiles.userId, userId)).limit(1);
    if (profile) await db.delete(learnerReadingSettings).where(eq(learnerReadingSettings.childProfileId, profile.id));
    if (profile) await db.delete(childProfiles).where(eq(childProfiles.id, profile.id));
  }
  for (const classId of createdClassIds) await db.delete(readerClasses).where(eq(readerClasses.id, classId));
  for (const userId of createdUserIds) await db.delete(users).where(eq(users.id, userId));
  createdUserIds.length = 0;
  createdClassIds.length = 0;
  createdParentIds.length = 0;
});

describe.skipIf(!databaseAvailable)("Reader Leader persisted class and reminder workflows", () => {
  it("creates a teacher class, adds a learner, and returns it in the authorised roster dashboard", async () => {
    const teacher = await insertUser(`${testKey}-teacher`, "Test Teacher", "teacher");
    const readerClass = await createAdditionalClassForTeacher(scopeForUser(teacher), teacher.id, "Test Owls", `T${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`);
    createdClassIds.push(readerClass.id);
    const learner = await addLearnerToTeacherClass(scopeForUser(teacher), { teacherUserId: teacher.id, classId: readerClass.id, displayName: "Test Learner", bookBand: "Level 4 · Gold", familyCode: `F${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}` });
    createdUserIds.push(learner.profile.userId);

    const dashboard = await getTeacherDashboard(scopeForUser(teacher), teacher.id);
    expect(dashboard.classes).toEqual(expect.arrayContaining([expect.objectContaining({ id: readerClass.id, name: "Test Owls", pupilCount: 1 })]));
    expect(dashboard.pupils).toEqual(expect.arrayContaining([expect.objectContaining({ childProfileId: learner.profile.id, classId: readerClass.id, displayName: "Test Learner", bookBand: "Level 4 · Gold" })]));
  });

  it("adds a valid bulk roster while returning duplicate-row feedback", async () => {
    const teacher = await insertUser(`${testKey}-bulk-teacher`, "Bulk Teacher", "teacher");
    const readerClass = await createAdditionalClassForTeacher(scopeForUser(teacher), teacher.id, "Bulk Owls", `T${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`);
    createdClassIds.push(readerClass.id);
    const existing = await addLearnerToTeacherClass(scopeForUser(teacher), { teacherUserId: teacher.id, classId: readerClass.id, displayName: "Casey Doe", bookBand: "Level 3 · Sky Blue", familyCode: `F${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}` });
    createdUserIds.push(existing.profile.userId);
    const result = await addLearnersToTeacherClass(scopeForUser(teacher), { teacherUserId: teacher.id, classId: readerClass.id, rows: [{ row: 2, displayName: "Alex Turner", bookBand: "Level 3 · Sky Blue" }, { row: 3, displayName: "Alex Turner", bookBand: "Level 4 · Gold" }, { row: 4, displayName: "Casey Doe", bookBand: "Level 3 · Sky Blue" }, { row: 5, displayName: "Robin Shah", bookBand: "Level 4 · Gold" }], createFamilyCode: () => `F${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}` });
    const db = await getDb();
    if (!db) throw new Error("Database is unavailable for integration coverage.");
    for (const learner of result.created) {
      const [profile] = await db.select().from(childProfiles).where(eq(childProfiles.id, learner.childProfileId)).limit(1);
      if (profile) createdUserIds.push(profile.userId);
    }
    expect(result.created.map(item => item.displayName)).toEqual(["Alex Turner", "Robin Shah"]);
    expect(result.errors).toEqual([{ row: 3, message: "This learner name appears more than once in the import." }, { row: 4, message: "This learner is already in the selected class roster." }]);
    expect((await getTeacherDashboard(scopeForUser(teacher), teacher.id)).classes.find(item => item.id === readerClass.id)?.pupilCount).toBe(3);
  });

  it("persists material metadata and assigns an approved text only to selected teacher classes", async () => {
    const teacher = await insertUser(`${testKey}-material-teacher`, "Material Teacher", "teacher");
    const firstClass = await createAdditionalClassForTeacher(scopeForUser(teacher), teacher.id, "Selected Owls", `T${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`);
    const secondClass = await createAdditionalClassForTeacher(scopeForUser(teacher), teacher.id, "Other Owls", `T${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`);
    createdClassIds.push(firstClass.id, secondClass.id);
    const created = await createReadingMaterial(scopeForUser(teacher), { teacherUserId: teacher.id, title: "The Careful Fox", author: "Material Teacher", rightsSource: "original", interestAge: "8–10", genre: "Adventure", readingLevel: "Level 3 · Sky Blue", sourceText: "A careful fox followed a winding woodland path and helped a small bird carry twigs safely home before the evening rain arrived." });

    expect(created.details).toMatchObject({ author: "Material Teacher", rightsSource: "original", interestAge: "8–10", genre: "Adventure", lifecycleStatus: "draft" });
    await expect(assignReadingMaterialToClasses(scopeForUser(teacher), teacher.id, created.id, [firstClass.id])).rejects.toThrow("Make this reading material assignable");
    expect((await approveReadingMaterial(scopeForUser(teacher), teacher.id, created.id)).lifecycleStatus).toBe("teacher_approved");
    expect((await makeReadingMaterialAssignable(scopeForUser(teacher), teacher.id, created.id)).lifecycleStatus).toBe("assignable");
    const result = await assignReadingMaterialToClasses(scopeForUser(teacher), teacher.id, created.id, [firstClass.id]);
    expect(result.assignedClasses.map(item => item.id)).toEqual([firstClass.id]);

    const db = await getDb();
    if (!db) throw new Error("Database is unavailable for integration coverage.");
    const assignments = await db.select().from(materialAssignments).where(eq(materialAssignments.materialId, created.id));
    expect(assignments.map(item => item.classId)).toEqual([firstClass.id]);
  });

  it("saves, lists, and removes a teacher-owned named term preset", async () => {
    const teacher = await insertUser(`${testKey}-term-teacher`, "Term Teacher", "teacher");
    const saved = await saveTeacherTermPreset(scopeForUser(teacher), teacher.id, { name: "Autumn 2026", startDate: "2026-09-01", endDate: "2026-12-18" });
    expect(await listTeacherTermPresets(scopeForUser(teacher), teacher.id)).toEqual(expect.arrayContaining([expect.objectContaining({ id: saved.id, name: "Autumn 2026", startDate: "2026-09-01", endDate: "2026-12-18" })]));
    expect(await deleteTeacherTermPreset(scopeForUser(teacher), teacher.id, saved.id)).toEqual({ success: true });
    expect(await listTeacherTermPresets(scopeForUser(teacher), teacher.id)).toHaveLength(0);
  });

  it("assigns an individual current-week reading goal and includes it in the teacher learner summary", async () => {
    const teacher = await insertUser(`${testKey}-goal-teacher`, "Goal Teacher", "teacher");
    const readerClass = await createAdditionalClassForTeacher(scopeForUser(teacher), teacher.id, "Goal Owls", `T${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`);
    createdClassIds.push(readerClass.id);
    const learner = await addLearnerToTeacherClass(scopeForUser(teacher), { teacherUserId: teacher.id, classId: readerClass.id, displayName: "Goal Learner", bookBand: "Level 4 · Gold", familyCode: `F${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}` });
    createdUserIds.push(learner.profile.userId);
    // The dashboard reports the goal for the week it is read in, so anchor the goal to the
    // current week. A fixed date only matched during the week of 2026-09-07.
    const weekStart = currentWeekStart();
    const saved = await saveWeeklyReadingGoal(scopeForUser(teacher), teacher.id, { childProfileId: learner.profile.id, weekStart, targetMinutes: 30, targetSessions: 4, note: "Take your time with new words." });
    expect(saved).toMatchObject({ childProfileId: learner.profile.id, weekStart, targetMinutes: 30, targetSessions: 4 });
    expect((await getTeacherDashboard(scopeForUser(teacher), teacher.id)).pupils).toEqual(expect.arrayContaining([expect.objectContaining({ childProfileId: learner.profile.id, weeklyGoal: expect.objectContaining({ targetMinutes: 30, targetSessions: 4 }) })]));
  });

  it("persists an Irish English support profile as a teacher-controlled learner plan", async () => {
    const teacher = await insertUser(`${testKey}-irish-teacher`, "Irish Support Teacher", "teacher");
    const readerClass = await createAdditionalClassForTeacher(scopeForUser(teacher), teacher.id, "Irish Support Owls", `T${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`);
    createdClassIds.push(readerClass.id);
    const learner = await addLearnerToTeacherClass(scopeForUser(teacher), { teacherUserId: teacher.id, classId: readerClass.id, displayName: "Irish Support Learner", bookBand: "Level 3 · Sky Blue", familyCode: `F${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}` });
    createdUserIds.push(learner.profile.userId);
    await saveLearnerReadingSettings(scopeForUser(teacher), learner.profile.id, { defaultReadingMode: "GUIDED_PRACTICE", targetWcpm: 105, languageSupport: "IRISH_ENGLISH_SUPPORT" });

    expect(await getLearnerReadingSettings(scopeForUser(teacher), learner.profile.id)).toMatchObject({ defaultReadingMode: "GUIDED_PRACTICE", targetWcpm: 105, languageSupport: "IRISH_ENGLISH_SUPPORT" });
    expect((await getTeacherDashboard(scopeForUser(teacher), teacher.id)).pupils).toEqual(expect.arrayContaining([expect.objectContaining({ childProfileId: learner.profile.id, settings: expect.objectContaining({ languageSupport: "IRISH_ENGLISH_SUPPORT" }) })]));
  });

  it("creates one same-day parent reminder, records its read state, and does not duplicate it after re-completion", async () => {
    const parent = await insertUser(`${testKey}-parent`, "Test Parent", "parent");
    const child = await insertUser(`${testKey}-child`, "Test Child", "child");
    const db = await getDb();
    if (!db) throw new Error("Database is unavailable for integration coverage.");
    await db.insert(childProfiles).values({ schoolId: await testSchoolId(), userId: child.id, displayName: "Test Child", bookBand: "Level 3 · Sky Blue", familyCode: `F${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}` });
    const [profile] = await db.select().from(childProfiles).where(eq(childProfiles.userId, child.id)).limit(1);
    if (!profile) throw new Error("Could not create test learner profile.");
    await db.insert(familyLinks).values({ schoolId: await testSchoolId(), parentUserId: parent.id, childProfileId: profile.id });

    const firstCompletion = await saveHomePracticeChecklist(scopeForUser(parent), parent.id, profile.id, [true, true, true], new Date("2026-09-03T12:00:00.000Z"));
    expect(firstCompletion.reminderCreated).toBe(true);
    const [firstReminder] = await listParentReminders(scopeForUser(parent), parent.id);
    expect(firstReminder).toMatchObject({ childProfileId: profile.id, status: "unread", title: "Home practice complete" });

    expect(await markAllParentRemindersRead(scopeForUser(parent), parent.id)).toEqual({ markedRead: 1 });
    expect((await listParentReminders(scopeForUser(parent), parent.id))[0]?.status).toBe("read");
    await markParentReminderRead(scopeForUser(parent), parent.id, firstReminder.id);
    expect((await listParentReminders(scopeForUser(parent), parent.id))[0]?.status).toBe("read");
    await saveHomePracticeChecklist(scopeForUser(parent), parent.id, profile.id, [true, true, false], new Date("2026-09-03T12:05:00.000Z"));
    const repeatedCompletion = await saveHomePracticeChecklist(scopeForUser(parent), parent.id, profile.id, [true, true, true], new Date("2026-09-03T12:06:00.000Z"));
    expect(repeatedCompletion.reminderCreated).toBe(false);
    expect(await listParentReminders(scopeForUser(parent), parent.id)).toHaveLength(1);

    const secondChild = await insertUser(`${testKey}-child-two`, "Second Test Child", "child");
    await db.insert(childProfiles).values({ schoolId: await testSchoolId(), userId: secondChild.id, displayName: "Second Test Child", bookBand: "Level 4 · Gold", familyCode: `F${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}` });
    const [secondProfile] = await db.select().from(childProfiles).where(eq(childProfiles.userId, secondChild.id)).limit(1);
    if (!secondProfile) throw new Error("Could not create second test learner profile.");
    await db.insert(familyLinks).values({ schoolId: await testSchoolId(), parentUserId: parent.id, childProfileId: secondProfile.id });
    await saveHomePracticeChecklist(scopeForUser(parent), parent.id, secondProfile.id, [true, true, true], new Date("2026-09-04T12:00:00.000Z"));
    expect(await listParentReminders(scopeForUser(parent), parent.id, { childProfileId: secondProfile.id })).toEqual([expect.objectContaining({ childProfileId: secondProfile.id })]);
    const notificationDate = new Date().toISOString().slice(0, 10);
    expect(await listParentReminders(scopeForUser(parent), parent.id, { startDate: notificationDate, endDate: notificationDate })).toEqual(expect.arrayContaining([expect.objectContaining({ childProfileId: secondProfile.id })]));
    expect(await listParentReminders(scopeForUser(parent), parent.id, { startDate: "2099-01-01", endDate: "2099-01-01" })).toEqual([]);
  });
});

describe.skipIf(!databaseAvailable)("School tenancy", () => {
  it("refuses to create school data for an account with no school", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database is unavailable for integration coverage.");
    // A break-glass support engineer has no standing school membership, so there is no scope
    // to write into. The account exists and is a teacher; only the school is absent.
    const openId = `${testKey}-support-no-school`;
    await db.insert(users).values({ schoolId: null, openId, name: "Support Engineer", loginMethod: "vitest", role: "teacher" });
    const [support] = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
    if (!support) throw new Error("Could not create the school-less test account.");
    createdUserIds.push(support.id);
    expect(support.schoolId).toBeNull();

    // The boundary refuses to derive a scope for the account at all...
    expect(() => scopeForUser(support)).toThrow(MissingTenantScopeError);
    // ...and the data layer refuses independently, so bypassing the boundary gains nothing.
    const noSchool = { schoolId: null } as unknown as TenantScope;
    await expect(createAdditionalClassForTeacher(noSchool, support.id, "No School Owls", `T${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`))
      .rejects.toBeInstanceOf(MissingTenantScopeError);
    await expect(saveTeacherTermPreset(noSchool, support.id, { name: "No School Term", startDate: "2026-09-01", endDate: "2026-12-18" }))
      .rejects.toBeInstanceOf(MissingTenantScopeError);
  });

  it("keeps one school's rows out of another school's reads", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database is unavailable for integration coverage.");
    const [schoolA, schoolB] = [await ensureTestSchool(`iso-a-${testKey}`), await ensureTestSchool(`iso-b-${testKey}`)];
    expect(schoolA).not.toBe(schoolB);

    const makeTeacher = async (suffix: string, schoolId: number) => {
      const openId = `${testKey}-${suffix}`;
      await db.insert(users).values({ schoolId, openId, name: `Teacher ${suffix}`, loginMethod: "vitest", role: "teacher" });
      const [teacher] = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
      if (!teacher) throw new Error("Could not create the tenancy test teacher.");
      createdUserIds.push(teacher.id);
      return teacher;
    };
    const teacherA = await makeTeacher("iso-teacher-a", schoolA);
    const teacherB = await makeTeacher("iso-teacher-b", schoolB);

    const classA = await createAdditionalClassForTeacher(scopeForUser(teacherA), teacherA.id, "School A Owls", `T${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`);
    const classB = await createAdditionalClassForTeacher(scopeForUser(teacherB), teacherB.id, "School B Owls", `T${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`);
    createdClassIds.push(classA.id, classB.id);
    expect(classA.schoolId).toBe(schoolA);
    expect(classB.schoolId).toBe(schoolB);

    const learnerA = await addLearnerToTeacherClass(scopeForUser(teacherA), { teacherUserId: teacherA.id, classId: classA.id, displayName: "Learner A", bookBand: "Level 3 · Sky Blue", familyCode: `F${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}` });
    const learnerB = await addLearnerToTeacherClass(scopeForUser(teacherB), { teacherUserId: teacherB.id, classId: classB.id, displayName: "Learner B", bookBand: "Level 3 · Sky Blue", familyCode: `F${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}` });
    createdUserIds.push(learnerA.profile.userId, learnerB.profile.userId);

    // A learner added under school B carries school B, and school A's dashboard never sees them.
    expect(learnerA.profile.schoolId).toBe(schoolA);
    expect(learnerB.profile.schoolId).toBe(schoolB);
    const dashboardA = await getTeacherDashboard(scopeForUser(teacherA), teacherA.id);
    const dashboardB = await getTeacherDashboard(scopeForUser(teacherB), teacherB.id);
    expect(dashboardA.pupils.map(pupil => pupil.childProfileId)).toContain(learnerA.profile.id);
    expect(dashboardA.pupils.map(pupil => pupil.childProfileId)).not.toContain(learnerB.profile.id);
    expect(dashboardB.pupils.map(pupil => pupil.childProfileId)).not.toContain(learnerA.profile.id);

    // Erasing a school is one delete, and it takes that school's rows and only that school's.
    await db.delete(schools).where(eq(schools.id, schoolB));
    expect(await db.select().from(readerClasses).where(eq(readerClasses.id, classB.id))).toHaveLength(0);
    expect(await db.select().from(childProfiles).where(eq(childProfiles.id, learnerB.profile.id))).toHaveLength(0);
    expect(await db.select().from(readerClasses).where(eq(readerClasses.id, classA.id))).toHaveLength(1);
    expect(await db.select().from(childProfiles).where(eq(childProfiles.id, learnerA.profile.id))).toHaveLength(1);
  });

  it("does not leak a joined row that belongs to another school", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database is unavailable for integration coverage.");
    const [schoolA, schoolB] = [await ensureTestSchool(`join-a-${testKey}`), await ensureTestSchool(`join-b-${testKey}`)];

    const makeUser = async (suffix: string, schoolId: number, role: "teacher" | "child") => {
      const openId = `${testKey}-${suffix}`;
      await db.insert(users).values({ schoolId, openId, name: suffix, loginMethod: "vitest", role });
      const [user] = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
      if (!user) throw new Error("Could not create the join test account.");
      createdUserIds.push(user.id);
      return user;
    };
    const teacherA = await makeUser("join-teacher-a", schoolA, "teacher");
    const classA = await createAdditionalClassForTeacher(scopeForUser(teacherA), teacherA.id, "Join Owls", `T${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`);
    createdClassIds.push(classA.id);

    // A learner that belongs to school B, enrolled into school A's class. Per-table foreign keys
    // permit this shape, so the guard — not the schema — is what has to stop it being read.
    const childB = await makeUser("join-child-b", schoolB, "child");
    await db.insert(childProfiles).values({ schoolId: schoolB, userId: childB.id, displayName: "Other School Learner", bookBand: "Level 3 · Sky Blue", familyCode: `F${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}` });
    const [profileB] = await db.select().from(childProfiles).where(eq(childProfiles.userId, childB.id)).limit(1);
    if (!profileB) throw new Error("Could not create the cross-school learner profile.");
    await db.insert(classEnrollments).values({ schoolId: schoolA, classId: classA.id, childProfileId: profileB.id });

    // An unguarded join would surface the other school's learner through the enrolment.
    const leaked = await db.select({ displayName: childProfiles.displayName })
      .from(classEnrollments)
      .innerJoin(childProfiles, eq(classEnrollments.childProfileId, childProfiles.id))
      .where(eq(classEnrollments.classId, classA.id));
    expect(leaked.map(row => row.displayName)).toContain("Other School Learner");

    // The guarded dashboard join does not.
    const dashboard = await getTeacherDashboard(scopeForUser(teacherA), teacherA.id);
    expect(dashboard.pupils.map(pupil => pupil.displayName)).not.toContain("Other School Learner");
    expect(dashboard.pupils.map(pupil => pupil.childProfileId)).not.toContain(profileB.id);
  });

});
