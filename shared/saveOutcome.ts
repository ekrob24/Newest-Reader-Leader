/**
 * What the server actually said about this reading.
 *
 * Three findings in this codebase share one shape: software asserting something it did not
 * observe. "Your reading practice was saved" when it was not; "no approved quiz yet" while
 * serving one; "twenty seconds" for a three-second read. Each survived because nothing
 * checked the claim against the thing it claimed about.
 *
 * So the report screen no longer decides whether a reading was saved — it reads it from here,
 * and this only ever changes in a mutation callback. "pending" is a real state and must be
 * rendered as one: a screen shown before the server has answered is not entitled to say
 * either that the reading was kept or that it was lost.
 */
export type SaveOutcome =
  | { status: "pending" }
  | { status: "saved"; sessionId: string }
  | { status: "not_attempted"; reason: string }
  | { status: "failed"; reason: string; retryable: boolean };

export const SAVE_PENDING: SaveOutcome = { status: "pending" };

/** The line the child reads. Warm, specific, and never a claim that outran the server. */
export function childSaveMessage(outcome: SaveOutcome) {
  switch (outcome.status) {
    case "saved": return "Your reading is saved. Your teacher can see it.";
    case "pending": return "Saving your reading…";
    case "not_attempted": return "This reading was not saved, because you are reading as a guest.";
    case "failed": return "We could not save your reading just now. Shall we try again?";
  }
}

export function isSaved(outcome: SaveOutcome) {
  return outcome.status === "saved";
}
