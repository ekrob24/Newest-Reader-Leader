import { describe, expect, it } from "vitest";
import { createReadingPages, isReadingPageComplete } from "./readingPagination";
import { advanceReadingPosition, deriveLiveWordStates, initialLiveWordStates, keepWordsAlreadyRead, liveReadingPosition, readerWordClass, type LiveWordState } from "./liveWordStates";

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
function cursorOverTheReading(interimBlanksEvery: number) {
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
    const heard = interimPresent ? WORDS.slice(0, spoken).join(" ") : finals;

    // Judgement: finals only.
    if (finals.trim()) states = keepWordsAlreadyRead(states, deriveLiveWordStates(PASSAGE, finals, "ASSISTED_PRACTICE"));
    // Position: finals plus the interim, and never backwards.
    if (heard.trim()) positionIndex = advanceReadingPosition(positionIndex, liveReadingPosition(deriveLiveWordStates(PASSAGE, heard, "ASSISTED_PRACTICE")));
    // The page turns on judgement, and again when the cursor has passed the end of it.
    while (pageIndex < pages.length - 1 && isReadingPageComplete(pages[pageIndex], states, "ASSISTED_PRACTICE")) pageIndex += 1;
    while (pageIndex < pages.length - 1 && positionIndex > pages[pageIndex].endWordIndex) pageIndex += 1;

    const page = pages[pageIndex];
    const at = page.tokens.findIndex((_, offset) => readerWordClass(states[page.startWordIndex + offset]?.status, page.startWordIndex + offset === positionIndex, "ASSISTED_PRACTICE") === "current");
    seen.push({ spoken, index: at < 0 ? null : page.startWordIndex + at });
  }
  return { pages, seen };
}

describe("the highlight, over a stream shaped like a real recogniser's", () => {
  it("never moves backwards, however the interim is revised or blanked", () => {
    for (const blankEvery of [2, 3, 5]) {
      const { seen } = cursorOverTheReading(blankEvery);
      const positions = seen.map(step => step.index).filter((index): index is number => index !== null);
      const backwards = positions.filter((index, at) => at > 0 && index < positions[at - 1]);
      expect(backwards, `blanking every ${blankEvery} ticks moved the cursor back`).toEqual([]);
    }
  });

  it("never parks on the last word of a page the reader has not reached", () => {
    // This is the reported symptom stated as a property. The cursor sat on the page's final
    // word because position ran ahead of the page while the page turned on finals.
    const { pages, seen } = cursorOverTheReading(3);
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
    const { seen } = cursorOverTheReading(3);
    const behind = seen.filter(step => step.index !== null && step.spoken - step.index > 3);
    expect(behind, "the cursor fell more than three words behind the reader").toEqual([]);
  });

  it("advances onto every page as the reading goes on, so a still cursor is not a stuck one", () => {
    // This is the lag, stated rather than hidden: between finals the cursor waits at the
    // first unsettled word, and it moves on when the sentence is settled. Waiting is what was
    // traded for the flicking, deliberately. What must not happen is it never arriving.
    const { pages, seen } = cursorOverTheReading(3);
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
