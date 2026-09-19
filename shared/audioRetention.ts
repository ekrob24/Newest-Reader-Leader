import type { AudioRetentionStatus } from "../drizzle/schema";

/** A reading session is valid without its audio. Audio is scored and discarded in the same
 *  request, so the ordinary production state is no stored recording at all. Because null is
 *  ordinary, the reason has to be carried with it: a null with no explanation is
 *  indistinguishable from a bug, and a teacher reviewing a flagged word needs to know whether
 *  the clip is missing by design or missing because something broke. */

/** True when this session can offer a teacher any audio at all. */
export function hasStoredAudio(status: AudioRetentionStatus) {
  return status === "stored";
}

/** One short line for a teacher, in place of an audio control. */
export function audioAbsenceSummary(status: AudioRetentionStatus) {
  switch (status) {
    case "stored": return "Recording saved";
    case "not_captured": return "No recording was captured for this reading";
    case "storage_unavailable": return "No recording available — recording storage was not configured";
    case "storage_rejected": return "No recording available — saving the recording failed";
  }
}

/** The sentence shown where a flagged word's two-second clip would be. The clip makes review
 *  better, not possible: the transcript and the surrounding words still support a decision. */
export function flaggedWordAudioNote(status: AudioRetentionStatus) {
  if (status === "stored") return null;
  return `${audioAbsenceSummary(status)}. Confirm or override this word from the transcript and the words around it.`;
}
