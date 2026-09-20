import { describe, expect, it } from "vitest";
import { analyseReadingText } from "./reader";

const PASSAGE = "Amina carried a little lantern into the garden at dusk. The light made golden circles on the path. Near the tall gate, she saw a hedgehog sniffing beside the flowers. Amina stood very still, then watched it hurry safely under the hedge.";
const SPOKEN = "Amina carried a little lantern into the garden at dusk the light made golden circles on the path near the tall gate she saw a hedgehog sniffing beside the flowers Amina stood very still then watched it hurry safely under the hedge".split(" ");
const withoutWords = (positions: number[]) => SPOKEN.filter((_, index) => !positions.includes(index)).join(" ");
const score = (positions: number[]) => analyseReadingText(PASSAGE, withoutWords(positions), 60);

describe("the saved score when the recogniser drops words", () => {
  it("is perfect on a perfect transcript", () => {
    expect(score([]).accuracy).toBe(100);
  });

  // The one-word lookahead recovered from a single omission and never resynchronised after
  // two in a row. "into the" sits at words 5 and 6 of this passage and is exactly the pair a
  // recogniser loses when connected speech reduces it.
  it.each([
    ["one 'a'", [2], 98],
    ["one 'into'", [5], 98],
    ["two, two apart", [2, 5], 95],
    ["two adjacent, which scored 7% before", [5, 6], 95],
    ["three, two adjacent, which scored 12% before", [2, 5, 6], 93],
    ["three adjacent", [5, 6, 7], 93],
  ])("recovers from %s", (_label, positions, expected) => {
    expect(score(positions as number[]).accuracy).toBe(expected);
  });

  it("counts every word in a run as its own omission, not just the first", () => {
    // Recording one error for three skipped words would understate the reading and leave two
    // words with no event at all.
    const omissions = score([5, 6, 7]).events.filter(event => event.eventType === "omission");
    expect(omissions.map(event => event.expectedWord)).toEqual(["into", "the", "garden"]);
  });

  it("does not turn a substitution into an omission", () => {
    // A misread word is still a substitution: nothing was skipped, one word was said wrongly.
    const misread = analyseReadingText(PASSAGE, SPOKEN.map((word, index) => (index === 25 ? "hedgerow" : word)).join(" "), 60);
    expect(misread.events.filter(event => event.eventType === "substitution").map(event => event.expectedWord)).toEqual(["hedgehog"]);
    expect(misread.events.filter(event => event.eventType === "omission")).toHaveLength(0);
    expect(misread.accuracy).toBe(98);
  });

  it("degrades rather than collapsing on a run longer than the window", () => {
    // Four in a row is past the lookahead, so they are not recognised as omissions. The
    // comparison does not pin the way the live cursor does - it treats them as substitutions,
    // consumes one heard word each, and partly resynchronises by luck. 69%, measured: worse
    // than the 90% it manages inside the window and far better than the 7% it used to score
    // on two adjacent. Recorded as the observed number, not as a target.
    expect(score([5, 6, 7, 8]).accuracy).toBe(69);
  });

  it("agrees with the live highlight the child saw", () => {
    // The two run over the same reading. A teacher seeing a record that disagrees with what
    // the child watched is the disagreement this whole change is about.
    for (const positions of [[2], [5, 6], [5, 6, 7]]) {
      expect(score(positions).accuracy, positions.join(",")).toBeGreaterThan(90);
    }
  });
});
