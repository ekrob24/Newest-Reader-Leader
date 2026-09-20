import { describe, expect, it } from "vitest";
import { REANCHOR_LOOKAHEAD, deriveLiveWordStates } from "./liveWordStates";

const PASSAGE = "Amina carried a little lantern into the garden at dusk. The light made golden circles on the path. Near the tall gate, she saw a hedgehog sniffing beside the flowers. Amina stood very still, then watched it hurry safely under the hedge.";
const SPOKEN = "Amina carried a little lantern into the garden at dusk the light made golden circles on the path near the tall gate she saw a hedgehog sniffing beside the flowers Amina stood very still then watched it hurry safely under the hedge".split(" ");

/** The transcript a recogniser produces when it drops the words at these positions. */
const withoutWords = (positions: number[]) => SPOKEN.filter((_, index) => !positions.includes(index)).join(" ");
const matchedPercent = (transcript: string) => {
  const states = deriveLiveWordStates(PASSAGE, transcript, "ASSISTED_PRACTICE");
  const matched = states.filter(state => state.status === "correct" || state.status === "retried_correct").length;
  return Math.round((matched / states.length) * 100);
};

describe("one dropped word no longer pins the cursor", () => {
  it("reads a perfect transcript perfectly", () => {
    expect(matchedPercent(withoutWords([]))).toBe(100);
  });

  // Before re-anchoring every one of these collapsed to between 5% and 17%: the cursor stopped
  // at the dropped word and every later word, correctly said and correctly heard, was compared
  // against the wrong one. These are the measured numbers, not round ones.
  it.each([
    ["'a' at word 3", [2], 98],
    ["'into' at word 6", [5], 98],
    ["'the' at word 11", [10], 98],
    ["the last word", [41], 98],
    ["two, two apart", [2, 5], 95],
    ["two adjacent, which is what 'into the' does", [5, 6], 95],
    ["three, two of them adjacent", [2, 5, 6], 93],
    ["three adjacent", [5, 6, 7], 93],
    ["all thirteen function words", [2, 5, 6, 8, 10, 15, 16, 19, 24, 28, 36, 39, 40], 69],
  ])("recovers from %s", (_label, positions, expected) => {
    expect(matchedPercent(withoutWords(positions as number[]))).toBe(expected);
  });

  it("still gives up when four words in a row are gone, and does not pretend otherwise", () => {
    // The window is three. A run longer than that is a reading that has genuinely gone wrong,
    // and a cursor that leapt over it would be inventing a position rather than finding one.
    expect(matchedPercent(withoutWords([5, 6, 7, 8]))).toBeLessThan(20);
  });
});

describe("the cost at the other end", () => {
  it("does not jump to a later copy of a word when the child repeats herself", () => {
    // "the light made" said twice. The passage contains "the" five times, so a wider window
    // reaches a later copy and marks everything between as unread: measured at 86% for k=4
    // and 67% for k=10. At the chosen window it costs nothing.
    const hesitated = [...SPOKEN.slice(0, 12), "the", "light", "made", ...SPOKEN.slice(12)].join(" ");
    expect(matchedPercent(hesitated)).toBe(100);
  });

  it("keeps the window small enough for that to hold", () => {
    // If someone widens this, the repeated-words case above is what breaks first.
    expect(REANCHOR_LOOKAHEAD).toBeLessThanOrEqual(3);
  });
});

describe("what re-anchoring records about the words it passed over", () => {
  it("marks them read-incorrectly rather than leaving them untouched", () => {
    const states = deriveLiveWordStates(PASSAGE, withoutWords([5, 6]), "ASSISTED_PRACTICE");
    expect(states[5].text).toBe("into");
    expect(states[6].text).toBe("the");
    expect(states[5].status).toBe("incorrect");
    expect(states[6].status).toBe("incorrect");
    // And the word she actually said next is credited to the right place.
    expect(states[7].text).toBe("garden");
    expect(states[7].status).toBe("correct");
  });

  it("re-anchors past a word the child moved on from, and leaves her record of it intact", () => {
    // Both halves matter. A guard that refused to look past a moved-on word was measured here
    // and removed: it cost eleven words of recovery on this very transcript, 4 of 42 against
    // 15, and protected nothing - the pass at the end of deriveLiveWordStates re-asserts a
    // moved-on word's status and attempt count whatever the cursor did.
    const movedOn = new Map([["word-6", 2]]);
    const transcript = "Amina carried a little lamp the garden at dusk the light made golden circles on the path";
    const states = deriveLiveWordStates(PASSAGE, transcript, "ASSISTED_PRACTICE", "STANDARD_ENGLISH", [], movedOn);
    const matched = states.filter(state => state.status === "correct" || state.status === "retried_correct").length;
    expect(matched).toBeGreaterThanOrEqual(15);

    expect(states[6].text).toBe("the");
    expect(states[6].movedOn).toBe(true);
    expect(states[6].attempts).toBe(2);
    expect(states[6].status).toBe("incorrect");
  });
});
