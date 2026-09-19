import { describe, expect, it } from "vitest";
import { activeRetryWord, createReadingPages, isReadingPageComplete } from "../shared/readingPagination";
import { initialLiveWordStates } from "../shared/liveWordStates";
import type { LiveWordState } from "../shared/liveWordStates";

const states = (count: number): LiveWordState[] => Array.from({ length: count }, (_, index) => ({
  id: `word-${index}`,
  text: `word${index}`,
  status: index === count - 1 ? "current" : "correct",
  attempts: 1,
}));

describe("reading pagination", () => {
  it("keeps a sentence boundary when creating child-readable pages", () => {
    const pages = createReadingPages("One two three four five. Six seven eight nine ten. Eleven twelve thirteen fourteen fifteen.", 12);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({ startWordIndex: 0, endWordIndex: 9 });
    expect(pages[0].tokens.join(" ")).toContain("ten.");
  });

  it("advances only after the final page word is settled", () => {
    const page = { startWordIndex: 0, endWordIndex: 2, tokens: ["one ", "two ", "three."] };
    expect(isReadingPageComplete(page, states(3), "ASSISTED_PRACTICE")).toBe(false);
    const completed = states(3);
    completed[2] = { ...completed[2], status: "correct" };
    expect(isReadingPageComplete(page, completed, "ASSISTED_PRACTICE")).toBe(true);
  });

  it("accepts a three-try moved-on word for practice-page progression but not a first miss", () => {
    const page = { startWordIndex: 0, endWordIndex: 0, tokens: ["tricky"] };
    const firstMiss: LiveWordState[] = [{ id: "word-0", text: "tricky", status: "incorrect", attempts: 1 }];
    const movedOn: LiveWordState[] = [{ id: "word-0", text: "tricky", status: "incorrect", attempts: 3 }];
    expect(isReadingPageComplete(page, firstMiss, "GUIDED_PRACTICE")).toBe(false);
    expect(isReadingPageComplete(page, movedOn, "GUIDED_PRACTICE")).toBe(true);
  });
});

describe("a misheard reader can always move forward", () => {
  const passage = "the cat sat on the mat";
  const page = { index: 0, startWordIndex: 0, endWordIndex: 5, tokens: [], text: passage };

  const pageStates = (overrides: Partial<LiveWordState> & { id: string }) =>
    initialLiveWordStates(passage).map(state =>
      state.id === overrides.id
        ? { ...state, status: "correct" as const, ...overrides }
        : { ...state, status: "correct" as const });

  it("holds the page while the reader is still on the flagged word", () => {
    // The product asking the child to try again, which is right while they are there.
    // Nothing after it has been read, so the reader has not gone past.
    const onIt = initialLiveWordStates(passage).map((state, index) =>
      index < 2 ? { ...state, status: "correct" as const } : index === 2 ? { ...state, status: "incorrect" as const, attempts: 1 } : state);
    expect(isReadingPageComplete(page as never, onIt, "ASSISTED_PRACTICE")).toBe(false);
  });

  it("lets the page move on the moment the child chooses to leave the word", () => {
    // Previously this needed attempts >= 3. A speech recogniser mishears on the first
    // attempt, so between one and three there was no control on screen and no page advance:
    // the reader was simply stuck, and the reader most likely to be misheard is the one this
    // product exists for.
    const movedOn = pageStates({ id: "word-2", status: "incorrect", attempts: 1, movedOn: true });
    expect(isReadingPageComplete(page as never, movedOn, "ASSISTED_PRACTICE")).toBe(true);
  });

  it("still moves on after three genuine attempts without a decision", () => {
    const tried = pageStates({ id: "word-2", status: "incorrect", attempts: 3 });
    expect(isReadingPageComplete(page as never, tried, "ASSISTED_PRACTICE")).toBe(true);
  });

  it("never holds a monthly assessment, which does not ask for retries", () => {
    const misheard = pageStates({ id: "word-2", status: "incorrect", attempts: 1 });
    expect(isReadingPageComplete(page as never, misheard, "MONTHLY_ASSESSMENT")).toBe(true);
  });
});

describe("a word the reader has already gone past does not hold the page", () => {
  // Reproduces a reported session exactly: "Amina carried a little lantern into the garden
  // at dusk." with "a" and "at" flagged and every other word read, including the last.
  // Short unstressed words are the ones a recogniser drops, and they are the ones a child
  // cannot fix by repeating: the transcript is matched in order from the start, so a word
  // said again lands against a later part of the passage.
  const passage = "Amina carried a little lantern into the garden at dusk";
  const page = { index: 0, startWordIndex: 0, endWordIndex: 9, tokens: [], text: passage };

  const reportedSession = initialLiveWordStates(passage).map(state =>
    state.text === "a" || state.text === "at"
      ? { ...state, status: "incorrect" as const, attempts: 1 }
      : { ...state, status: "correct" as const, attempts: 1 });

  it("lets the reader continue once later words have been read", () => {
    expect(isReadingPageComplete(page as never, reportedSession, "ASSISTED_PRACTICE")).toBe(true);
    expect(isReadingPageComplete(page as never, reportedSession, "GUIDED_PRACTICE")).toBe(true);
  });

  it("still waits while the reader is on the flagged word at the end", () => {
    // Nothing has been read after it, so the reader is still there and the coach should ask.
    const stuckOnLast = initialLiveWordStates(passage).map((state, index) =>
      index === 9 ? { ...state, status: "incorrect" as const, attempts: 1 } : { ...state, status: "correct" as const, attempts: 1 });
    expect(isReadingPageComplete(page as never, stuckOnLast, "ASSISTED_PRACTICE")).toBe(false);
  });

  it("still waits for words the reader has not reached", () => {
    const halfRead = initialLiveWordStates(passage).map((state, index) =>
      index < 4 ? { ...state, status: "correct" as const, attempts: 1 } : state);
    expect(isReadingPageComplete(page as never, halfRead, "ASSISTED_PRACTICE")).toBe(false);
  });
});

describe("the retry prompt points at the word the reader is on", () => {
  // The reported page, exactly: "Amina stood very still, then watched it hurry safely under
  // the hedge." with "it" flagged and every word after it read aloud.
  const passage = "Amina stood very still then watched it hurry safely under the hedge";
  const readPast = initialLiveWordStates(passage).map((state, index) =>
    index === 6 ? { ...state, status: "incorrect" as const, attempts: 1 } : { ...state, status: "correct" as const, attempts: 1 });

  it("says nothing about a word the reader has already gone past", () => {
    // Prompting here tells a child to fix something behind them, and it is advice they
    // cannot act on: repeating a word out of sequence never re-matches it.
    expect(activeRetryWord(readPast, "ASSISTED_PRACTICE")).toBeUndefined();
  });

  it("points at the flagged word while the reader is still on it", () => {
    const onIt = initialLiveWordStates(passage).map((state, index) =>
      index < 6 ? { ...state, status: "correct" as const } : index === 6 ? { ...state, status: "incorrect" as const, attempts: 1 } : state);
    expect(activeRetryWord(onIt, "ASSISTED_PRACTICE")?.text).toBe("it");
  });

  it("prefers the word the reader has actually reached", () => {
    const states = initialLiveWordStates(passage).map((state, index) =>
      index === 2 ? { ...state, status: "incorrect" as const, attempts: 1 }
      : index < 5 ? { ...state, status: "correct" as const }
      : index === 5 ? { ...state, status: "current" as const } : state);
    expect(activeRetryWord(states, "ASSISTED_PRACTICE")?.text).toBe("watched");
  });

  it("says nothing once the child has chosen to leave the word", () => {
    const left = initialLiveWordStates(passage).map((state, index) =>
      index < 6 ? { ...state, status: "correct" as const } : index === 6 ? { ...state, status: "incorrect" as const, attempts: 1, movedOn: true } : state);
    expect(activeRetryWord(left, "ASSISTED_PRACTICE")).toBeUndefined();
  });

  it("never prompts during a monthly assessment, which does not ask for retries", () => {
    expect(activeRetryWord(readPast, "MONTHLY_ASSESSMENT")).toBeUndefined();
  });
});
