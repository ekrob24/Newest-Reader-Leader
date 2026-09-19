import { describe, expect, it } from "vitest";
import { hasChildReadingEvidence, readingCapture, readingCaptureMessage } from "../shared/readingEvidence";

describe("hasChildReadingEvidence", () => {
  it("blocks an empty unstarted session from producing a report", () => {
    expect(hasChildReadingEvidence("", [{ attempts: 0 }, { attempts: 0 }])).toBe(false);
  });

  it("accepts either recognised words or a recorded child attempt", () => {
    expect(hasChildReadingEvidence("Amina carried", [{ attempts: 0 }])).toBe(true);
    expect(hasChildReadingEvidence("", [{ attempts: 3 }, { attempts: 0 }])).toBe(true);
  });
});

describe("telling a failed capture apart from a poor reading", () => {
  it("calls nothing heard what it is", () => {
    expect(readingCapture(0, 0)).toBe("nothing_heard");
  });

  it("separates heard-but-unmatched from heard-and-read", () => {
    expect(readingCapture(0, 12)).toBe("nothing_matched");
    expect(readingCapture(1, 12)).toBe("captured");
  });

  it("never blames the child for the software failing to hear", () => {
    for (const capture of ["nothing_heard", "nothing_matched"] as const) {
      const message = readingCaptureMessage(capture);
      expect(message).toMatch(/not your fault/i);
      expect(message).toMatch(/try again/i);
      expect(message).not.toMatch(/you did not|you failed|incorrect|wrong/i);
    }
  });

  it("says nothing at all when the reading was captured", () => {
    expect(readingCaptureMessage("captured")).toBeNull();
  });
});
