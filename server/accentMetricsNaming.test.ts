import { describe, expect, it } from "vitest";
import { computeFlagOverturnRate, getAccentFairnessSummary, measureCuratedContrast } from "./accentMetrics";

/**
 * The rename must not move a single number. These are the values the pre-rename functions
 * returned, recorded before the change and pinned here.
 */
const REVIEWED = [
  { interventions: [
    { word: "three", eventType: "dialect_variation", provisionalIrishEnglish: true, teacherDecision: "confirmed" },
    { word: "path", eventType: "dialect_variation", provisionalIrishEnglish: true, teacherDecision: "confirmed" },
    { word: "brought", eventType: "substitution", provisionalIrishEnglish: false, teacherDecision: "overridden" },
    { word: "month", eventType: "substitution", provisionalIrishEnglish: false, teacherDecision: "confirmed" },
    { word: "with", eventType: "dialect_variation", provisionalIrishEnglish: true, teacherDecision: "overridden" },
    { word: "ignored", eventType: "substitution", provisionalIrishEnglish: false },
  ] },
];

describe("metric rename is value-identical", () => {
  it("returns the same review-conditioned numbers computeLiveFairness returned", () => {
    // Recorded from computeLiveFairness before the rename:
    // {"totalReviewed":5,"falseCorrectionRatePct":33,"falseAcceptanceRatePct":50,
    //  "counts":{"true_accept":2,"false_accept":1,"true_reject":1,"false_correction":1}}
    expect(computeFlagOverturnRate(REVIEWED)).toEqual({
      totalReviewed: 5,
      flagOverturnRatePct: 33,
      missedErrorRatePct: 50,
      counts: { true_accept: 2, false_accept: 1, true_reject: 1, false_correction: 1 },
    });
  });

  it("returns the same curated contrast numbers, now carrying the n", () => {
    // Recorded before the rename: total 16, baseline flagged 16 (100%), readerLeader 0 (0%),
    // byFeature all 100% accepted.
    const curated = measureCuratedContrast();
    expect(curated.curatedPairs).toBe(16);
    expect(curated.baseline).toMatchObject({ flaggedOfCurated: 16, flaggedOfCuratedPct: 100 });
    expect(curated.readerLeader).toMatchObject({ flaggedOfCurated: 0, flaggedOfCuratedPct: 0 });
    expect(curated.byFeature).toEqual([
      { feature: "TH-stopping", accepted: 7, curatedPairs: 7, acceptedOfCuratedPct: 100 },
      { feature: "TH-stopping (voiced)", accepted: 4, curatedPairs: 4, acceptedOfCuratedPct: 100 },
      { feature: "G-dropping", accepted: 3, curatedPairs: 3, acceptedOfCuratedPct: 100 },
      { feature: "TH-cluster", accepted: 1, curatedPairs: 1, acceptedOfCuratedPct: 100 },
      { feature: "cot-caught merger", accepted: 1, curatedPairs: 1, acceptedOfCuratedPct: 100 },
    ]);
  });

  it("reports no field-performance rate under a false-correction name", () => {
    // The per-word false-correction rate needs readingWords (Stage 3). Nothing here may
    // claim it, and no curated figure may be presented without its n.
    const summary = JSON.stringify(getAccentFairnessSummary(REVIEWED));
    expect(summary).not.toMatch(/falseCorrectionRate/i);
    expect(summary).not.toMatch(/"live"/);
    expect(summary).toContain("curatedPairs");
    for (const label of [getAccentFairnessSummary(REVIEWED).curated.baseline.label, getAccentFairnessSummary(REVIEWED).curated.readerLeader.label]) {
      expect(label).toContain("curated set");
    }
  });
});
