import { describe, expect, it } from "vitest";
import { createReadingReport } from "./readerReports";
import { scoreQuiz } from "./quizPolicy";

const sessions = [{ id: 1, schoolId: 1, childProfileId: 5, materialId: null, storyTitle: "The Moonlight Kite", transcript: "Mina found a kite.", accuracy: 91, wordsCorrectPerMinute: 108, durationSeconds: 75, audioStorageKey: null, completed: 1, practiceWords: ["glimmered"], interventions: [], assessmentMode: "ASSISTED_PRACTICE" as const, languageSupport: "STANDARD_ENGLISH" as const, wordStates: [], wordTimings: null, createdAt: new Date() }];

describe("role-specific reading reports", () => {
  it("creates a positive child celebration without diagnostic language", () => {
    const report = createReadingReport({ audience: "child", childName: "Amina", bookBand: "Level 3", sessions });
    expect(report.filename).toBe("amina-reading-celebration.md");
    expect(report.content).toContain("Every try grows your reader brain");
    expect(report.content).not.toContain("diagnosis");
  });

  it("creates a family-friendly parent progress summary", () => {
    const report = createReadingReport({ audience: "parent", childName: "Amina", bookBand: "Level 3", sessions });
    expect(report.filename).toBe("amina-parent-reading-summary.md");
    expect(report.content).toContain("Try this together");
  });

  it("creates a teacher running record with session evidence", () => {
    const report = createReadingReport({ audience: "teacher", childName: "Amina", bookBand: "Level 3", sessions });
    expect(report.filename).toBe("amina-teacher-running-record.md");
    expect(report.content).toContain("The Moonlight Kite");
  });
});

describe("comprehension quiz scoring", () => {
  it("scores answers against the teacher-approved answer key on the server", () => {
    expect(scoreQuiz([{ answer: "The garden" }, { answer: "A kite" }], [{ questionIndex: 0, selectedAnswer: "The garden" }, { questionIndex: 1, selectedAnswer: "A boat" }])).toEqual([{ questionIndex: 0, selectedAnswer: "The garden", correct: true }, { questionIndex: 1, selectedAnswer: "A boat", correct: false }]);
  });
});
