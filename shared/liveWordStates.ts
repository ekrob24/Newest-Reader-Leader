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

/**
 * How far ahead the cursor looks for the word it just heard.
 *
 * Chosen from a sweep over the real passage, not from taste. Recovery and cost both move with
 * it, in opposite directions, and 3 is where they cross:
 *
 *   k=1  a single dropped word recovers, two dropped in a row still collapse to 14%
 *   k=2  two in a row recover (95%), three in a row still collapse (14%)
 *   k=3  three in a row recover (93%), and a child who repeats three words is still 100%
 *   k=4  four in a row recover, but the repeated-words case falls to 86%
 *   k=10 the same recovery, and the repeated-words case falls to 67%
 *
 * The cost is not hypothetical: this passage contains "the" five times, so a wide enough
 * window reaches a later copy of a word the child has not got to yet, jumps there, and marks
 * everything in between as unread. k=4 is where that starts. 3 is therefore the largest value
 * that buys recovery for nothing, and the run it does not survive - four dropped words in a
 * row - is a reading that has gone wrong in a way no cursor should paper over.
 *
 * The full sweep is reproduced in shared/reanchoring.test.ts.
 */
export const REANCHOR_LOOKAHEAD = 3;

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
      // Bounded re-anchoring.
      //
      // This branch used to leave expectedIndex where it was. One word the recogniser dropped
      // - and in connected speech that is almost always a function word, "a" being a fifty
      // millisecond unstressed schwa - pinned the cursor for the rest of the reading. Every
      // following word, correctly said and correctly heard, was compared against the wrong
      // expected word and marked incorrect. Measured on the real passage: one dropped "a" took
      // the highlight from 42 of 42 words to 3.
      //
      // So when the heard word does not match here, look a little way ahead for one it does
      // match. If it is there, the child has moved on and the words in between were not read:
      // mark them and follow her. If it is not, keep the old behaviour - she is saying
      // something that is not in the next few words of the passage, and guessing would be
      // worse than waiting.
      let jump = 0;
      for (let ahead = 1; ahead <= REANCHOR_LOOKAHEAD; ahead += 1) {
        const candidate = states[expectedIndex + ahead];
        // Deliberately no special case for a word the child moved on from. A guard here was
        // measured and removed: it cost eleven words of recovery on a transcript that needed
        // to re-anchor past one, and protected nothing, because the pass at the end of this
        // function re-asserts every moved-on word's status and attempt count regardless.
        if (!candidate) break;
        if (matchExpectedReadingWord(candidate.text, heardWord, languageSupport, educatorApprovedVariants).matches) {
          jump = ahead;
          break;
        }
      }
      if (jump > 0) {
        for (let skipped = 1; skipped < jump; skipped += 1) {
          const passed = states[expectedIndex + skipped];
          passed.status = "incorrect";
          passed.attempts += 1;
        }
        state.status = "incorrect";
        const landed = states[expectedIndex + jump];
        landed.attempts += 1;
        landed.status = landed.attempts > 1 ? "retried_correct" : "correct";
        expectedIndex += jump + 1;
      } else {
        state.status = "incorrect";
      }
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

/**
 * Where the reader is, as distinct from how she is doing.
 *
 * Judgement - correct, incorrect, self-corrected - comes from finalised results only, because
 * interim results are the recogniser thinking aloud and colouring from them turned a word
 * green, then red, then green. Position has the opposite requirement. One instrumented read
 * emitted nine finals across seventy-eight seconds, one of them 16,512ms after the interim
 * that first carried its words, so a cursor waiting for finals sits twenty words behind a
 * child reading perfectly well - which is what "does not keep up" is.
 *
 * This was tried once before and reverted, because it made the cursor flick between the word
 * being read and the last word on the page. Two causes, both fixed here rather than papered
 * over:
 *
 *   The cursor was clamped into the visible page. Position runs ahead of the page, because the
 *   page used to turn only on finals, so the clamp parked the cursor on the page's last word.
 *   There is no clamp now; the page follows the cursor instead.
 *
 *   The interim blanks constantly - between revisions, and on the event that carries a final -
 *   and position fell back to the finals each time, snapping the cursor backwards. It is now
 *   monotonic within a reading: `advanceReadingPosition` never returns a smaller index, so a
 *   blank interim leaves the cursor where it was instead of yanking it back.
 */
export function liveReadingPosition(states: LiveWordState[]): number {
  const at = states.findIndex(state => state.status === "current");
  return at === -1 ? states.length : at;
}

/**
 * The cursor only ever moves forwards during a reading.
 *
 * A recogniser that revises itself downwards is not the child un-reading a word. Restarting
 * the reading resets the cursor; nothing else moves it back.
 */
export function advanceReadingPosition(previousIndex: number, nextIndex: number): number {
  return Math.max(previousIndex, nextIndex);
}

/**
 * Which class a word wears, given the two streams kept apart above.
 *
 *   Judgement always wins. A word the finals have settled keeps its settled colour, cursor or
 *   no cursor, so an interim can never repaint a word green or red.
 *   The cursor only ever marks a word nothing has judged yet.
 *   A monthly assessment shows the cursor and nothing else. That mode is meant to be quiet.
 *
 * `settled` is the status from the finals-only derivation; "current" there is just the word
 * after the last final, so it reads as unjudged rather than drawing a second cursor.
 */
export function readerWordClass(settled: LiveWordState["status"] | undefined, atCursor: boolean, mode: LiveAssessmentMode): string {
  const judgement = settled ?? "unread";
  const unjudged = judgement === "unread" || judgement === "current";
  if (mode === "MONTHLY_ASSESSMENT") return atCursor ? "current" : "";
  if (atCursor && unjudged) return "current";
  return unjudged ? "unread" : judgement;
}
