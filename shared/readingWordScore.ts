/**
 * Whether a word counts against a child's score.
 *
 * DERIVED, never stored. A stored flag is how a teacher's override and the displayed accuracy
 * drift apart: the override updates one row, the flag keeps the old answer, and the number on
 * screen quietly stops matching the decision a teacher made. So this is computed from
 * `judgement` and `resolution` every time it is needed.
 *
 * Two independent questions:
 *
 *  1. Is this judgement the kind of thing that can be an error at all?
 *     Substitutions, omissions and insertions are miscues in a running record.
 *     Repetitions, hesitations and self-corrections are not — a self-correction is
 *     pedagogically a strength, a child noticing and repairing their own reading, and
 *     scoring it as an error would punish exactly the behaviour we want. `uncertain` is not
 *     an error either: it is how low-confidence evidence is held open rather than hardened
 *     into a judgement about a child.
 *
 *  2. Has a human settled it?
 *     Only a teacher-confirmed miscue counts. A machine judgement no human has checked must
 *     not enter a child's record, and a teacher who overrules the machine has the last word.
 */
import type { WordJudgement, WordProgress, WordResolution } from "../drizzle/schema";

/** Judgements that are miscues in a running record. Everything else can never count. */
const ERROR_JUDGEMENTS: ReadonlySet<WordJudgement> = new Set<WordJudgement>([
  "substitution",
  "omission",
  "insertion",
]);

export function isErrorJudgement(judgement: WordJudgement): boolean {
  return ERROR_JUDGEMENTS.has(judgement);
}

/**
 * The single place that decides whether a word reduces accuracy.
 *
 * Note on `auto`: an auto-resolved miscue does NOT count. `auto` means the system settled the
 * word without a human, and the rule above is that an unchecked machine judgement stays out
 * of a child's record; `auto` is for words the system resolved as non-errors. If a miscue is
 * ever to be auto-resolved AND counted, that is a policy decision to be made deliberately,
 * not by the default falling one way.
 */
export function countsAgainstScore(word: { judgement: WordJudgement; resolution: WordResolution }): boolean {
  if (!isErrorJudgement(word.judgement)) return false;
  return word.resolution === "teacher_confirmed";
}

/**
 * Words the analyser judged misread and the record then stored as correct.
 *
 * `buildInterventions` keeps only the first five non-correct events. Every expected word still
 * becomes a row, but a word with no surviving intervention is written with judgement
 * `correct`, so from the sixth error onward the judgement is discarded and the word is
 * recorded as read correctly.
 *
 * The harm is not evenly spread. A child with three errors has all three recorded; a child
 * with nineteen has fourteen stored as correct. The worse the reading, the better the record
 * looks - and the teacher cannot overrule what she is never shown. A reading assessment that
 * reports its weakest readers as perfect is the inverse of what it is for.
 *
 * The discarded ones are still identifiable, because `progress` carries what the analyser
 * decided about the word independently of whether an intervention survived: a row that is
 * `incorrect` on progress and not an error on judgement is one of them. That is what this
 * counts, and it needs nothing stored that is not stored already.
 */
export function discardedErrorCount(words: ReadonlyArray<{ judgement: WordJudgement; progress?: WordProgress }>): number {
  return words.filter(word => word.progress === "incorrect" && !isErrorJudgement(word.judgement)).length;
}

/**
 * Accuracy over words with a settled outcome. Null when nothing has been settled, and null
 * when the record is known to be incomplete.
 *
 * A reading that discarded errors cannot produce an accuracy figure at all. The arithmetic
 * would run perfectly well and give an answer that is wrong in a specific direction - too
 * high, by exactly the errors nobody kept - so the only honest output is no number.
 */
export function accuracyFromWords(words: ReadonlyArray<{ judgement: WordJudgement; resolution: WordResolution; progress?: WordProgress }>): number | null {
  if (!words.length) return null;
  if (discardedErrorCount(words) > 0) return null;
  const counted = words.filter(countsAgainstScore).length;
  return Math.round(((words.length - counted) / words.length) * 100);
}

/**
 * Whether a teacher has finished reviewing this reading.
 *
 * There is no reviewed flag on a reading session. This is inferred, and it has to be, because
 * the only record of review is per word: `resolution` on each row. Inferring it is not free —
 * it means "review is complete" is a derived claim that could go wrong if a new resolution
 * value is added and not considered here — but a stored flag would be the same drift
 * `countsAgainstScore` exists to avoid, so it is the better of the two.
 *
 * Complete means every word that could be a miscue has had a human decide. A word whose
 * judgement can never be an error needs no decision. A miscue left `unreviewed`, or resolved
 * `auto` — which means the system settled it without a human — is not decided.
 *
 * A reading with no words at all returns false rather than true: nothing is known about it,
 * and vacuous completeness is how a figure gets published for a reading nobody has seen.
 */
export function isReviewComplete(words: ReadonlyArray<{ judgement: WordJudgement; resolution: WordResolution; progress?: WordProgress }>): boolean {
  if (!words.length) return false;
  // A reading that discarded errors can never be completely reviewed, because the words that
  // would need reviewing are not on the teacher's screen and are not in the record as errors.
  // Reporting it complete would publish a figure built on words nobody could have checked.
  if (discardedErrorCount(words) > 0) return false;
  return words.every(word =>
    !isErrorJudgement(word.judgement)
    || word.resolution === "teacher_confirmed"
    || word.resolution === "teacher_overridden");
}

/** Words not counting against the reading once the teacher's decisions are applied. */
export function settledCorrectWordCount(words: ReadonlyArray<{ judgement: WordJudgement; resolution: WordResolution }>): number {
  return words.length - words.filter(countsAgainstScore).length;
}
