import type { AssessmentMode, StoredWordState } from "../drizzle/schema";
import { isPaceMeaningful } from "../shared/readingPace";
import { matchExpectedReadingWord, type EducatorApprovedIrishVariant, type ReadingLanguageSupport } from "../shared/dialectSupport";

export type ReadingEventKind = "correct" | "dialect_variation" | "substitution" | "omission" | "insertion" | "repetition";
export type ReadingEvent = { expectedWord: string; recognisedWord: string | null; eventType: ReadingEventKind; action: "celebrate" | "stay_silent" | "practise_gently" | "teacher_review"; provisionalIrishEnglish?: boolean; variantSource?: "built_in" | "educator_approved" };
export type WordState = StoredWordState;

export type ReadingAnalysis = {
  transcript: string; mode: AssessmentMode; accuracy: number; firstPassAccuracy: number; pace: number; firstPassWcpm: number;
  correctWords: number; firstPassCorrectWords: number; totalWords: number; durationSeconds: number;
  /** False when the read was too short for words-per-minute to carry meaning. */
  paceReliable: boolean; practiceWords: string[];
  events: ReadingEvent[]; wordStates: WordState[]; retrySummary: { word: string; retries: number }[]; selfCorrections: string[];
  modelWords: string[]; childMessage: string; nextStep: string;
};

export const assessmentModes: Record<AssessmentMode, { label: string; shortLabel: string; description: string }> = {
  ASSISTED_PRACTICE: { label: "Practice with Corrections", shortLabel: "Assisted Practice", description: "Helpful corrections and optional retries are shown as you practise." },
  GUIDED_PRACTICE: { label: "Practice with a Reading Coach", shortLabel: "Guided Practice", description: "After two tricky tries, the coach pauses and models the word before your next attempt." },
  MONTHLY_ASSESSMENT: { label: "Monthly Assessment", shortLabel: "Monthly Assessment", description: "Your first read is recorded quietly for your teacher to review later." },
};

const wordPattern = /[a-zA-Z]+(?:'[a-zA-Z]+)?/g;
export function tokenize(text: string): string[] { return (text.toLowerCase().match(wordPattern) ?? []).map(word => word.replace(/[^a-z']/g, "")); }
export function initialiseWordStates(text: string): WordState[] { return tokenize(text).map((word, index) => ({ id: `word-${index}`, text: word, status: index === 0 ? "current" : "unread", attempts: 0 })); }
function displayWord(word: string): string { return word.length ? word[0].toUpperCase() + word.slice(1) : "that word"; }
function eventAction(mode: AssessmentMode, kind: ReadingEventKind): ReadingEvent["action"] {
  if (kind === "dialect_variation") return "teacher_review";
  if (mode === "MONTHLY_ASSESSMENT") return kind === "correct" ? "celebrate" : "teacher_review";
  if (kind === "correct") return "celebrate";
  if (kind === "insertion" || kind === "repetition") return "stay_silent";
  return "practise_gently";
}
function mergeAttemptHistory(states: WordState[], attemptedStates: WordState[] | undefined, mode: AssessmentMode): WordState[] {
  if (mode === "MONTHLY_ASSESSMENT" || !attemptedStates?.length) return states;
  const recorded = new Map(attemptedStates.map(state => [state.id, state]));
  return states.map(state => {
    const attempt = recorded.get(state.id);
    if (!attempt || attempt.text !== state.text || attempt.attempts <= state.attempts) return state;
    return { ...state, attempts: attempt.attempts, status: state.status === "correct" || attempt.status === "retried_correct" ? "retried_correct" : state.status };
  });
}

/** Transparent transcript comparison; it records practice/review signals, not a reading diagnosis. */
export function analyseReadingText(expectedText: string, transcript: string, durationSeconds: number, mode: AssessmentMode = "ASSISTED_PRACTICE", attemptedStates?: WordState[], languageSupport: ReadingLanguageSupport = "STANDARD_ENGLISH", educatorApprovedVariants: EducatorApprovedIrishVariant[] = []): ReadingAnalysis {
  const expected = tokenize(expectedText); const observed = tokenize(transcript); const states = initialiseWordStates(expectedText); const events: ReadingEvent[] = [];
  let expectedIndex = 0; let observedIndex = 0; let correctWords = 0; let firstPassCorrectWords = 0;
  while (expectedIndex < expected.length && observedIndex < observed.length) {
    const target = expected[expectedIndex]; const heard = observed[observedIndex]; const state = states[expectedIndex];
    const matched = matchExpectedReadingWord(target, heard, languageSupport, educatorApprovedVariants);
    if (matched.matches) {
      state.attempts += 1; state.status = state.status === "incorrect" ? "retried_correct" : "correct"; correctWords += 1;
      if (state.attempts === 1) firstPassCorrectWords += 1;
      const eventType: ReadingEventKind = matched.provisionalIrishEnglish ? "dialect_variation" : "correct";
      events.push({ expectedWord: target, recognisedWord: heard, eventType, action: eventAction(mode, eventType), provisionalIrishEnglish: matched.provisionalIrishEnglish || undefined, variantSource: matched.source }); expectedIndex += 1; observedIndex += 1; continue;
    }
    if (observedIndex + 1 < observed.length && matchExpectedReadingWord(target, observed[observedIndex + 1], languageSupport, educatorApprovedVariants).matches) { events.push({ expectedWord: target, recognisedWord: null, eventType: "insertion", action: eventAction(mode, "insertion") }); observedIndex += 1; continue; }
    state.attempts += 1; state.status = "incorrect";
    const kind: ReadingEventKind = expectedIndex + 1 < expected.length && matchExpectedReadingWord(expected[expectedIndex + 1], heard, languageSupport, educatorApprovedVariants).matches ? "omission" : "substitution";
    events.push({ expectedWord: target, recognisedWord: kind === "omission" ? null : heard, eventType: kind, action: eventAction(mode, kind) });
    if (kind === "omission") expectedIndex += 1; else { expectedIndex += 1; observedIndex += 1; }
  }
  while (expectedIndex < expected.length) { const state = states[expectedIndex]; state.attempts += 1; state.status = "incorrect"; events.push({ expectedWord: expected[expectedIndex], recognisedWord: null, eventType: "omission", action: eventAction(mode, "omission") }); expectedIndex += 1; }
  const resolvedStates = mergeAttemptHistory(states, attemptedStates, mode);
  const retrySummary = resolvedStates.filter(state => state.attempts > 1).map(state => ({ word: state.text, retries: state.attempts - 1 }));
  const selfCorrections = resolvedStates.filter(state => state.status === "retried_correct").map(state => state.text);
  const notableEvents = events.filter(event => event.eventType === "substitution" || event.eventType === "omission");
  const skippedPracticeWords = resolvedStates.filter(state => state.status === "incorrect" && state.attempts >= 3).map(state => state.text);
  const practiceWords = mode === "MONTHLY_ASSESSMENT" ? [] : Array.from(new Set([...skippedPracticeWords, ...notableEvents.map(event => event.expectedWord)].filter(word => word.length > 3))).slice(0, 3);
  const modelWords = mode === "GUIDED_PRACTICE" ? resolvedStates.filter(state => state.status === "incorrect" && state.attempts >= 2).map(state => state.text) : [];
  // Record the duration as it was read and guard only the division. The previous floor of
  // twenty seconds rewrote a short read into a longer one, so a three-second reading was
  // stored and shown to a teacher as "20s" with a WCPM to match: a fabricated number in the
  // record, invented to keep the pace figure inside a comfortable range. A short sample is
  // now reported as a short sample instead.
  const recordedDuration = Math.max(0, Math.round(Number.isFinite(durationSeconds) ? durationSeconds : 0));
  const effectiveDuration = Math.max(1, recordedDuration);
  const firstPassAccuracy = expected.length ? Math.round((firstPassCorrectWords / expected.length) * 100) : 0;
  const assistedAccuracy = expected.length ? Math.round((correctWords / expected.length) * 100) : 0;
  const accuracy = mode === "MONTHLY_ASSESSMENT" ? firstPassAccuracy : assistedAccuracy;
  const firstPassWcpm = Math.max(0, Math.round((firstPassCorrectWords / effectiveDuration) * 60));
  const pace = mode === "MONTHLY_ASSESSMENT" ? firstPassWcpm : Math.max(0, Math.round((correctWords / effectiveDuration) * 60));
  const childMessage = mode === "MONTHLY_ASSESSMENT" ? "You completed your monthly reading check with calm focus. Your teacher will review it with you." : selfCorrections.length ? "You noticed a tricky word and had another go. That is what thoughtful readers do." : accuracy >= 92 ? "Wonderful focus. You kept the story moving and made your voice clear." : "You stayed with a tricky text, and that is how strong readers grow.";
  const nextStep = mode === "MONTHLY_ASSESSMENT" ? "No correction prompts were used during this first-pass reading check." : practiceWords[0] ? `Try “${displayWord(practiceWords[0])}” slowly once, then pop it back into the sentence.` : "Choose one sentence you enjoyed and read it again with a smooth, steady voice.";
  return { transcript: transcript.trim(), mode, accuracy, firstPassAccuracy, pace, firstPassWcpm, correctWords, firstPassCorrectWords, totalWords: expected.length, durationSeconds: recordedDuration, paceReliable: isPaceMeaningful(recordedDuration), practiceWords, events, wordStates: resolvedStates, retrySummary, selfCorrections, modelWords, childMessage, nextStep };
}

export type ReaderRole = "child" | "teacher" | "parent";
export function mayViewChildProgress(viewer: ReaderRole, profileId: string, linkedProfileIds: string[]): boolean { return viewer === "teacher" || linkedProfileIds.includes(profileId); }
