/** Words correct per minute is an extrapolation. Over a very short sample the extrapolation
 *  dominates the measurement — five words read in three seconds is 100 WCPM, which says almost
 *  nothing about the reader and a great deal about the arithmetic.
 *
 *  The old code handled this by raising any duration under twenty seconds to twenty, which
 *  produced a comfortable pace figure by storing a reading time that never happened. The
 *  threshold was not the mistake; using it to rewrite the record was. It now marks the pace as
 *  an unreliable sample and leaves the duration exactly as it was read. */
export const PACE_MIN_SAMPLE_SECONDS = 20;

export function isPaceMeaningful(durationSeconds: number) {
  return Number.isFinite(durationSeconds) && durationSeconds >= PACE_MIN_SAMPLE_SECONDS;
}

/** One line for any surface that shows a WCPM figure from a short read. */
export function shortSampleNote(durationSeconds: number) {
  if (isPaceMeaningful(durationSeconds)) return null;
  return `This read lasted ${Math.max(0, Math.round(durationSeconds))}s, which is too short for reading speed to mean much. The words and accuracy still count.`;
}

/**
 * Words correct per minute, from the words a teacher has confirmed.
 *
 * A running record's WCPM has always meant words the assessor counted as correct. A
 * machine-derived one was the deviation; this is the measure itself.
 *
 * Returns null — an em dash on screen — in three cases, and they are different kinds of
 * "we do not know":
 *
 *   the reading has not been fully reviewed. A figure from "confirmed so far" is a new
 *   unfounded assertion wearing the old one's clothes, and it would move under a parent's
 *   feet as the teacher worked through the flags. The em dash holds until the last flagged
 *   word has a decision, not until the first.
 *
 *   the sample is too short for pace to mean anything, which is the existing rule above and
 *   is unchanged by any amount of reviewing.
 *
 *   the duration is not a usable number.
 *
 * When a teacher confirms real errors the figure drops, and it is left to drop. There is no
 * floor and no smoothing: a pace that cannot go down is not a measurement.
 */
export function settledWordsCorrectPerMinute(input: {
  settledCorrectWords: number;
  durationSeconds: number;
  reviewComplete: boolean;
}): number | null {
  if (!input.reviewComplete) return null;
  if (!isPaceMeaningful(input.durationSeconds)) return null;
  if (!Number.isFinite(input.settledCorrectWords) || input.settledCorrectWords < 0) return null;
  return Math.round((input.settledCorrectWords / input.durationSeconds) * 60);
}

/** One line for a surface showing the gap where an unreviewed reading's pace would be. */
export const PACE_AWAITS_REVIEW =
  "Reading speed appears once the teacher has finished reviewing this reading.";

/**
 * The average of the paces that are actually published, or null when none are.
 *
 * A reading whose review is unfinished contributes no pace at all - `settledWordsCorrectPerMinute`
 * returns null for it - and the whole point is that those readings are absent from the average
 * rather than counted as zero. Averaging nulls as zeroes is how a teacher's screen came to read
 * "0 WCPM" for a child who had just read a whole passage aloud: a claim about her reading speed,
 * made out of the absence of a review.
 *
 * Null here means "no reading has been reviewed yet", and every surface renders that as an em
 * dash. Zero is only ever returned when a reviewed reading genuinely produced zero.
 */
export function publishedPaceAverage(paces: ReadonlyArray<number | null>): number | null {
  const published = paces.filter((pace): pace is number => typeof pace === "number" && Number.isFinite(pace));
  if (!published.length) return null;
  return Math.round(published.reduce((sum, pace) => sum + pace, 0) / published.length);
}
