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
