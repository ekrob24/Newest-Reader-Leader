import { describe, expect, it } from "vitest";
import { accuracyFromWords, discardedErrorCount, isReviewComplete, settledCorrectWordCount } from "./readingWordScore";
import { settledWordsCorrectPerMinute } from "./readingPace";
import type { WordJudgement, WordProgress, WordResolution } from "../drizzle/schema";

const w = (judgement: WordJudgement, resolution: WordResolution, progress: WordProgress) => ({ judgement, resolution, progress });
const read = (n: number) => Array.from({ length: n }, () => w("correct", "auto", "correct"));
/** The shape the five-intervention cap produces: misread, but stored as correct. */
const discarded = w("correct", "auto", "incorrect");

describe("errors the cap threw away", () => {
  it("is none for a reading whose errors all survived", () => {
    expect(discardedErrorCount([...read(30), w("substitution", "unreviewed", "incorrect")])).toBe(0);
  });

  it("counts a word the analyser called incorrect and the record calls correct", () => {
    expect(discardedErrorCount([...read(20), discarded, discarded])).toBe(2);
  });

  it("does not count a self-correction, which was read correctly in the end", () => {
    // retried_correct is not `incorrect`, so it is not a discarded error.
    expect(discardedErrorCount([...read(10), w("correct", "auto", "retried_correct")])).toBe(0);
  });

  it("does not count an unread word", () => {
    expect(discardedErrorCount([...read(10), w("correct", "auto", "unread")])).toBe(0);
  });

  it("does not count a properly recorded error, whatever its resolution", () => {
    for (const resolution of ["unreviewed", "auto", "teacher_confirmed", "teacher_overridden"] as const) {
      expect(discardedErrorCount([w("omission", resolution, "incorrect")]), resolution).toBe(0);
    }
  });
});

describe("a reading that discarded errors publishes nothing", () => {
  // Nineteen of twenty misread; five kept, fourteen stored as correct. Before this guard the
  // teacher saw 75% after confirming all five, against a true 5%.
  const capped = [...read(1), ...Array.from({ length: 5 }, () => w("substitution", "teacher_confirmed", "incorrect")),
    ...Array.from({ length: 14 }, () => discarded)];

  it("has the discarded words, and they would otherwise read as correct", () => {
    expect(discardedErrorCount(capped)).toBe(14);
    expect(settledCorrectWordCount(capped)).toBe(15);
  });

  it("is never complete, even with every visible flag decided", () => {
    expect(capped.every(word => word.judgement !== "substitution" || word.resolution === "teacher_confirmed")).toBe(true);
    expect(isReviewComplete(capped)).toBe(false);
  });

  it("reports no accuracy rather than an inflated one", () => {
    expect(accuracyFromWords(capped)).toBeNull();
  });

  it("reports no reading speed, because the pace follows completeness", () => {
    expect(settledWordsCorrectPerMinute({
      settledCorrectWords: settledCorrectWordCount(capped),
      durationSeconds: 60,
      reviewComplete: isReviewComplete(capped),
    })).toBeNull();
  });

  it("still publishes for the same reading once nothing was discarded", () => {
    // The identical reading with its errors recorded rather than thrown away.
    const kept = [...read(1), ...Array.from({ length: 19 }, () => w("substitution", "teacher_confirmed", "incorrect"))];
    expect(discardedErrorCount(kept)).toBe(0);
    expect(isReviewComplete(kept)).toBe(true);
    expect(accuracyFromWords(kept)).toBe(5);
    expect(settledWordsCorrectPerMinute({
      settledCorrectWords: settledCorrectWordCount(kept), durationSeconds: 60, reviewComplete: true,
    })).toBe(1);
  });

  it("holds even when only one error was discarded", () => {
    const one = [...read(30), w("omission", "teacher_confirmed", "incorrect"), discarded];
    expect(isReviewComplete(one)).toBe(false);
    expect(accuracyFromWords(one)).toBeNull();
  });
});

describe("an ordinary reading is unaffected", () => {
  const ordinary = [...read(38), w("substitution", "teacher_confirmed", "incorrect"), w("omission", "teacher_overridden", "incorrect")];

  it("is complete and reports its figures", () => {
    expect(discardedErrorCount(ordinary)).toBe(0);
    expect(isReviewComplete(ordinary)).toBe(true);
    expect(accuracyFromWords(ordinary)).toBe(98);
  });

  it("and rows with no progress recorded at all do not trip the guard", () => {
    // Older rows, and every unit test that predates this column being read.
    const legacy = [{ judgement: "correct" as const, resolution: "auto" as const }];
    expect(discardedErrorCount(legacy)).toBe(0);
    expect(isReviewComplete(legacy)).toBe(true);
  });
});
