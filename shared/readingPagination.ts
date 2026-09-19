import type { LiveWordState } from "./liveWordStates";

export type ReadingPage = {
  startWordIndex: number;
  endWordIndex: number;
  tokens: string[];
};

const tokenPattern = /\S+\s*/g;

/** Splits a story into readable page-sized segments while favouring sentence boundaries. */
export function createReadingPages(text: string, maxWordsPerPage = 42): ReadingPage[] {
  const tokens = text.match(tokenPattern) ?? [];
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
