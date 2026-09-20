import { READING_WORD_PATTERN, type LiveWordState } from "./liveWordStates";

export type ReadingPage = {
  startWordIndex: number;
  endWordIndex: number;
  tokens: string[];
};

/**
 * One display string per word, cut on word boundaries.
 *
 * A page's startWordIndex and endWordIndex index the word states, so the tokens on a page
 * have to be the same things the word states are, in the same order. Splitting on whitespace
 * is not: it makes "well-known" one token where the matcher sees two words, and "100" a token
 * where the matcher sees none, and from the first such token onwards the reading view
 * highlights the wrong word and the error grows with the passage.
 *
 * Each token runs from the start of its word to the start of the next, so punctuation,
 * numbers, dashes and spacing stay attached to the word before them and nothing is lost from
 * what the child reads. Anything before the first word joins the first token.
 */
function displayTokensByWord(text: string): string[] {
  const matches: { index: number }[] = [];
  const scan = new RegExp(READING_WORD_PATTERN.source, "g");
  for (let match = scan.exec(text); match !== null; match = scan.exec(text)) matches.push({ index: match.index });
  if (!matches.length) return [];
  return matches.map((match, index) => {
    const from = index === 0 ? 0 : match.index;
    const to = index === matches.length - 1 ? text.length : matches[index + 1].index;
    return text.slice(from, to);
  });
}

/** Splits a story into readable page-sized segments while favouring sentence boundaries. */
export function createReadingPages(text: string, maxWordsPerPage = 42): ReadingPage[] {
  const tokens = displayTokensByWord(text);
  if (!tokens.length) return [{ startWordIndex: 0, endWordIndex: -1, tokens: [] }];

  const pages: ReadingPage[] = [];
  let start = 0;
  while (start < tokens.length) {
    let end = Math.min(start + maxWordsPerPage, tokens.length);
    if (end < tokens.length) {
      const minimumSentenceSearch = start + Math.min(12, Math.max(3, maxWordsPerPage - 14));
      for (let index = end - 1; index >= minimumSentenceSearch; index -= 1) {
        if (/[.!?][”"']?\s*$/.test(tokens[index])) {
          end = index + 1;
          break;
        }
      }
    }
    pages.push({ startWordIndex: start, endWordIndex: end - 1, tokens: tokens.slice(start, end) });
    start = end;
  }
  return pages;
}

/**
 * Whether the reader has finished with this page.
 *
 * A miscue is something to record, not a gate. A running record notes that a word was
 * misread and the reader carried on; it does not stop the reading until the word is fixed.
 * The rule used to demand that every word on the page be settled, which meant one word the
 * recogniser never caught — "a" and "at" are the usual ones, short and unstressed — held the
 * child on that page for the rest of the session. Repeating the word could not clear it
 * either: the transcript is matched from the beginning in order, so a word said again after
 * the reader has moved on lands against a later part of the passage and never reaches the
 * word it was meant to fix.
 */
export function isReadingPageComplete(page: ReadingPage | undefined, states: LiveWordState[], mode: "GUIDED_PRACTICE" | "ASSISTED_PRACTICE" | "MONTHLY_ASSESSMENT"): boolean {
  if (!page || page.endWordIndex < page.startWordIndex) return false;
  const pageStates = states.slice(page.startWordIndex, page.endWordIndex + 1);
  if (!pageStates.length) return false;

  // The furthest word on this page the reader has actually read. Anything flagged before it
  // is behind them.
  let lastRead = -1;
  pageStates.forEach((state, index) => {
    if (state.status === "correct" || state.status === "retried_correct") lastRead = index;
  });

  return pageStates.every((state, index) => {
    if (state.status === "correct" || state.status === "retried_correct") return true;
    // Not reached yet, or the word the reader is on right now.
    if (state.status === "unread" || state.status === "current") return false;
    if (mode === "MONTHLY_ASSESSMENT") return true;
    // Left deliberately, or genuinely tried three times.
    if (state.movedOn === true || state.attempts >= 3) return true;
    // Read past: a later word on this page has been read aloud, so the reader has gone by.
    return index < lastRead;
  });
}

/**
 * The word the reader is actually on, if any.
 *
 * Not simply "the first flagged word". Once a later word on the page has been read aloud,
 * the reader has gone past the flagged one and is somewhere else; continuing to point a
 * "tap this word to hear it" prompt at it tells them to fix something they have left behind,
 * and reads as the screen refusing to let them continue. It is also advice they cannot act
 * on: repeating a word out of sequence never re-matches it, because the transcript is
 * aligned from the beginning in order.
 */
export function activeRetryWord(
  pageStates: LiveWordState[],
  mode: "GUIDED_PRACTICE" | "ASSISTED_PRACTICE" | "MONTHLY_ASSESSMENT",
): LiveWordState | undefined {
  if (mode === "MONTHLY_ASSESSMENT") return undefined;
  const current = pageStates.find(state => state.status === "current");
  if (current) return current;
  let lastRead = -1;
  pageStates.forEach((state, index) => {
    if (state.status === "correct" || state.status === "retried_correct") lastRead = index;
  });
  return pageStates.find((state, index) =>
    state.status === "incorrect" && state.movedOn !== true && state.attempts < 3 && index > lastRead);
}
