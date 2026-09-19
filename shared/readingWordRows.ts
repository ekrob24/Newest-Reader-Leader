/**
 * Turns one saved session's JSON evidence into one row per word of reading opportunity.
 *
 * This is additive: `wordStates`, `wordTimings` and `interventions` keep being written exactly
 * as before, and these rows are derived from the same evidence so the two describe the same
 * reading. The JSON stays the source until everything downstream reads the table.
 */
import type { StoredIntervention, StoredWordState, StoredWordTiming, WordJudgement, WordProgress, WordResolution, PronunciationContext } from "../drizzle/schema";

/** Who produced these judgements, recorded per word so a provider change stays readable. */
export type ReadingWordProvenance = {
  provider: string;
  providerVersion: string;
  policyVersion: string;
};

export type ReadingWordRow = {
  wordEventId: string;
  tokenIndex: number;
  referenceWord: string;
  heardWord: string | null;
  progress: WordProgress;
  judgement: WordJudgement;
  resolution: WordResolution;
  pronunciationContext: PronunciationContext;
  attempts: number;
  startMs: number | null;
  endMs: number | null;
  dialectFeature: string | null;
  source: string;
  /**
   * All four are null. This pipeline aligns transcript text deterministically and has no
   * acoustic, alignment, lexical or pronunciation score to report; inventing one would defeat
   * the reason there are four rather than one. They are columns now so that an engine which
   * does supply them needs no migration.
   */
  audioConfidence: null;
  alignmentConfidence: null;
  lexicalConfidence: null;
  pronunciationConfidence: null;
} & ReadingWordProvenance;

/** A dialect variation is a correct reading in the child's dialect, not a miscue. */
function judgementFor(eventType: StoredIntervention["eventType"]): WordJudgement {
  switch (eventType) {
    case "substitution": return "substitution";
    case "omission": return "omission";
    case "insertion": return "insertion";
    case "repetition": return "repetition";
    case "correct": return "correct";
    case "dialect_variation": return "correct";
    // An intervention with no event type tells us something was flagged but not what, which
    // is exactly what `uncertain` is for: hold it open rather than harden it into a miscue.
    default: return "uncertain";
  }
}

function contextFor(intervention: StoredIntervention | undefined): PronunciationContext {
  if (!intervention) return "uncertain";
  if (intervention.eventType === "dialect_variation" || intervention.provisionalIrishEnglish) return "valid_regional_variant";
  if (intervention.eventType === "substitution" || intervention.eventType === "omission") return "not_matched";
  return "uncertain";
}

function resolutionFor(intervention: StoredIntervention | undefined): WordResolution {
  // No intervention means the system settled the word without flagging it.
  if (!intervention) return "auto";
  if (intervention.teacherDecision === "confirmed") return "teacher_confirmed";
  if (intervention.teacherDecision === "overridden") return "teacher_overridden";
  return "unreviewed";
}

/**
 * Which word row each intervention belongs to, by word event id.
 *
 * Interventions are keyed by word text rather than by id, so a passage that repeats a word
 * has to consume them in order. That matching rule lives here once, because two callers need
 * it and they must not disagree: the row builder at save time, and the teacher override,
 * which has to move the same row's resolution. If they matched differently, a teacher's
 * decision would land on a different word from the one they decided about.
 */
export function interventionsByWordEventId(wordStates: StoredWordState[], interventions: StoredIntervention[]): Map<string, StoredIntervention> {
  const pending = new Map<string, StoredIntervention[]>();
  for (const intervention of interventions) {
    const key = intervention.word.toLowerCase();
    const list = pending.get(key) ?? [];
    list.push(intervention);
    pending.set(key, list);
  }
  const matched = new Map<string, StoredIntervention>();
  for (const state of wordStates) {
    const intervention = pending.get(state.text.toLowerCase())?.shift();
    if (intervention) matched.set(state.id, intervention);
  }
  return matched;
}

/** The resolution each word row should carry, given the interventions as they stand now. */
export function resolutionsByWordEventId(wordStates: StoredWordState[], interventions: StoredIntervention[]): Map<string, WordResolution> {
  const matched = interventionsByWordEventId(wordStates, interventions);
  return new Map(wordStates.map(state => [state.id, resolutionFor(matched.get(state.id))]));
}

export function buildReadingWordRows(input: {
  wordStates: StoredWordState[];
  wordTimings?: StoredWordTiming[] | null;
  interventions: StoredIntervention[];
  provenance: ReadingWordProvenance;
  dialectFeatureFor?: (word: string) => string | null;
}): ReadingWordRow[] {
  const timingById = new Map((input.wordTimings ?? []).map(timing => [timing.id, timing]));

  const matched = interventionsByWordEventId(input.wordStates, input.interventions);

  return input.wordStates.map((state, tokenIndex) => {
    const intervention = matched.get(state.id);
    const timing = timingById.get(state.id);
    return {
      wordEventId: state.id,
      tokenIndex,
      referenceWord: state.text,
      heardWord: intervention?.heardWord ?? null,
      progress: state.status,
      judgement: intervention ? judgementFor(intervention.eventType) : "correct",
      resolution: resolutionFor(intervention),
      pronunciationContext: contextFor(intervention),
      attempts: state.attempts,
      startMs: timing?.startMs ?? null,
      endMs: timing?.endMs ?? null,
      dialectFeature: input.dialectFeatureFor?.(state.text) ?? null,
      source: intervention?.provisionalIrishEnglish ? "educator_approved" : "built_in",
      audioConfidence: null,
      alignmentConfidence: null,
      lexicalConfidence: null,
      pronunciationConfidence: null,
      ...input.provenance,
    };
  });
}
