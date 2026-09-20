import { describe, expect, it } from "vitest";
import {
  audienceForRole,
  progressForAudience,
  readingResultForAudience,
  seesAccuracy,
  withoutSessionAccuracy,
  withoutSummaryAccuracy,
} from "./accuracyAudience";

const progress = {
  profile: { displayName: "Test Reader" },
  sessions: [
    { id: "A", storyTitle: "One", accuracy: 91, wordsCorrectPerMinute: 102, settledWordsCorrectPerMinute: 97 },
    { id: "B", storyTitle: "Two", accuracy: 64, wordsCorrectPerMinute: 88, settledWordsCorrectPerMinute: null },
  ],
  summary: { sessionsCompleted: 2, averageAccuracy: 78, averageWcpm: 95 },
};

const result = {
  session: { id: "A", storyTitle: "One", accuracy: 91, wordsCorrectPerMinute: 102 },
  analysis: { accuracy: 91, firstPassAccuracy: 84, pace: 102, firstPassWcpm: 96, correctWords: 38 },
};

describe("who sees accuracy", () => {
  it("is the teacher, and only the teacher", () => {
    expect(seesAccuracy("teacher")).toBe(true);
    expect(seesAccuracy("child")).toBe(false);
    expect(seesAccuracy("parent")).toBe(false);
  });

  it("maps an account role to the audience whose surfaces it sees", () => {
    expect(audienceForRole("teacher")).toBe("teacher");
    expect(audienceForRole("admin")).toBe("teacher");
    expect(audienceForRole("parent")).toBe("parent");
    expect(audienceForRole("child")).toBe("child");
  });

  it("treats a role it does not recognise as a child, not as a teacher", () => {
    // The narrowest view is the safe default. A role added later, or a null from a broken
    // session, must not fall through into the one audience that sees the figure.
    expect(audienceForRole("governor")).toBe("child");
    expect(audienceForRole(undefined)).toBe("child");
    expect(audienceForRole(null)).toBe("child");
    expect(audienceForRole("")).toBe("child");
  });
});

describe("removing the field rather than hiding it", () => {
  it("drops accuracy from a session and leaves everything else alone", () => {
    const session = withoutSessionAccuracy(progress.sessions[0]);
    expect("accuracy" in session).toBe(false);
    expect(session).toEqual({ id: "A", storyTitle: "One", wordsCorrectPerMinute: 102, settledWordsCorrectPerMinute: 97 });
  });

  it("drops the average from a summary and leaves everything else alone", () => {
    const summary = withoutSummaryAccuracy(progress.summary);
    expect("averageAccuracy" in summary).toBe(false);
    expect(summary).toEqual({ sessionsCompleted: 2, averageWcpm: 95 });
  });

  it("does not mutate what it was given", () => {
    withoutSessionAccuracy(progress.sessions[0]);
    withoutSummaryAccuracy(progress.summary);
    progressForAudience(progress, "child");
    expect(progress.sessions[0].accuracy).toBe(91);
    expect(progress.summary.averageAccuracy).toBe(78);
  });
});

describe("a child-progress payload", () => {
  it("reaches a teacher whole", () => {
    expect(progressForAudience(progress, "teacher")).toBe(progress);
  });

  for (const audience of ["child", "parent"] as const) {
    it(`carries no accuracy anywhere for a ${audience}`, () => {
      const payload = progressForAudience(progress, audience);
      expect(JSON.stringify(payload)).not.toMatch(/accuracy/i);
      // Named assertions too, so a renamed field cannot pass the string check by accident.
      expect(payload.sessions.every(session => !("accuracy" in session))).toBe(true);
      expect("averageAccuracy" in payload.summary).toBe(false);
    });

    it(`sees the settled pace and not the machine one as a ${audience}`, () => {
      const payload = progressForAudience(progress, audience);
      expect(payload.sessions.every(session => !("wordsCorrectPerMinute" in session))).toBe(true);
      expect(payload.sessions.map(session => (session as { settledWordsCorrectPerMinute: number | null }).settledWordsCorrectPerMinute))
        .toEqual([97, null]);
    });

    it(`keeps everything a ${audience} still needs`, () => {
      const payload = progressForAudience(progress, audience);
      expect(payload.profile).toEqual({ displayName: "Test Reader" });
      expect(payload.sessions.map(session => session.storyTitle)).toEqual(["One", "Two"]);
      expect(payload.summary.sessionsCompleted).toBe(2);
    });
  }
});

describe("the reply a child gets on finishing a reading", () => {
  it("reaches a teacher whole", () => {
    expect(readingResultForAudience(result, "teacher")).toBe(result);
  });

  it("carries neither the session accuracy nor either analysis accuracy", () => {
    const payload = readingResultForAudience(result, "child");
    expect(JSON.stringify(payload)).not.toMatch(/accuracy/i);
    expect("accuracy" in payload.session).toBe(false);
    expect("accuracy" in payload.analysis).toBe(false);
    expect("firstPassAccuracy" in payload.analysis).toBe(false);
  });

  it("also withholds the machine pace, which is that judgement in another unit", () => {
    const payload = readingResultForAudience(result, "child");
    expect("wordsCorrectPerMinute" in payload.session).toBe(false);
    expect("pace" in payload.analysis).toBe(false);
    expect("firstPassWcpm" in payload.analysis).toBe(false);
  });

  it("keeps what the report screen still needs", () => {
    const payload = readingResultForAudience(result, "child");
    expect(payload.session.id).toBe("A");
    expect(payload.session.storyTitle).toBe("One");
    expect(payload.analysis.correctWords).toBe(38);
  });

  it("does not mutate what it was given", () => {
    readingResultForAudience(result, "child");
    expect(result.session.accuracy).toBe(91);
    expect(result.analysis.firstPassAccuracy).toBe(84);
  });
});
