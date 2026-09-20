import { describe, expect, it } from "vitest";
import { createReadingPages, isReadingPageComplete } from "./readingPagination";
import { advanceReadingPosition, deriveLiveReading, deriveLiveWordStates, initialLiveWordStates, keepWordsAlreadyRead, readerWordClass, type LiveWordState } from "./liveWordStates";

/**
 * The condition the browser journey's stub has never contained.
 *
 * That stub hands the app a perfect transcript in one go, as a single final result. A real
 * recogniser does nothing of the sort: it emits a stream of interim guesses that grow, get
 * revised, and are momentarily empty - one instrumented read produced 170 interims against 9
 * finals, with one final arriving 16.5 seconds after the interim that first carried its words.
 *
 * Deriving the cursor from that stream made it flick between the word being read and the last
 * word on the page, several times a second, which is unusable. This drives the real functions
 * with the real shape of the stream and holds the cursor to two properties: it never moves
 * backwards, and it never parks on the last word of a page the reader has not reached.
 */
const PASSAGE = "Amina carried a little lantern into the garden at dusk. The light made golden circles on the path. Near the tall gate, she saw a hedgehog sniffing beside the flowers. Amina stood very still, then watched it hurry safely under the hedge.";
const WORDS = PASSAGE.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
const FINALS_AT = [10, 20, 30, 42];

/** Where the highlight sits on the page the reader can see, as the page renders it. */
function cursorOverTheReading(interimBlanksEvery: number, misheardEvery = 0) {
  const pages = createReadingPages(PASSAGE, 16);
  let states: LiveWordState[] = initialLiveWordStates(PASSAGE);
  let pageIndex = 0;
  let finalsThrough = 0;
  const seen: { spoken: number; index: number | null }[] = [];

  let positionIndex = 0;
  for (let spoken = 1; spoken <= WORDS.length; spoken += 1) {
    if (FINALS_AT.includes(spoken)) finalsThrough = spoken;
    const finals = WORDS.slice(0, finalsThrough).join(" ");
    // The interim in flight, and every so often none at all - the event carrying a final
    // carries no interim, and a revision blanks it between fragments.
    const interimPresent = spoken % interimBlanksEvery !== 0;
    // The recogniser mishears. Every interim it emits is a guess, and the first guess at a word
    // is very often wrong - which is the condition this generator used to model not at all,
    // because it only ever produced exact prefixes of the passage.
    const said = WORDS.slice(0, spoken);
    if (misheardEvery && spoken % misheardEvery === 0) said[spoken - 1] = "mmm";
    const heard = interimPresent ? said.join(" ") : finals;

    // Judgement: finals only.
    if (finals.trim()) states = keepWordsAlreadyRead(states, deriveLiveWordStates(PASSAGE, finals, "ASSISTED_PRACTICE"));
    // Position: finals plus the interim, and never backwards.
    if (heard.trim()) positionIndex = advanceReadingPosition(positionIndex, deriveLiveReading(PASSAGE, heard, "ASSISTED_PRACTICE").position);
    // The page turns on judgement, and again when the cursor has passed the end of it.
    while (pageIndex < pages.length - 1 && isReadingPageComplete(pages[pageIndex], states, "ASSISTED_PRACTICE")) pageIndex += 1;
    while (pageIndex < pages.length - 1 && positionIndex > pages[pageIndex].endWordIndex) pageIndex += 1;

    const page = pages[pageIndex];
    const at = page.tokens.findIndex((_, offset) => readerWordClass(states[page.startWordIndex + offset]?.status, page.startWordIndex + offset === positionIndex, "ASSISTED_PRACTICE") === "current");
    seen.push({ spoken, index: at < 0 ? null : page.startWordIndex + at });
  }
  return { pages, seen };
}

describe("a misheard word is not the end of the story", () => {
  it("does not send the reader to the end when the very first guess is wrong", () => {
    // A word the reader is on and that the matcher has flagged is the cursor and incorrect at
    // once. Recovering the cursor from the status field could not represent that, and read it
    // as "finished the passage" - which is what "as soon as I speak it jumps to the last
    // page" was.
    const { position } = deriveLiveReading(PASSAGE, "ren", "ASSISTED_PRACTICE");
    expect(position).toBeLessThan(3);
  });

  it("leaves the cursor on the flagged word after a mid-passage miscue", () => {
    const heard = [...WORDS.slice(0, 12), "somethingelse"].join(" ");
    const { position } = deriveLiveReading(PASSAGE, heard, "ASSISTED_PRACTICE");
    expect(position).toBeLessThanOrEqual(13);
  });

  it("still reports the end of the passage when the reader has actually reached it", () => {
    // The sentinel meant something. Removing the way it was produced must not remove the fact.
    const { states, position } = deriveLiveReading(PASSAGE, WORDS.join(" "), "ASSISTED_PRACTICE");
    expect(position).toBe(states.length);
  });

  it("never reports a position beyond the passage, whatever it is fed", () => {
    for (const heard of ["mmm", WORDS.join(" ") + " and more and more", WORDS.slice(0, 3).join(" ")]) {
      const { states, position } = deriveLiveReading(PASSAGE, heard, "ASSISTED_PRACTICE");
      expect(position).toBeGreaterThanOrEqual(0);
      expect(position).toBeLessThanOrEqual(states.length);
    }
  });
});

describe("the highlight, over a stream shaped like a real recogniser's", () => {
  it("never moves backwards, however the interim is revised or blanked", () => {
    for (const blankEvery of [2, 3, 5]) {
      const { seen } = cursorOverTheReading(blankEvery, 7);
      const positions = seen.map(step => step.index).filter((index): index is number => index !== null);
      const backwards = positions.filter((index, at) => at > 0 && index < positions[at - 1]);
      expect(backwards, `blanking every ${blankEvery} ticks moved the cursor back`).toEqual([]);
    }
  });

  it("never parks on the last word of a page the reader has not reached", () => {
    // This is the reported symptom stated as a property. The cursor sat on the page's final
    // word because position ran ahead of the page while the page turned on finals.
    const { pages, seen } = cursorOverTheReading(3, 7);
    const lastWordOfAPage = new Set(pages.map(page => page.endWordIndex));
    const parked = seen.filter(step => step.index !== null && lastWordOfAPage.has(step.index) && step.spoken < step.index);
    expect(parked).toEqual([]);
  });

  it("keeps exactly one highlighted word on the visible page at any moment", () => {
    const pages = createReadingPages(PASSAGE, 16);
    let states: LiveWordState[] = initialLiveWordStates(PASSAGE);
    let finalsThrough = 0;
    for (let spoken = 1; spoken <= WORDS.length; spoken += 1) {
      if (FINALS_AT.includes(spoken)) finalsThrough = spoken;
      const finals = WORDS.slice(0, finalsThrough).join(" ");
      if (finals.trim()) states = keepWordsAlreadyRead(states, deriveLiveWordStates(PASSAGE, finals, "ASSISTED_PRACTICE"));
      expect(states.filter(state => state.status === "current").length).toBeLessThanOrEqual(1);
    }
    expect(pages.length).toBe(4);
  });

  it("keeps up with the reader rather than waiting for the recogniser to settle", () => {
    // The reverted, finals-only cursor sat at the first unsettled word of a page until the
    // whole sentence came back - up to sixteen seconds. "Does not keep up with the speed of
    // reading" is that, reported from a real read. The cursor must stay near the words being
    // said, not near the words the recogniser has finished thinking about.
    const { seen } = cursorOverTheReading(3, 7);
    const behind = seen.filter(step => step.index !== null && step.spoken - step.index > 3);
    expect(behind, "the cursor fell more than three words behind the reader").toEqual([]);
  });

  it("advances onto every page as the reading goes on, so a still cursor is not a stuck one", () => {
    // This is the lag, stated rather than hidden: between finals the cursor waits at the
    // first unsettled word, and it moves on when the sentence is settled. Waiting is what was
    // traded for the flicking, deliberately. What must not happen is it never arriving.
    const { pages, seen } = cursorOverTheReading(3, 7);
    const positions = seen.map(step => step.index);
    // Somewhere on each page, not necessarily its first word: a final can settle several
    // words at once and carry the cursor past the start of the page it lands on.
    for (const page of pages) {
      const reached = positions.some(index => index !== null && index >= page.startWordIndex && index <= page.endWordIndex);
      expect(reached, `the cursor never appeared on the page from ${page.startWordIndex} to ${page.endWordIndex}`).toBe(true);
    }
    expect(seen[seen.length - 1].index).toBeNull();
  });
});

describe("the quiet mode still shows the reader where she is", () => {
  // A monthly assessment deliberately shows no colours at all, so its only mark is the cursor.
  // When the cursor was recovered from the status field and came back as the end-of-passage
  // sentinel, that screen had no highlight anywhere and said nothing about it.
  it("marks the cursor word in a monthly assessment, and marks nothing else", () => {
    const { position } = deriveLiveReading(PASSAGE, WORDS.slice(0, 4).join(" "), "MONTHLY_ASSESSMENT");
    expect(position).toBe(4);
    const classes = WORDS.map((_, index) => readerWordClass("unread", index === position, "MONTHLY_ASSESSMENT"));
    expect(classes.filter(cls => cls === "current")).toHaveLength(1);
    expect(classes.filter(cls => cls !== "" && cls !== "current")).toEqual([]);
  });

  it("does not lose the cursor in quiet mode when a word is misheard", () => {
    const heard = [...WORDS.slice(0, 5), "mmm"].join(" ");
    const { states, position } = deriveLiveReading(PASSAGE, heard, "MONTHLY_ASSESSMENT");
    expect(position).toBeLessThan(states.length);
    expect(readerWordClass(states[position]?.status, true, "MONTHLY_ASSESSMENT")).toBe("current");
  });
});
