import { describe, expect, it } from "vitest";
import { analyseReadingText, tokenize } from "./reader";
import { createReadingReport } from "./readerReports";
import type { ReadingSession } from "../drizzle/schema";

/**
 * The "tricky words to practise" list is gone, and this is the reading that removed it.
 *
 * A child read "The Lantern in the Garden" aloud. The transcript that reached the analyser
 * stopped at word 30 of 42 - the final carrying the last sentence arrived too late to be
 * scored, though it arrived in time to turn those same words green on her screen. The
 * trailing loop marked the twelve unscored words as omissions, and the results screen named
 * the first three over three letters - "amina", "stood", "very" - as her tricky words. One of
 * them is her own name, and she had read all three correctly.
 *
 * So the test is not that the list is better chosen. It is that no surface names words at all.
 */
const PASSAGE = "Amina carried a little lantern into the garden at dusk. The light made golden circles on the path. Near the tall gate, she saw a hedgehog sniffing beside the flowers. Amina stood very still, then watched it hurry safely under the hedge.";
const TRUNCATED = tokenize(PASSAGE).slice(0, 30).join(" ");

const session = (overrides: Partial<ReadingSession> = {}): ReadingSession => ({
  id: "01K5H2VQ0M0000000000000001", schoolId: 1, childProfileId: 2, materialId: null,
  storyTitle: "The Lantern in the Garden", transcript: TRUNCATED, accuracy: 71,
  wordsCorrectPerMinute: 23, durationSeconds: 78, audioStorageKey: null,
  audioStatus: "not_captured", completed: 1, practiceWords: ["amina", "stood", "very"],
  interventions: [], assessmentMode: "ASSISTED_PRACTICE", languageSupport: "STANDARD_ENGLISH",
  wordStates: [], wordTimings: null, capturedAt: null, capturedAtSource: "server",
  createdAt: new Date(), ...overrides,
} as ReadingSession);

describe("the reading that produced the fabricated tricky words", () => {
  it("still scores the truncated transcript as twelve omissions", () => {
    const analysis = analyseReadingText(PASSAGE, TRUNCATED, 78);
    const omitted = analysis.events.filter(event => event.eventType === "omission").map(event => event.expectedWord);
    expect(omitted).toEqual(["amina", "stood", "very", "still", "then", "watched", "it", "hurry", "safely", "under", "the", "hedge"]);
  });

  it("names no word as tricky in the analysis it returns", () => {
    const analysis = analyseReadingText(PASSAGE, TRUNCATED, 78);
    expect(analysis).not.toHaveProperty("practiceWords");
    // The next step used to be "Try 'Amina' slowly once". It must not name a word.
    expect(analysis.nextStep).toBe("Choose one sentence you enjoyed and read it again with a smooth, steady voice.");
    for (const word of ["amina", "stood", "very"]) expect(analysis.nextStep.toLowerCase()).not.toContain(word);
  });

  it("names no word as tricky in any report, even when a stored row still carries the old list", () => {
    // The column outlives the list. A report built from a pre-removal row must not print it.
    const stored = session();
    expect(stored.practiceWords).toEqual(["amina", "stood", "very"]);
    for (const audience of ["child", "parent", "teacher"] as const) {
      const report = createReadingReport({ audience, childName: "Amina Roe", bookBand: "Gold", sessions: [stored] });
      expect(report.content).toContain("Amina Roe");
      // Whole words: "very" is a substring of "every try grows your reader brain".
      for (const word of ["tricky", "amina's", "stood", "very"]) {
        expect(report.content.toLowerCase()).not.toMatch(new RegExp(`\\b${word}\\b`));
      }
      for (const phrase of ["practice:", "Try these story words", "words to practise"]) {
        expect(report.content.toLowerCase()).not.toContain(phrase.toLowerCase());
      }
    }
  });
});
