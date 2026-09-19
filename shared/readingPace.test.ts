import { describe, expect, it } from "vitest";
import { PACE_MIN_SAMPLE_SECONDS, isPaceMeaningful, shortSampleNote } from "./readingPace";

describe("reading pace reliability", () => {
  it("treats a sample at or above the threshold as meaningful", () => {
    expect(isPaceMeaningful(PACE_MIN_SAMPLE_SECONDS)).toBe(true);
    expect(isPaceMeaningful(PACE_MIN_SAMPLE_SECONDS - 1)).toBe(false);
    expect(isPaceMeaningful(0)).toBe(false);
  });

  it("rejects a duration that is not a number at all", () => {
    expect(isPaceMeaningful(Number.NaN)).toBe(false);
    expect(isPaceMeaningful(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("names the real duration in the short-sample note rather than a rounded-up one", () => {
    expect(shortSampleNote(3)).toMatch(/lasted 3s/);
    expect(shortSampleNote(60)).toBeNull();
  });
});
