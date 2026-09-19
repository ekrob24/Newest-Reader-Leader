export type LiveAssessmentMode = "GUIDED_PRACTICE" | "ASSISTED_PRACTICE" | "MONTHLY_ASSESSMENT";
export type LiveWordState = {
  id: string; text: string;
  status: "unread" | "current" | "correct" | "incorrect" | "retried_correct";
  attempts: number;
  /** The child chose to leave this word and keep reading. Recorded as its own fact, so the
   *  page can move on without anyone inventing a number of attempts that did not happen. */
  movedOn?: boolean;
};
import { matchExpectedReadingWord, type EducatorApprovedIrishVariant, type ReadingLanguageSupport } from "./dialectSupport";

const wordPattern = /[a-zA-Z]+(?:'[a-zA-Z]+)?/g;
const normalise = (word: string) => word.toLowerCase().replace(/[^a-z']/g, "");
const tokenize = (text: string) => (text.match(wordPattern) ?? []).map(normalise);

export function initialLiveWordStates(text: string): LiveWordState[] {
  return tokenize(text).map((word, index) => ({ id: `word-${index}`, text: word, status: index === 0 ? "current" : "unread", attempts: 0 }));
}

/** Applies the current full live-transcript result against the expected passage. */
export function deriveLiveWordStates(expectedText: string, transcript: string, mode: LiveAssessmentMode, languageSupport: ReadingLanguageSupport = "STANDARD_ENGLISH", educatorApprovedVariants: EducatorApprovedIrishVariant[] = [], movedOnAttempts: ReadonlyMap<string, number> = new Map()): LiveWordState[] {
  const states = initialLiveWordStates(expectedText);
  let expectedIndex = 0;
  const heardWords = tokenize(transcript);
  let heardIndex = 0;
  while (heardIndex < heardWords.length) {
    while (expectedIndex < states.length && movedOnAttempts.has(states[expectedIndex].id)) {
      states[expectedIndex].status = "incorrect";
      const priorAttempts = movedOnAttempts.get(states[expectedIndex].id) ?? 1;
      // The real number of tries, not a floor of three. This used to record three attempts
      // for a word a child tried once, purely so the page-completion rule would let them
      // past — a fabricated count in the running record, to work around a stuck screen.
      states[expectedIndex].attempts = priorAttempts;
      states[expectedIndex].movedOn = true;
      heardIndex += priorAttempts;
      expectedIndex += 1;
    }
    const state = states[expectedIndex];
    if (!state) break;
    // Skipping past moved-on words above can carry heardIndex beyond what was actually
    // heard. Reading past the end handed undefined to the matcher, which threw inside the
    // effect that derives these states — React unmounted the reading view and the screen
    // stopped responding. That is what "it freezes when it flags a word" was.
    if (heardIndex >= heardWords.length) break;
    const heardWord = heardWords[heardIndex];
    const matches = matchExpectedReadingWord(state.text, heardWord, languageSupport, educatorApprovedVariants).matches;
    const nextState = states[expectedIndex + 1];
    const followsAnIncorrectWord = mode !== "MONTHLY_ASSESSMENT" && state.status === "incorrect" && nextState && matchExpectedReadingWord(nextState.text, heardWord, languageSupport, educatorApprovedVariants).matches;
    if (followsAnIncorrectWord) {
      nextState.attempts += 1;
      nextState.status = "correct";
      expectedIndex += 2;
      heardIndex += 1;
      continue;
    }
    state.attempts += 1;
    if (mode === "MONTHLY_ASSESSMENT") {
      state.status = matches ? "correct" : "incorrect";
      expectedIndex += 1;
    } else if (matches) {
      state.status = state.attempts > 1 ? "retried_correct" : "correct";
      expectedIndex += 1;
    } else {
      state.status = "incorrect";
    }
    heardIndex += 1;
  }
  for (let index = 0; index < states.length; index += 1) {
    if (!movedOnAttempts.has(states[index].id)) continue;
    states[index].status = "incorrect";
    states[index].attempts = movedOnAttempts.get(states[index].id) ?? 1;
    states[index].movedOn = true;
  }
  while (expectedIndex < states.length && movedOnAttempts.has(states[expectedIndex].id)) expectedIndex += 1;
  if (expectedIndex < states.length && states[expectedIndex].status === "unread") states[expectedIndex].status = "current";
  return states;
}

export function firstGuidedModelWord(states: LiveWordState[], modelledWordIds: ReadonlySet<string>) {
  return states.find(state => state.status === "incorrect" && state.attempts >= 2 && !modelledWordIds.has(state.id));
}

/**
 * Keep a word that has already been read correctly.
 *
 * Word states are recomputed from the whole transcript every time it changes, so a later
 * revision of the transcript can take a word away again. A child watched a word turn green,
 * then red, then green, in a loop. Pedagogically that is also simply wrong: they read it,
 * and a recogniser changing its mind afterwards is not the child unreading it.
 *
 * Only ever holds a word at "read correctly". A word that has not been read yet, or that the
 * child is working on, follows the new state, so this cannot freeze the reading in place.
 */
export function keepWordsAlreadyRead(previous: LiveWordState[], next: LiveWordState[]): LiveWordState[] {
  const held = new Map(previous.filter(state => state.status === "correct" || state.status === "retried_correct").map(state => [state.id, state]));
  return next.map(state => {
    const earlier = held.get(state.id);
    if (!earlier) return state;
    if (state.status === "correct" || state.status === "retried_correct") return state;
    // Carry the attempts forward if the newer reading saw more of them.
    return { ...earlier, attempts: Math.max(earlier.attempts, state.attempts) };
  });
}
