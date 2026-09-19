import { describe, expect, it } from "vitest";
import { createBrandedPdfReport } from "./pdfReports";

const sessions = [{ id: "01K5H2VQ0M0000000000000001", schoolId: 1, childProfileId: 2, materialId: null, storyTitle: "The Moonlight Kite", transcript: "Mina found a kite.", accuracy: 91, wordsCorrectPerMinute: 108, durationSeconds: 72, audioStorageKey: null, completed: 1, practiceWords: ["glimmered"], interventions: [], assessmentMode: "ASSISTED_PRACTICE" as const, languageSupport: "STANDARD_ENGLISH" as const, wordStates: [], wordTimings: null, capturedAt: null, capturedAtSource: "server" as const, createdAt: new Date() }];

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
