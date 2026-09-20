import { describe, expect, it } from "vitest";
import { buildReviewQueue, kForFullRecall, recallAtK, reviewCost, type ReviewWord } from "./reviewRanking";

const word = (tokenIndex: number, referenceWord: string, score: number | null): ReviewWord => ({
  wordEventId: `w-${tokenIndex}`,
  tokenIndex,
  referenceWord,
  score,
  startMs: tokenIndex * 500,
  endMs: tokenIndex * 500 + 400,
});

// The first real reading, with the two deliberate errors and the three lowest correctly-read
// words. `gate` scored below both errors, which is the case the ordering has to survive.
const reading: ReviewWord[] = [
  word(12, "made", 0.499),
  word(13, "golden", 0.3978),
  word(21, "gate", 0.1864),
  word(25, "hedgehog", 0.4132),
  word(41, "hedge", 0.6596),
  word(31, "stood", 0.9985),
];
const isError = (w: ReviewWord) => w.referenceWord === "golden" || w.referenceWord === "hedgehog";

describe("the review queue", () => {
  it("puts the least certain word first", () => {
    const { ranked } = buildReviewQueue(reading);
    expect(ranked.map(w => w.referenceWord)).toEqual(["gate", "golden", "hedgehog", "made", "hedge", "stood"]);
    expect(ranked.map(w => w.rank)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("breaks ties on reading order, so two renders cannot disagree", () => {
    const tied = [word(9, "later", 0.5), word(2, "earlier", 0.5), word(5, "middle", 0.5)];
    expect(buildReviewQueue(tied).ranked.map(w => w.referenceWord)).toEqual(["earlier", "middle", "later"]);
    // And the same list shuffled produces the same order.
    expect(buildReviewQueue([...tied].reverse()).ranked.map(w => w.referenceWord))
      .toEqual(["earlier", "middle", "later"]);
  });

  it("does not mutate what it was given", () => {
    const before = reading.map(w => w.referenceWord);
    buildReviewQueue(reading);
    expect(reading.map(w => w.referenceWord)).toEqual(before);
  });
});

describe("a word with no score", () => {
  // Every confidence column is null today. Treating that as zero floats the word to the top of
  // the queue and treating it as one buries it; both are the software asserting a certainty it
  // does not have.
  it("is not ranked as though it scored zero", () => {
    const { ranked } = buildReviewQueue([word(1, "unscored", null), word(2, "low", 0.1)]);
    expect(ranked.map(w => w.referenceWord)).toEqual(["low"]);
    expect(ranked[0].rank).toBe(1);
  });

  it("is not ranked as though it scored one either", () => {
    const { ranked, unscored } = buildReviewQueue([word(1, "unscored", null), word(2, "high", 0.99)]);
    expect(ranked.map(w => w.referenceWord)).toEqual(["high"]);
    expect(unscored.map(w => w.referenceWord)).toEqual(["unscored"]);
  });

  it("is kept and reported in reading order, not dropped", () => {
    const { unscored } = buildReviewQueue([word(9, "c", null), word(1, "a", null), word(4, "b", null)]);
    expect(unscored.map(w => w.referenceWord)).toEqual(["a", "b", "c"]);
  });

  it("marks the whole reading unordered when nothing carries a score", () => {
    const queue = buildReviewQueue([word(1, "a", null), word(2, "b", null)]);
    expect(queue.unordered).toBe(true);
    expect(queue.ranked).toEqual([]);
    // Which is the state of every saved reading right now.
    expect(queue.unscored).toHaveLength(2);
  });

  it("is not unordered as soon as one word carries a score", () => {
    expect(buildReviewQueue([word(1, "a", null), word(2, "b", 0.4)]).unordered).toBe(false);
  });
});

describe("recall@k", () => {
  it("counts the real errors inside the k least certain words", () => {
    // gate is rank 1, golden 2, hedgehog 3.
    expect(recallAtK(reading, isError, 1)).toMatchObject({ found: 0, total: 2, recall: 0 });
    expect(recallAtK(reading, isError, 2)).toMatchObject({ found: 1, total: 2, recall: 0.5 });
    expect(recallAtK(reading, isError, 3)).toMatchObject({ found: 2, total: 2, recall: 1 });
  });

  it("is a rank cut-off and not a score cut-off", () => {
    // Every score here is far below any plausible threshold, yet k still limits what is seen.
    const dim = [word(1, "a", 0.01), word(2, "b", 0.02), word(3, "err", 0.03)];
    expect(recallAtK(dim, w => w.referenceWord === "err", 2).found).toBe(0);
    expect(recallAtK(dim, w => w.referenceWord === "err", 3).found).toBe(1);
  });

  it("counts an unscored error in the denominator, where it can never be found", () => {
    // Dropping it would raise recall by shrinking what recall is measured against.
    const withUnscored = [...reading, word(50, "missed", null)];
    const result = recallAtK(withUnscored, w => isError(w) || w.referenceWord === "missed", 99);
    expect(result.total).toBe(3);
    expect(result.found).toBe(2);
    expect(result.recall).toBeCloseTo(2 / 3);
    expect(result.unscoredErrors).toBe(1);
  });

  it("reports no recall rather than a perfect one when there are no errors", () => {
    const result = recallAtK(reading, () => false, 5);
    expect(result.recall).toBeNull();
    expect(result.total).toBe(0);
  });

  it("does not let k beyond the reading inflate anything", () => {
    expect(recallAtK(reading, isError, 1000)).toMatchObject({ found: 2, total: 2, recall: 1 });
  });
});

describe("how far down the teacher has to read", () => {
  it("is the rank of the worst-ranked real error", () => {
    expect(kForFullRecall(reading, isError)).toBe(3);
  });

  it("is unanswerable when an error carries no score", () => {
    expect(kForFullRecall([...reading, word(50, "missed", null)],
      w => isError(w) || w.referenceWord === "missed")).toBeNull();
  });

  it("is unanswerable when there are no errors", () => {
    expect(kForFullRecall(reading, () => false)).toBeNull();
  });
});

describe("review cost", () => {
  it("is words, seconds and minutes at a measured rate", () => {
    expect(reviewCost(8, 4)).toEqual({ words: 8, seconds: 32, minutes: 32 / 60 });
  });

  it("is zero for an empty queue rather than a fraction of a word", () => {
    expect(reviewCost(0, 4)).toEqual({ words: 0, seconds: 0, minutes: 0 });
    expect(reviewCost(-3, 4)).toEqual({ words: 0, seconds: 0, minutes: 0 });
  });

  it("compares against the ten to fifteen minutes a running record costs today", () => {
    // Not a claim about the product - arithmetic showing what the figure has to beat.
    expect(reviewCost(8, 4).minutes).toBeLessThan(10);
    expect(reviewCost(200, 4).minutes).toBeGreaterThan(10);
  });
});
