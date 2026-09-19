import { describe, expect, it } from "vitest";
import { audioRetentionStatusValues } from "../drizzle/schema";
import { audioAbsenceSummary, flaggedWordAudioNote, hasStoredAudio, isAudioFailure } from "./audioRetention";

describe("audio retention status", () => {
  it("treats only a stored recording as playable", () => {
    expect(audioRetentionStatusValues.filter(hasStoredAudio)).toEqual(["stored"]);
  });

  it("gives every status its own teacher-facing line", () => {
    const lines = audioRetentionStatusValues.map(audioAbsenceSummary);
    expect(new Set(lines).size).toBe(audioRetentionStatusValues.length);
    expect(lines.every(line => line.length > 0)).toBe(true);
  });

  it("counts only a genuine fault as a failure", () => {
    // discarded_by_policy is the privacy feature working. Rendering it as an error would tell
    // a teacher the system is broken at the exact moment it is doing what schools were promised.
    expect(audioRetentionStatusValues.filter(isAudioFailure)).toEqual(["storage_unavailable", "storage_rejected"]);
  });

  it("describes a deliberate discard as the policy working, not as something missing", () => {
    const line = audioAbsenceSummary("discarded_by_policy");
    expect(line).toMatch(/discarded/i);
    expect(line).toMatch(/retention policy/i);
    expect(line).not.toMatch(/could not|failed|unavailable|error|problem/i);
  });

  it("names the reason rather than leaving a bare absence", () => {
    expect(audioAbsenceSummary("storage_unavailable")).toMatch(/not configured/);
    expect(audioAbsenceSummary("storage_rejected")).toMatch(/failed/);
    expect(audioAbsenceSummary("not_captured")).toMatch(/no recording was captured/i);
  });

  it("tells a teacher a flagged word is still reviewable without its clip", () => {
    for (const status of audioRetentionStatusValues) {
      const note = flaggedWordAudioNote(status);
      if (status === "stored") expect(note).toBeNull();
      else expect(note).toMatch(/transcript and the words around it/);
    }
  });
});
