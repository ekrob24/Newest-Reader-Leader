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
import type { WordJudgement, WordResolution } from "../drizzle/schema";

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

/** Accuracy over words with a settled outcome. Returns null when nothing has been settled. */
export function accuracyFromWords(words: ReadonlyArray<{ judgement: WordJudgement; resolution: WordResolution }>): number | null {
  if (!words.length) return null;
  const counted = words.filter(countsAgainstScore).length;
  return Math.round(((words.length - counted) / words.length) * 100);
}
