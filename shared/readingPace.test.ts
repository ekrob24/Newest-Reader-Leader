import { describe, expect, it } from "vitest";
import { PACE_MIN_SAMPLE_SECONDS, isPaceMeaningful, publishedPaceAverage, shortSampleNote } from "./readingPace";

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

describe("averaging only the paces that exist", () => {
  it("returns null, not zero, when no reading has been reviewed", () => {
    // The teacher's screen read "0 WCPM" for a child who had just read a passage aloud,
    // because unreviewed readings were averaged in as absent numbers.
    expect(publishedPaceAverage([null, null])).toBeNull();
    expect(publishedPaceAverage([])).toBeNull();
  });

  it("ignores the unreviewed readings rather than counting them as zero", () => {
    expect(publishedPaceAverage([90, null, null])).toBe(90);
    expect(publishedPaceAverage([null, 100, 90, null])).toBe(95);
  });

  it("still reports a genuine zero from a reading that was reviewed", () => {
    // Nought confirmed words over a real duration is a measurement. An absence is not.
    expect(publishedPaceAverage([0])).toBe(0);
    expect(publishedPaceAverage([0, 90])).toBe(45);
  });

  it("does not let a non-number through as a pace", () => {
    expect(publishedPaceAverage([Number.NaN, null])).toBeNull();
    expect(publishedPaceAverage([Number.POSITIVE_INFINITY, 80])).toBe(80);
  });
});
