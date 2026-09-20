/**
 * Ordering a reading for review, and measuring how well that ordering works.
 *
 * False-correction rate is the metric for software that scores a child on its own. This does
 * not do that, and the last surface where it pretended to has been removed. What it does is
 * tell a teacher where to listen; she confirms or overturns, and `countsAgainstScore` already
 * refuses to count anything she has not confirmed. Under that design a word ranked wrongly low
 * costs a teacher ten seconds, and a word scored wrongly costs a child a false record. Those
 * are not the same failure and they should not share a metric.
 *
 * So the measurements here are:
 *
 *   recallAtK    with the k lowest-scoring words surfaced, what fraction of the real errors
 *                does the teacher actually see. This is the one that says whether the ordering
 *                is worth having.
 *   reviewCost   how many words she has to listen to, and how long that takes. This is the one
 *                that decides whether a school adopts it: a running record costs ten to fifteen
 *                minutes per child today, which is why it happens three times a year.
 *
 * On unscored words. Every confidence column in `readingWords` is currently null, because this
 * pipeline compares transcript text and has no per-word score to report. A word with no score
 * cannot be placed in a score ordering, and the honest handling is neither to treat it as zero,
 * which floats it to the top of the queue, nor as one, which buries it. It is held out, counted
 * and reported, so a surface can say the queue is partial rather than implying an order it does
 * not have.
 */

export type ReviewWord = {
  wordEventId: string;
  tokenIndex: number;
  referenceWord: string;
  /** Lower means the software is less sure the word was read as written. Null when unscored. */
  score: number | null;
  startMs: number | null;
  endMs: number | null;
};

export type RankedReviewWord = ReviewWord & { rank: number };

export type ReviewQueue<T extends ReviewWord> = {
  /** Scored words, worst first. Rank 1 is the word a teacher should hear first. */
  ranked: (T & { rank: number })[];
  /** Words with no score, in reading order. Not ranked, and not silently ranked last. */
  unscored: T[];
  /** True when nothing carries a score, so any ordering shown would be reading order. */
  unordered: boolean;
};

/**
 * Worst score first. Ties break on `tokenIndex` so the order is stable across renders and two
 * readings of the same audio cannot disagree about which of two equal words comes first.
 */
export function buildReviewQueue<T extends ReviewWord>(words: readonly T[]): ReviewQueue<T> {
  const scored = words.filter((word): word is T & { score: number } => typeof word.score === "number");
  const unscored = words.filter(word => typeof word.score !== "number")
    .slice()
    .sort((left, right) => left.tokenIndex - right.tokenIndex);
  const ranked = scored
    .slice()
    .sort((left, right) => left.score - right.score || left.tokenIndex - right.tokenIndex)
    .map((word, index) => ({ ...word, rank: index + 1 }));
  return { ranked, unscored, unordered: ranked.length === 0 };
}

export type RecallAtK = {
  k: number;
  /** Real errors inside the k lowest-scoring words. */
  found: number;
  /** Real errors in the reading. */
  total: number;
  /** found / total, or null when the reading contains no errors to find. */
  recall: number | null;
  /** Errors that carry no score, and so can never be found by ranking at any k. */
  unscoredErrors: number;
};

/**
 * Of the real errors in this reading, how many are in the k lowest-scoring words.
 *
 * `isError` is the ground truth for the measurement - a teacher's confirmed judgement, or the
 * deliberate errors in a probe recording. It is never the software's own guess, or this would
 * measure the ordering against itself.
 *
 * An error with no score is counted in `total` and in `unscoredErrors` but can never be found.
 * Dropping it would quietly raise recall by shrinking the denominator.
 */
export function recallAtK<T extends ReviewWord>(
  words: readonly T[],
  isError: (word: T) => boolean,
  k: number,
): RecallAtK {
  const errors = words.filter(isError);
  const { ranked } = buildReviewQueue(words);
  const withinK = new Set(ranked.filter(word => word.rank <= k).map(word => word.wordEventId));
  const found = errors.filter(error => withinK.has(error.wordEventId)).length;
  const unscoredErrors = errors.filter(error => typeof error.score !== "number").length;
  return {
    k,
    found,
    total: errors.length,
    recall: errors.length ? found / errors.length : null,
    unscoredErrors,
  };
}

export type ReviewCost = {
  /** Words the teacher is asked to listen to. */
  words: number;
  seconds: number;
  minutes: number;
};

/**
 * What the ordering costs the teacher, in the units she budgets in.
 *
 * `secondsPerWord` is not a constant of nature and must come from a measured run, not from
 * here. The default is a placeholder for arithmetic in tests and is deliberately not exported
 * as a project figure.
 */
export function reviewCost(wordsToHear: number, secondsPerWord: number): ReviewCost {
  const words = Math.max(0, Math.floor(wordsToHear));
  const seconds = Math.max(0, words * secondsPerWord);
  return { words, seconds, minutes: seconds / 60 };
}

/**
 * The smallest k at which the teacher sees every real error - the honest answer to "how far
 * down does she have to read". Null when no k reaches them all, which is what an unscored or
 * badly ranked error looks like.
 */
export function kForFullRecall<T extends ReviewWord>(
  words: readonly T[],
  isError: (word: T) => boolean,
): number | null {
  const errors = words.filter(isError);
  if (!errors.length) return null;
  const { ranked } = buildReviewQueue(words);
  const ranks = errors.map(error => ranked.find(word => word.wordEventId === error.wordEventId)?.rank);
  if (ranks.some(rank => rank === undefined)) return null;
  return Math.max(...(ranks as number[]));
}
