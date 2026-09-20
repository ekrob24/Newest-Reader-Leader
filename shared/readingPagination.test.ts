import { describe, expect, it } from "vitest";
import { createReadingPages } from "./readingPagination";
import { initialLiveWordStates } from "./liveWordStates";

/**
 * A page's startWordIndex and endWordIndex index the word states directly, so the tokens on a
 * page have to be the same things the word states are, in the same order. They were not: the
 * page tokenizer split on whitespace, which makes "well-known" one token where the matcher
 * sees two words, and "100" a token where it sees none. Past the first such token the reading
 * view highlighted the wrong word and the error grew with the passage.
 *
 * Invisible in all three demo stories, which are clean prose. Teacher-uploaded material -
 * which is the actual product - has numbers, hyphens and dashes in it routinely.
 */
describe("one tokenizer for pages and for word states", () => {
  const awkward = "The well-known path had 12 stones — Ben counted each one twice, then ran 100 metres before the bell.";
  const passages = [awkward, "Mina found a bright kite caught in the tall grass.", "She ran 100 metres — faster than ever."];

  it("gives every word state exactly one page token, in order", () => {
    for (const text of passages) {
      const tokens = createReadingPages(text, 16).flatMap(page => page.tokens);
      const states = initialLiveWordStates(text);
      expect(tokens).toHaveLength(states.length);
      expect(tokens.map(token => token.trim().toLowerCase().replace(/[^a-z']/g, ""))).toEqual(states.map(state => state.text));
    }
  });

  it("ends the last page on the last word state, so no word is left without one", () => {
    for (const text of passages) {
      expect(createReadingPages(text, 16).at(-1)!.endWordIndex).toBe(initialLiveWordStates(text).length - 1);
    }
  });

  it("keeps the numbers, dashes and punctuation on screen rather than dropping them", () => {
    const shown = createReadingPages(awkward, 16).flatMap(page => page.tokens).join("");
    expect(shown).toBe(awkward);
    for (const kept of ["12", "100", "—", "well-known"]) expect(shown).toContain(kept);
  });

  it("still starts every page where the previous one ended", () => {
    const pages = createReadingPages(awkward, 8);
    expect(pages.length).toBeGreaterThan(1);
    for (let index = 1; index < pages.length; index += 1) {
      expect(pages[index].startWordIndex).toBe(pages[index - 1].endWordIndex + 1);
    }
  });
});
