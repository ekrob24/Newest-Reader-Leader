/**
 * Accent fairness metrics for the dashboard.
 *
 * NAMING — read before adding a metric here.
 *
 * Two different measures share the same numerator: the system intervened on a word a human
 * judged correct. They differ in what they divide by, and the difference is the difference
 * between a viable product and an unusable one.
 *
 *   False-correction rate  = false corrections / every word of reading opportunity.
 *                            The field measure. Reported per word the teacher marked.
 *                            Expected low single digits; the Python benchmark gates it at
 *                            <= 2% overall and <= 3% per cohort against human-annotated
 *                            ground truth.
 *
 *   Flag overturn rate     = false corrections / the flags a teacher actually reviewed.
 *                            Review-conditioned, and its denominator is a small, heavily
 *                            selected subset: teachers review flags, not correct words.
 *                            It can legitimately be most of them and often is.
 *
 * A 75% flag overturn rate means three quarters of reviewed flags were overturned. A 75%
 * false-correction rate would mean the system miscorrects three quarters of a child's
 * reading. Never let the second name attach to the first number.
 *
 * `computeFlagOverturnRate` divides by reviewed flags, so it is an overturn rate. It was
 * previously called `computeLiveFairness` and reported `falseCorrectionRatePct`, which
 * claimed the stronger measure while computing the weaker one. The maths is unchanged.
 *
 * The per-word false-correction rate is deliberately NOT implemented here yet. It needs one
 * row per word of reading opportunity with the teacher's resolution attached, which is the
 * `readingWords` table arriving in Stage 3. Until then this module cannot compute a
 * denominator of "every word read", and nothing here should claim to.
 *
 * `measureCuratedContrast` is a capability check, not field performance: it runs 16
 * constructed Irish-English pronunciation pairs through the real analysis engine twice,
 * accent-blind and accent-aware, and counts how many each wrongly flags. Its output is
 * named to carry both the word "curated" and the n, because 16 hand-picked pairs is a
 * demonstration of a mechanism, not a measurement of a population.
 *
 * Scope to state when presenting: the curated contrast covers the word-level dialect layer
 * on curated features; it is not an end-to-end ASR benchmark. The overturn rate grows as
 * teachers review.
 */
import { analyseReadingText } from "./reader";

type Pair = { expected: string; heard: string; feature: string };

const IRISH_READINGS: Pair[] = [
  { expected: "thin", heard: "tin", feature: "TH-stopping" },
  { expected: "path", heard: "pat", feature: "TH-stopping" },
  { expected: "three", heard: "tree", feature: "TH-stopping" },
  { expected: "month", heard: "mont", feature: "TH-stopping" },
  { expected: "north", heard: "nort", feature: "TH-stopping" },
  { expected: "teeth", heard: "teet", feature: "TH-stopping" },
  { expected: "with", heard: "wit", feature: "TH-stopping" },
  { expected: "that", heard: "dat", feature: "TH-stopping (voiced)" },
  { expected: "this", heard: "dis", feature: "TH-stopping (voiced)" },
  { expected: "them", heard: "dem", feature: "TH-stopping (voiced)" },
  { expected: "they", heard: "dey", feature: "TH-stopping (voiced)" },
  { expected: "running", heard: "runnin", feature: "G-dropping" },
  { expected: "reading", heard: "readin", feature: "G-dropping" },
  { expected: "morning", heard: "mornin", feature: "G-dropping" },
  { expected: "through", heard: "true", feature: "TH-cluster" },
  { expected: "caught", heard: "cot", feature: "cot-caught merger" },
];

const carrier = (w: string) => `we can see the ${w} today`;

function markedAsError(expected: string, heard: string, mode: "STANDARD_ENGLISH" | "IRISH_ENGLISH_SUPPORT"): boolean {
  const a = analyseReadingText(carrier(expected), carrier(heard), 10, "ASSISTED_PRACTICE", undefined, mode);
  const ev = a.events.find(e => e.expectedWord.toLowerCase() === expected.toLowerCase());
  return !!ev && ev.eventType !== "dialect_variation" && !ev.provisionalIrishEnglish && ev.eventType !== "correct";
}

export function measureCuratedContrast() {
  const curatedPairs = IRISH_READINGS.length;
  const flaggedIn = (mode: "STANDARD_ENGLISH" | "IRISH_ENGLISH_SUPPORT") =>
    IRISH_READINGS.filter(p => markedAsError(p.expected, p.heard, mode)).length;
  const baselineFlagged = flaggedIn("STANDARD_ENGLISH");
  const ourFlagged = flaggedIn("IRISH_ENGLISH_SUPPORT");

  const features = Array.from(new Set(IRISH_READINGS.map(p => p.feature)));
  const byFeature = features.map(feature => {
    const set = IRISH_READINGS.filter(p => p.feature === feature);
    const accepted = set.filter(p => !markedAsError(p.expected, p.heard, "IRISH_ENGLISH_SUPPORT")).length;
    return { feature, accepted, curatedPairs: set.length, acceptedOfCuratedPct: Math.round((accepted / set.length) * 100) };
  });

  // Percentages here are "of the 16 curated pairs", never of a child's reading.
  return {
    curatedPairs,
    baseline: { label: "Accent-blind handling (curated set)", flaggedOfCurated: baselineFlagged, flaggedOfCuratedPct: Math.round((baselineFlagged / curatedPairs) * 100) },
    readerLeader: { label: "Reader Leader, accent-aware (curated set)", flaggedOfCurated: ourFlagged, flaggedOfCuratedPct: Math.round((ourFlagged / curatedPairs) * 100) },
    byFeature,
  };
}

// ---- review-conditioned rates from real teacher decisions ----
export type DecidedSessionLike = {
  interventions: Array<{ word: string; heardWord?: string; eventType?: string; provisionalIrishEnglish?: boolean; teacherDecision?: string }>;
};

/**
 * Rates over the flags a teacher reviewed. NOT per word of reading opportunity — see the
 * naming note at the top of this file before reporting either number.
 */
export function computeFlagOverturnRate(sessions: DecidedSessionLike[]) {
  const c = { true_accept: 0, false_accept: 0, true_reject: 0, false_correction: 0 };
  for (const s of sessions) for (const iv of s.interventions) {
    const d = iv.teacherDecision;
    if (d !== "confirmed" && d !== "overridden") continue;
    const acceptedVariant = iv.eventType === "dialect_variation" || iv.provisionalIrishEnglish === true;
    const validVariant = (acceptedVariant) === (d === "confirmed");
    if (acceptedVariant) validVariant ? c.true_accept++ : c.false_accept++;
    else validVariant ? c.false_correction++ : c.true_reject++;
  }
  const reviewed = c.true_accept + c.false_accept + c.true_reject + c.false_correction;
  const validTotal = c.true_accept + c.false_correction;
  const errorTotal = c.true_reject + c.false_accept;
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);
  return {
    totalReviewed: reviewed,
    // false corrections / reviewed flags the teacher judged correct readings.
    flagOverturnRatePct: pct(c.false_correction, validTotal),
    // wrongly accepted variants / reviewed flags the teacher judged genuine errors.
    missedErrorRatePct: pct(c.false_accept, errorTotal),
    // The counts are the confusion-matrix cells and keep their names: `false_correction` is
    // a correct count of false corrections. Only the rate's denominator was mislabelled.
    counts: c,
  };
}

export function getAccentFairnessSummary(sessions: DecidedSessionLike[]) {
  // `flagReview` rather than `live`: these are review-conditioned rates, not field performance.
  return { curated: measureCuratedContrast(), flagReview: computeFlagOverturnRate(sessions) };
}
