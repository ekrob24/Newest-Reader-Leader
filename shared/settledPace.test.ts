import { describe, expect, it } from "vitest";
import { isReviewComplete, settledCorrectWordCount } from "./readingWordScore";
import { PACE_MIN_SAMPLE_SECONDS, settledWordsCorrectPerMinute } from "./readingPace";
import type { WordJudgement, WordResolution } from "../drizzle/schema";

const w = (judgement: WordJudgement, resolution: WordResolution) => ({ judgement, resolution });
const correct = (n: number) => Array.from({ length: n }, () => w("correct", "auto"));

describe("has the teacher finished reviewing", () => {
  it("is true when nothing was flagged, because nothing needed deciding", () => {
    expect(isReviewComplete(correct(30))).toBe(true);
  });

  it("is true when every miscue has a decision, confirmed or overridden", () => {
    expect(isReviewComplete([...correct(28), w("substitution", "teacher_confirmed"), w("omission", "teacher_overridden")])).toBe(true);
  });

  it("is false while one miscue is still unreviewed", () => {
    // The case the whole rule exists for: three decided, two left.
    expect(isReviewComplete([
      ...correct(25),
      w("substitution", "teacher_confirmed"), w("omission", "teacher_confirmed"), w("insertion", "teacher_overridden"),
      w("substitution", "unreviewed"), w("omission", "unreviewed"),
    ])).toBe(false);
  });

  it("is false for a miscue the system resolved on its own", () => {
    // `auto` means settled without a human, which is not a teacher having decided.
    expect(isReviewComplete([...correct(20), w("substitution", "auto")])).toBe(false);
  });

  it("ignores judgements that can never be errors", () => {
    // A self-correction, hesitation or repetition needs no decision to count nothing.
    expect(isReviewComplete([...correct(10), w("self_correction", "unreviewed"), w("hesitation", "unreviewed"), w("repetition", "unreviewed")])).toBe(true);
  });

  it("holds an uncertain word open rather than treating it as decided", () => {
    // `uncertain` is not an error judgement, so it needs no teacher decision to stop counting.
    expect(isReviewComplete([...correct(10), w("uncertain", "unreviewed")])).toBe(true);
  });

  it("is false for a reading with no words at all", () => {
    // Vacuous completeness is how a figure gets published for a reading nobody has seen.
    expect(isReviewComplete([])).toBe(false);
  });
});

describe("settled words correct", () => {
  it("subtracts only the confirmed miscues", () => {
    const words = [...correct(37), w("substitution", "teacher_confirmed"), w("omission", "teacher_overridden"), w("insertion", "unreviewed")];
    expect(words).toHaveLength(40);
    expect(settledCorrectWordCount(words)).toBe(39);
  });

  it("subtracts nothing before a teacher has confirmed anything", () => {
    expect(settledCorrectWordCount([...correct(38), w("substitution", "unreviewed"), w("omission", "unreviewed")])).toBe(40);
  });
});

describe("the pace a parent sees", () => {
  const reviewed = { settledCorrectWords: 84, durationSeconds: 60, reviewComplete: true };

  it("is words a teacher confirmed, over the time actually read", () => {
    expect(settledWordsCorrectPerMinute(reviewed)).toBe(84);
    expect(settledWordsCorrectPerMinute({ ...reviewed, durationSeconds: 120 })).toBe(42);
  });

  it("is withheld while the review is only partly done", () => {
    // Not "confirmed so far" - that figure would move under a parent's feet.
    expect(settledWordsCorrectPerMinute({ ...reviewed, reviewComplete: false })).toBeNull();
  });

  it("is withheld for a sample too short for pace to mean anything", () => {
    expect(settledWordsCorrectPerMinute({ ...reviewed, durationSeconds: PACE_MIN_SAMPLE_SECONDS - 1 })).toBeNull();
    expect(settledWordsCorrectPerMinute({ ...reviewed, durationSeconds: PACE_MIN_SAMPLE_SECONDS })).not.toBeNull();
  });

  it("stays withheld on a short sample even once the review is complete", () => {
    // Reviewing does not lengthen the reading.
    expect(settledWordsCorrectPerMinute({ settledCorrectWords: 10, durationSeconds: 3, reviewComplete: true })).toBeNull();
  });

  it("drops when a teacher confirms real errors, and is not smoothed", () => {
    const before = settledWordsCorrectPerMinute({ settledCorrectWords: 100, durationSeconds: 60, reviewComplete: true });
    const after = settledWordsCorrectPerMinute({ settledCorrectWords: 88, durationSeconds: 60, reviewComplete: true });
    expect(before).toBe(100);
    expect(after).toBe(88);
    expect(after!).toBeLessThan(before!);
  });

  it("has no floor", () => {
    expect(settledWordsCorrectPerMinute({ settledCorrectWords: 0, durationSeconds: 60, reviewComplete: true })).toBe(0);
  });

  it("refuses a duration that is not a usable number", () => {
    expect(settledWordsCorrectPerMinute({ ...reviewed, durationSeconds: Number.NaN })).toBeNull();
    expect(settledWordsCorrectPerMinute({ ...reviewed, durationSeconds: 0 })).toBeNull();
  });
});

describe("end to end, from word rows to the figure", () => {
  const rows = [...correct(58), w("substitution", "teacher_confirmed"), w("omission", "unreviewed")];

  it("withholds the figure while that omission is undecided", () => {
    expect(settledWordsCorrectPerMinute({
      settledCorrectWords: settledCorrectWordCount(rows),
      durationSeconds: 60,
      reviewComplete: isReviewComplete(rows),
    })).toBeNull();
  });

  it("and publishes it, lower, once she overrides the substitution and confirms the omission", () => {
    const decided = [...correct(58), w("substitution", "teacher_overridden"), w("omission", "teacher_confirmed")];
    expect(settledWordsCorrectPerMinute({
      settledCorrectWords: settledCorrectWordCount(decided),
      durationSeconds: 60,
      reviewComplete: isReviewComplete(decided),
    })).toBe(59);
  });
});
