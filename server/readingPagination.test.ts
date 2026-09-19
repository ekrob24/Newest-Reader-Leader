import { describe, expect, it } from "vitest";
import { createReadingPages, isReadingPageComplete } from "../shared/readingPagination";
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

  it("holds the page while a flagged word has had one attempt and no decision", () => {
    // The product asking the child to try again. Correct on its own — it is the absence of
    // any way out of it that was the bug.
    const misheard = pageStates({ id: "word-2", status: "incorrect", attempts: 1 });
    expect(isReadingPageComplete(page as never, misheard, "ASSISTED_PRACTICE")).toBe(false);
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
