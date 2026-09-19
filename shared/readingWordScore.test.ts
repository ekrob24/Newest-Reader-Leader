import { describe, expect, it } from "vitest";
import { wordJudgementValues, wordResolutionValues, type WordJudgement, type WordResolution } from "../drizzle/schema";
import { accuracyFromWords, countsAgainstScore, isErrorJudgement } from "./readingWordScore";

const word = (judgement: WordJudgement, resolution: WordResolution) => ({ judgement, resolution });

describe("does this word count against the score", () => {
  it("does not count a word a teacher overrode", () => {
    // The case the whole design exists for: the model called it a substitution, the teacher
    // disagreed, and the child's accuracy must follow the teacher.
    expect(countsAgainstScore(word("substitution", "teacher_overridden"))).toBe(false);
    expect(countsAgainstScore(word("omission", "teacher_overridden"))).toBe(false);
    expect(countsAgainstScore(word("insertion", "teacher_overridden"))).toBe(false);
  });

  it("does not count a self-correction", () => {
    // A child noticing and repairing their own reading is a strength, not a miscue.
    for (const resolution of wordResolutionValues) {
      expect(countsAgainstScore(word("self_correction", resolution)), resolution).toBe(false);
    }
  });

  it("does not count an unreviewed word", () => {
    // A machine judgement no human checked must not enter a child's record.
    expect(countsAgainstScore(word("substitution", "unreviewed"))).toBe(false);
    expect(countsAgainstScore(word("omission", "unreviewed"))).toBe(false);
  });

  it("counts a teacher-confirmed error", () => {
    expect(countsAgainstScore(word("substitution", "teacher_confirmed"))).toBe(true);
    expect(countsAgainstScore(word("omission", "teacher_confirmed"))).toBe(true);
    expect(countsAgainstScore(word("insertion", "teacher_confirmed"))).toBe(true);
  });

  it("does not count repetitions, hesitations or uncertain evidence, however resolved", () => {
    for (const judgement of ["correct", "repetition", "hesitation", "uncertain"] as const) {
      for (const resolution of wordResolutionValues) {
        expect(countsAgainstScore(word(judgement, resolution)), `${judgement}/${resolution}`).toBe(false);
      }
    }
  });

  it("does not count an auto-resolved miscue", () => {
    // Pinning the open decision rather than letting a default drift: `auto` does not count.
    expect(countsAgainstScore(word("substitution", "auto"))).toBe(false);
  });

  it("counts exactly one combination family, so the rule cannot silently widen", () => {
    const counting = wordJudgementValues.flatMap(judgement =>
      wordResolutionValues.filter(resolution => countsAgainstScore(word(judgement, resolution))).map(resolution => `${judgement}/${resolution}`),
    );
    expect(counting.sort()).toEqual([
      "insertion/teacher_confirmed",
      "omission/teacher_confirmed",
      "substitution/teacher_confirmed",
    ]);
  });

  it("classifies miscue judgements", () => {
    expect(wordJudgementValues.filter(isErrorJudgement).sort()).toEqual(["insertion", "omission", "substitution"]);
  });

  it("derives accuracy from the words alone", () => {
    expect(accuracyFromWords([])).toBeNull();
    const words = [
      word("correct", "auto"), word("correct", "auto"), word("correct", "auto"),
      word("substitution", "teacher_confirmed"),
    ];
    expect(accuracyFromWords(words)).toBe(75);
    // An override moves the number, which is the property a stored flag would break.
    const overridden = words.map(w => (w.judgement === "substitution" ? word("substitution", "teacher_overridden") : w));
    expect(accuracyFromWords(overridden)).toBe(100);
  });
});
