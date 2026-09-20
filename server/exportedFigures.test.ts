import { describe, expect, it } from "vitest";
import { createReadingReport } from "./readerReports";
import { reportSnapshotLines } from "./pdfReports";
import { progressForAudience, readingResultForAudience } from "../shared/accuracyAudience";

/**
 * Every place a machine-derived figure could leave the system towards a child or a parent.
 *
 * The concern this answers is not a screen. An Article 15 subject access request returns the
 * child's personal data, and a machine-derived accuracy score held about that child is personal
 * data; if an export path dumps the row, the figure removed from two screens arrives in a
 * parent's inbox under a DPO's letterhead instead. There is no subject-access export in this
 * codebase today - searched for, and absent - so the paths below are the complete set of ways
 * a figure reaches either audience, and each one is asserted rather than reasoned about.
 *
 * When a subject-access export is built, it belongs in this sweep on the day it is written.
 *
 * Two exports are deliberately absent from the sweep because no child or parent can reach
 * them: reports.monthlyTrendCsv, which carries a class-level averaged story match, and
 * reports.monthlyTrend, which carries the same as JSON. Both are behind requireTeacher. Worth
 * remembering that a class of a single child makes that class average an individual figure.
 */
/**
 * The machine-derived keys, as JSON renders them. The opening quote matters: without it this
 * also matches `settledWordsCorrectPerMinute`, which is the teacher's own count and is meant
 * to be there - a scan that flagged the honest figure alongside the dishonest one would have
 * to be loosened until it caught neither.
 */
const MACHINE_FIGURE = /accurac|story match|"wordsCorrectPerMinute"|"firstPassWcpm"|"pace"/i;

const session = {
  id: "01K5H2VQ0M0000000000000001", schoolId: 1, childProfileId: 5, materialId: null,
  storyTitle: "The Moonlight Kite", transcript: "Mina found a kite.", accuracy: 91,
  wordsCorrectPerMinute: 108, durationSeconds: 75, audioStorageKey: null,
  audioStatus: "not_captured" as const, completed: 1, practiceWords: ["glimmered"],
  interventions: [], assessmentMode: "ASSISTED_PRACTICE" as const,
  languageSupport: "STANDARD_ENGLISH" as const, wordStates: [], wordTimings: null,
  capturedAt: null, capturedAtSource: "server" as const, createdAt: new Date(),
};

describe("what a child or a parent can be sent", () => {
  for (const audience of ["child", "parent"] as const) {
    it(`the markdown report carries no machine figure for a ${audience}`, () => {
      const report = createReadingReport({ audience, childName: "Amina", bookBand: "Level 3", sessions: [session] });
      expect(report.content).not.toMatch(/\b91\s*%/);
      expect(report.content).not.toMatch(/story match/i);
    });

    it(`the PDF snapshot carries no machine figure for a ${audience}`, () => {
      const lines = reportSnapshotLines({ audience, total: 4, averageAccuracy: 91, averageWcpm: 108, latestStoryTitle: "Kite" }).join("\n");
      expect(lines).not.toMatch(/story match/i);
      expect(lines).not.toContain("91");
    });

    it(`the progress payload carries no machine accuracy or machine pace for a ${audience}`, () => {
      const payload = progressForAudience({
        sessions: [{ ...session, settledWordsCorrectPerMinute: 97 }],
        summary: { sessionsCompleted: 1, averageAccuracy: 91, averageWcpm: 97 },
      }, audience);
      const text = JSON.stringify(payload);
      expect(text).not.toMatch(MACHINE_FIGURE);
      // and the settled figure, which is a teacher's own count, survives.
      expect(text).toContain("settledWordsCorrectPerMinute");
    });
  }

  it("the reply to a just-finished reading carries neither", () => {
    const payload = readingResultForAudience({
      session, analysis: { accuracy: 91, firstPassAccuracy: 84, pace: 108, firstPassWcpm: 96, correctWords: 38 },
    }, "child");
    expect(JSON.stringify(payload)).not.toMatch(MACHINE_FIGURE);
  });

  it("a teacher still gets all of it, or this sweep would be testing nothing", () => {
    // The scan must be capable of finding a figure, otherwise every assertion above is vacuous.
    const teacherReport = createReadingReport({ audience: "teacher", childName: "Amina", bookBand: "Level 3", sessions: [session] });
    expect(teacherReport.content).toMatch(/story match/i);
    expect(teacherReport.content).toContain("91%");
    expect(reportSnapshotLines({ audience: "teacher", total: 4, averageAccuracy: 91, averageWcpm: 108, latestStoryTitle: "Kite" }).join("\n")).toMatch(MACHINE_FIGURE);
    expect(JSON.stringify(progressForAudience({
      sessions: [session], summary: { averageAccuracy: 91 },
    }, "teacher"))).toMatch(MACHINE_FIGURE);
  });

});
