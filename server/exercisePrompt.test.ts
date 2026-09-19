import { describe, expect, it } from "vitest";
import { assertOnlyExerciseFields, buildExerciseGenerationRequest, buildExercisePrompt } from "./exercisePrompt";

/** The passage, and the things that must never travel with it. */
const PASSAGE = {
  title: "The Lantern in the Garden",
  readingLevel: "Level 3 · Sky Blue",
  sourceText: "Amina carried a little lantern into the garden at dusk.",
};

/** A material row as the data layer actually returns it, plus session-shaped contamination. */
const CONTAMINATED = {
  ...PASSAGE,
  id: 12,
  schoolId: 3,
  teacherUserId: 44,
  storageKey: "materials/secret-key.pdf",
  sourceFilename: "st-brigids-class-4.pdf",
  childName: "Amina Roe",
  transcript: "the tin pat was cot",
  wordStates: [{ id: "w1", text: "thin", status: "incorrect", attempts: 2 }],
  audioStorageKey: "audio/amina-2026-09-19.wav",
  sessionId: "01K5H2VQ0M0000000000000001",
};

describe("exercise generation payload", () => {
  it("rejects a wider object at compile time", () => {
    // If the guard ever stops rejecting this, @ts-expect-error becomes an unused directive and
    // `pnpm check` fails. The compile-time half of this guarantee is machine-checked, not
    // asserted in prose.
    // @ts-expect-error a material row carries fields that must not reach the provider
    expect(() => buildExercisePrompt(CONTAMINATED)).toThrow();

    // The passage itself is accepted.
    expect(() => buildExercisePrompt(PASSAGE)).not.toThrow();
  });

  it("rejects a wider object at runtime, because a cast defeats a type", () => {
    expect(() => assertOnlyExerciseFields(CONTAMINATED)).toThrow(/childName|transcript|teacherUserId/);
    expect(() => assertOnlyExerciseFields(PASSAGE)).not.toThrow();
  });

  it("sends the passage and nothing about a child", () => {
    const payload = JSON.stringify(buildExerciseGenerationRequest(PASSAGE, "test-model"));

    // Positive first: the payload really does carry the passage. Without this, the absence
    // checks below would pass just as happily against an empty request.
    expect(payload).toContain("Amina carried a little lantern into the garden at dusk.");
    expect(payload).toContain("Level 3 · Sky Blue");

    for (const forbidden of [
      "Amina Roe", "the tin pat was cot", "audio/amina", "materials/secret-key.pdf",
      "st-brigids-class-4.pdf", "01K5H2VQ0M0000000000000001", "wordStates", "teacherUserId",
      "schoolId", "childProfileId", "sessionId",
    ]) {
      expect(payload, `payload must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("trims a long passage without changing what kind of data is sent", () => {
    const long = { ...PASSAGE, sourceText: "word ".repeat(4000) };
    const prompt = buildExercisePrompt(long);
    expect(prompt.length).toBeLessThan(long.sourceText.length);
    expect(prompt).toContain("Reading level: Level 3 · Sky Blue");
  });
});
