import type { AudioRetentionStatus } from "../drizzle/schema";
import { StorageUnavailableError } from "./storage";

export type StoredAudio = { key: string; url: string };

/**
 * A reading session is valid without its audio, so a failed upload degrades the session
 * rather than rejecting it — exactly as a failed transcription already does. What it must
 * not do is degrade silently: the reason travels with the null key, because in production
 * a null key is the ordinary case and an unexplained null is indistinguishable from a bug.
 */
export function classifyStorageOutcome(result: PromiseSettledResult<StoredAudio>): { audioStorageKey: string | null; audioStatus: AudioRetentionStatus } {
  if (result.status === "fulfilled") return { audioStorageKey: result.value.key, audioStatus: "stored" };
  // Not configured is a deployment fact, not a fault of this reading. The two are told apart
  // so an operator reading the record knows whether to fix a config or investigate an error.
  if (result.reason instanceof StorageUnavailableError) return { audioStorageKey: null, audioStatus: "storage_unavailable" };
  return { audioStorageKey: null, audioStatus: "storage_rejected" };
}
