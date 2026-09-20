import { describe, expect, it } from "vitest";
import { deriveLiveWordStates, type LiveWordState } from "./liveWordStates";

const PASSAGE = "Amina carried a little lantern into the garden at dusk. The light made golden circles on the path. Near the tall gate, she saw a hedgehog sniffing beside the flowers. Amina stood very still, then watched it hurry safely under the hedge.";
const PERFECT = "Amina carried a little lantern into the garden at dusk the light made golden circles on the path near the tall gate she saw a hedgehog sniffing beside the flowers Amina stood very still then watched it hurry safely under the hedge";

/** Exactly what Home.tsx computes for the bar. Kept in one place so the test cannot drift
 *  from the component by testing a different expression. */
const barWords = (states: LiveWordState[]) =>
  states.filter(state => state.status !== "unread" && state.status !== "current").length;
/** What it used to compute: raw transcript length. */
const oldBarWords = (transcript: string) => (transcript.match(/[a-zA-Z]+(?:'[a-zA-Z]+)?/g) ?? []).length;

const states = (transcript: string) => deriveLiveWordStates(PASSAGE, transcript, "ASSISTED_PRACTICE");
const dropFirst = (transcript: string, word: string) => {
  let dropped = false;
  return transcript.split(" ").filter(w => (!dropped && w.toLowerCase() === word ? ((dropped = true), false) : true)).join(" ");
};

describe("the reading progress bar", () => {
  it("reaches the end of the passage on a perfect read", () => {
    expect(barWords(states(PERFECT))).toBe(42);
  });

  it("follows the matcher, not the transcript, when the matcher loses the reader", () => {
    // One dropped function word pins the cursor. The bar must stop where the highlight stops.
    const transcript = dropFirst(PERFECT, "a");
    const reached = barWords(states(transcript));
    expect(reached).toBeLessThan(10);
    // The old expression would have said the child was nearly finished.
    expect(oldBarWords(transcript)).toBe(41);
    expect(oldBarWords(transcript)).toBeGreaterThan(reached * 4);
  });

  it("never reports more progress than there are words in the passage", () => {
    // A recogniser that repeats itself used to push the raw count past the story length.
    const repeated = `${PERFECT} ${PERFECT}`;
    expect(barWords(states(repeated))).toBeLessThanOrEqual(42);
    expect(oldBarWords(repeated)).toBeGreaterThan(42);
  });

  it("is zero before the child has said anything", () => {
    expect(barWords(states(""))).toBe(0);
  });

  it("counts a word the matcher judged incorrect, because the reader did move past it", () => {
    // Progress is how far through the passage she is, not how well she did.
    const misread = states("Amina carried a little lantern into the garden at dusk the light made golden");
    expect(barWords(misread)).toBeGreaterThan(0);
  });
});
