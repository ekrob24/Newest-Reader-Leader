/** Who may be shown an accuracy figure, and why the answer is "a teacher".
 *
 *  `readingSessions.accuracy` is the proportion of expected words the software believed were
 *  read correctly. Every one of those beliefs came from a recogniser that has been measured on
 *  this project's own passage and got roughly one word in fourteen wrong in the child's favour
 *  or against her - and that measurement was one adult, in one quiet room, reading carefully.
 *  A child reading at pace in a classroom will do worse.
 *
 *  A percentage carries none of that. Shown to a child it reads as a mark; shown to a parent it
 *  reads as a measurement of their child. Neither audience is in a position to know that the
 *  number rests on judgements no person has checked, and neither is in a position to overrule
 *  it. A teacher is: she has the child, the book and the running record in front of her, the
 *  review screen shows her the figure before and after her own decisions, and `countsAgainstScore`
 *  already means nothing counts against a reading until she confirms it.
 *
 *  So accuracy stays. It is what orders a teacher's review queue - the readings least likely to
 *  be right, first. It simply stops being rendered to the two audiences who cannot check it.
 *
 *  This is a removal at the server boundary rather than in a component. A field that is not in
 *  the payload cannot be put back by a later layout change, and the tests below assert on the
 *  payload rather than on the markup.
 */
export type ReportAudience = "child" | "parent" | "teacher";

/** Prose for any surface that has to explain the gap where a percentage used to be. */
export const ACCURACY_WITHHELD_NOTE =
  "Reading accuracy is reviewed by your teacher before it means anything.";

export function seesAccuracy(audience: ReportAudience) {
  return audience === "teacher";
}

/** An account role as the audience whose surfaces it sees. An unrecognised role is treated as a
 *  child: the narrowest view is the safe default when we do not know who is asking. */
export function audienceForRole(role: string | null | undefined): ReportAudience {
  if (role === "teacher" || role === "admin") return "teacher";
  if (role === "parent") return "parent";
  return "child";
}

export function withoutSessionAccuracy<T extends { accuracy: unknown }>(session: T): Omit<T, "accuracy"> {
  const { accuracy: _withheld, ...rest } = session;
  return rest;
}

export function withoutSummaryAccuracy<T extends { averageAccuracy: unknown }>(summary: T): Omit<T, "averageAccuracy"> {
  const { averageAccuracy: _withheld, ...rest } = summary;
  return rest;
}

type ProgressLike = {
  sessions: { accuracy: unknown }[];
  summary: { averageAccuracy: unknown };
};

/** The one place the rule is applied to a child-progress payload, so a new caller cannot
 *  reinvent half of it. Returns the payload untouched for a teacher. */
export function progressForAudience<T extends ProgressLike>(progress: T, audience: ReportAudience) {
  if (seesAccuracy(audience)) return progress;
  return {
    ...progress,
    sessions: progress.sessions.map(withoutSessionAccuracy),
    summary: withoutSummaryAccuracy(progress.summary),
  };
}

type ReadingResultLike = {
  session: { accuracy: unknown };
  analysis: { accuracy: unknown; firstPassAccuracy: unknown };
};

/** The reply a child gets the moment she finishes reading. It carried the freshly computed
 *  accuracy in two places - on the saved row and on the analysis the report screen renders -
 *  which is the one payload where the figure is newest and least checked: no teacher has seen
 *  the reading yet. The saved row keeps its accuracy in the database; it just does not travel
 *  back to the reader. */
export function readingResultForAudience<T extends ReadingResultLike>(result: T, audience: ReportAudience) {
  if (seesAccuracy(audience)) return result;
  const { accuracy: _sessionAccuracy, ...session } = result.session;
  const { accuracy: _analysisAccuracy, firstPassAccuracy: _firstPass, ...analysis } = result.analysis;
  return { ...result, session, analysis };
}
