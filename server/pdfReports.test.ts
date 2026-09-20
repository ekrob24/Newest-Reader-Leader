import { describe, expect, it } from "vitest";
import { createBrandedPdfReport, reportSnapshotLines } from "./pdfReports";
import { ACCURACY_WITHHELD_NOTE } from "../shared/accuracyAudience";

const sessions = [{ id: "01K5H2VQ0M0000000000000001", schoolId: 1, childProfileId: 2, materialId: null, storyTitle: "The Moonlight Kite", transcript: "Mina found a kite.", accuracy: 91, wordsCorrectPerMinute: 108, durationSeconds: 72, audioStorageKey: null, audioStatus: "not_captured" as const, completed: 1, practiceWords: ["glimmered"], interventions: [], assessmentMode: "ASSISTED_PRACTICE" as const, languageSupport: "STANDARD_ENGLISH" as const, wordStates: [], wordTimings: null, capturedAt: null, capturedAtSource: "server" as const, createdAt: new Date() }];

describe("the reading snapshot on a PDF report", () => {
  const snapshot = (audience: "child" | "parent" | "teacher") =>
    reportSnapshotLines({ audience, total: 4, averageAccuracy: 91, averageWcpm: 108, latestStoryTitle: "The Moonlight Kite" });

  it("gives a teacher the story match", () => {
    expect(snapshot("teacher")).toContain("Average story match*: 91%");
    expect(snapshot("teacher")).not.toContain(ACCURACY_WITHHELD_NOTE);
  });

  for (const audience of ["child", "parent"] as const) {
    it(`gives a ${audience} no story match, and says why`, () => {
      const lines = snapshot(audience);
      expect(lines.join("\n")).not.toMatch(/story match/i);
      expect(lines.join("\n")).not.toContain("91");
      expect(lines).toContain(ACCURACY_WITHHELD_NOTE);
    });

    it(`still gives a ${audience} the sessions, the pace and the latest story`, () => {
      expect(snapshot(audience)).toEqual([
        "Saved Reading Sessions: 4",
        "Average WCPM*: 108",
        "Latest story: The Moonlight Kite",
        ACCURACY_WITHHELD_NOTE,
      ]);
    });
  }
});

describe("branded PDF report export", () => {
  it("creates a valid PDF document using the configured school brand", async () => {
    const report = await createBrandedPdfReport({ audience: "teacher", childName: "Amina Roe", bookBand: "Level 3", sessions, branding: { schoolName: "Oakfield Primary", accentColor: "#2563EB", footerLine: "Kind words help readers grow." }, comments: [{ sessionId: "01K5H2VQ0M0000000000000001", comment: "Amina used a smooth voice through the final paragraph.", createdAt: new Date() }] });
    expect(report.subarray(0, 4).toString("utf8")).toBe("%PDF");
    expect(report.length).toBeGreaterThan(800);
  });

  it("uses a safe default when a school accent is not a valid colour", async () => {
    const report = await createBrandedPdfReport({ audience: "child", childName: "Amina Roe", bookBand: "Level 3", sessions, branding: { schoolName: "Oakfield Primary", accentColor: "not-a-colour", footerLine: "Kind words help readers grow." }, comments: [] });
    expect(report.subarray(0, 4).toString("utf8")).toBe("%PDF");
  });
});
