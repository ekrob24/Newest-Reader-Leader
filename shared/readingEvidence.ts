export type ReadingEvidenceWord = {
  attempts: number;
};

export function hasChildReadingEvidence(transcript: string, wordStates: ReadingEvidenceWord[]) {
  return transcript.trim().split(/\s+/).filter(Boolean).length > 0 || wordStates.some(word => word.attempts > 0);
}

/**
 * Whether the reading was actually captured, as distinct from how well it went.
 *
 * A report showing 0% story match, 0 words per minute and 0 self-corrections is not a child
 * who read badly — it is a reading the system failed to hear. Presenting that as "you stayed
 * with a tricky text" tells a child they read poorly when the software did, which is both
 * untrue and the unkindest possible version of the mistake.
 */
export type ReadingCapture = "captured" | "nothing_matched" | "nothing_heard";

export function readingCapture(correctWords: number, transcriptWordCount: number): ReadingCapture {
  if (transcriptWordCount === 0) return "nothing_heard";
  if (correctWords === 0) return "nothing_matched";
  return "captured";
}

/** What a child is told when the reading was not captured. Never blames the reader. */
export function readingCaptureMessage(capture: ReadingCapture): string | null {
  switch (capture) {
    case "captured": return null;
    case "nothing_heard": return "Reader Leader did not hear any of your reading this time. That is not your fault — shall we try again?";
    case "nothing_matched": return "Reader Leader heard you, but could not match the words to the story this time. That is not your fault — shall we try again?";
  }
}
