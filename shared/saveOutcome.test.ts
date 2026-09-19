import { describe, expect, it } from "vitest";
import { childSaveMessage, isSaved, type SaveOutcome } from "./saveOutcome";

const outcomes: SaveOutcome[] = [
  { status: "pending" },
  { status: "saved", sessionId: "01K5H2VQ0M0000000000000001" },
  { status: "not_attempted", reason: "guest" },
  { status: "failed", reason: "Storage rejected", retryable: true },
];

describe("save outcome", () => {
  it("treats only a confirmed save as saved", () => {
    expect(outcomes.filter(isSaved).map(outcome => outcome.status)).toEqual(["saved"]);
  });

  it("gives every outcome a distinct child-facing line", () => {
    const lines = outcomes.map(childSaveMessage);
    expect(new Set(lines).size).toBe(outcomes.length);
  });

  it("never tells a child a reading was kept unless it was", () => {
    for (const outcome of outcomes) {
      if (outcome.status === "saved") expect(childSaveMessage(outcome)).toMatch(/saved/i);
      else expect(childSaveMessage(outcome)).not.toMatch(/your reading is saved/i);
    }
  });

  it("asks a child to try again rather than showing them an error", () => {
    const line = childSaveMessage({ status: "failed", reason: "boom", retryable: true });
    expect(line).toMatch(/try again/i);
    expect(line).not.toMatch(/error|failed|invalid|500|exception/i);
  });
});
