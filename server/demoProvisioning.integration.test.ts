import { describe, expect, it } from "vitest";
import { getChildProgress, getParentDashboard, getTeacherDashboard, provisionLocalDemoCohort, seedDemoCohort } from "./readerDb";
import { scopeForUser } from "./tenantScope";

const databaseAvailable = Boolean(process.env.DATABASE_URL);

describe.skipIf(!databaseAvailable)("demo provisioning", () => {
  it("provisions the local demo cohort into the seeded school and serves every dashboard", async () => {
    const cohort = await provisionLocalDemoCohort();
    expect(cohort.teacher.schoolId).not.toBeNull();
    const scope = scopeForUser(cohort.teacher);

    const dashboard = await getTeacherDashboard(scope, cohort.teacher.id);
    expect(dashboard.classes.length).toBeGreaterThanOrEqual(1);
    expect(dashboard.pupils.map(pupil => pupil.childProfileId)).toContain(cohort.profile.id);
    expect((await getChildProgress(scope, cohort.profile.id)).sessions.length).toBeGreaterThan(0);
    expect((await getParentDashboard(scope, cohort.parent.id)).children.length).toBeGreaterThan(0);

    // Sign-in re-provisions, so it has to be idempotent.
    const again = await provisionLocalDemoCohort();
    expect(again.profile.id).toBe(cohort.profile.id);
  });

  it("seeds the admin demo cohort alongside an already-provisioned local demo", async () => {
    // Regression: both seeders once used the familyCode FAMILY-AMINA, and childProfiles.familyCode
    // is unique, so running the admin seeder after the local demo updated the local learner's row
    // rather than creating one and then failed to find it.
    const cohort = await provisionLocalDemoCohort();
    const scope = scopeForUser(cohort.teacher);
    const seeded = await seedDemoCohort(scope, cohort.teacher.id);
    expect(seeded.childProfiles.map(profile => profile.displayName)).toEqual(["Amina Roe", "Leo Davies"]);
    expect(new Set(seeded.childProfiles.map(profile => profile.id)).has(cohort.profile.id)).toBe(false);
  });
});
