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

/** Returns true only when every word on the current page has been settled for that mode. */
export function isReadingPageComplete(page: ReadingPage | undefined, states: LiveWordState[], mode: "GUIDED_PRACTICE" | "ASSISTED_PRACTICE" | "MONTHLY_ASSESSMENT"): boolean {
  if (!page || page.endWordIndex < page.startWordIndex) return false;
  return states.slice(page.startWordIndex, page.endWordIndex + 1).every(state => {
    if (state.status === "correct" || state.status === "retried_correct") return true;
    if (state.status !== "incorrect") return false;
    if (mode === "MONTHLY_ASSESSMENT") return true;
    // A word the child chose to leave, or one they have genuinely tried three times.
    // Deciding this on attempts alone is what trapped a misheard reader: the speech
    // recogniser flags a word after one attempt, and until this returned true there was
    // no way forward on the page at all.
    return state.movedOn === true || state.attempts >= 3;
  });
}
