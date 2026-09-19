import { describe, expect, it } from "vitest";
import { deriveLiveWordStates, firstGuidedModelWord, initialLiveWordStates, keepWordsAlreadyRead } from "../shared/liveWordStates";

describe("live transcript word tracking", () => {
  it("keeps an assisted mismatch on the active word until the child self-corrects it", () => {
    const states = deriveLiveWordStates("Amina carried", "Emina Amina carried", "ASSISTED_PRACTICE");
    expect(states[0]).toMatchObject({ text: "amina", status: "retried_correct", attempts: 2 });
    expect(states[1]).toMatchObject({ text: "carried", status: "correct", attempts: 1 });
  });

  it("logs a monthly mismatch without a retry progression", () => {
    const states = deriveLiveWordStates("Amina carried", "Emina carried", "MONTHLY_ASSESSMENT");
    expect(states[0]).toMatchObject({ status: "incorrect", attempts: 1 });
    expect(states[1]).toMatchObject({ status: "correct", attempts: 1 });
  });

  it("finds the first word that requires a guided model after two live mismatches", () => {
    const states = deriveLiveWordStates("Amina carried", "Emina Emina", "GUIDED_PRACTICE");
    expect(firstGuidedModelWord(states, new Set())).toMatchObject({ text: "amina", attempts: 2, status: "incorrect" });
    expect(firstGuidedModelWord(states, new Set(["word-0"]))).toBeUndefined();
  });

  it("keeps a three-attempt moved-on word incorrect while later words continue live progression", () => {
    const states = deriveLiveWordStates("rain tapped softly", "wrong wrong wrong tapped softly", "ASSISTED_PRACTICE", "STANDARD_ENGLISH", [], new Map([["word-0", 3]]));
    expect(states[0]).toMatchObject({ text: "rain", status: "incorrect", attempts: 3 });
    expect(states[1]).toMatchObject({ text: "tapped", status: "correct", attempts: 1 });
    expect(states[2]).toMatchObject({ text: "softly", status: "correct", attempts: 1 });
  });

  it("lets a child continue naturally after a missed word without replaying matching from the passage beginning", () => {
    const states = deriveLiveWordStates("Amina carried a lantern", "Amina caried a lantern", "ASSISTED_PRACTICE");

    expect(states.map(state => ({ text: state.text, status: state.status, attempts: state.attempts }))).toEqual([
      { text: "amina", status: "correct", attempts: 1 },
      { text: "carried", status: "incorrect", attempts: 1 },
      { text: "a", status: "correct", attempts: 1 },
      { text: "lantern", status: "correct", attempts: 1 },
    ]);
  });

  it("keeps a reviewed Irish English live variant out of the red mismatch state when the profile is enabled", () => {
    const supported = deriveLiveWordStates("The thin path", "The tin pat", "ASSISTED_PRACTICE", "IRISH_ENGLISH_SUPPORT");
    const standard = deriveLiveWordStates("The thin path", "The tin pat", "ASSISTED_PRACTICE", "STANDARD_ENGLISH");
    expect(supported[1]).toMatchObject({ text: "thin", status: "correct", attempts: 1 });
    expect(supported[2]).toMatchObject({ text: "path", status: "correct", attempts: 1 });
    expect(standard[1]).toMatchObject({ text: "thin", status: "incorrect", attempts: 2 });
  });
});

describe("moving on from a word the coach misheard", () => {
  const passage = "the cat sat on the mat";

  it("records the attempts the child actually made, not a floor of three", () => {
    // The old behaviour wrote three attempts for a word tried once, so that the page-
    // completion rule would let the child past. That is a fabricated count in a child's
    // running record, invented to work around a stuck screen.
    const movedOn = new Map([["word-2", 1]]);
    const states = deriveLiveWordStates(passage, "the cat mat", "ASSISTED_PRACTICE", "STANDARD_ENGLISH", [], movedOn);
    const sat = states.find(state => state.id === "word-2")!;
    expect(sat.attempts).toBe(1);
    expect(sat.movedOn).toBe(true);
    expect(sat.status).toBe("incorrect");
  });

  it("marks the word as left rather than as read", () => {
    const movedOn = new Map([["word-2", 2]]);
    const states = deriveLiveWordStates(passage, "the cat sit", "ASSISTED_PRACTICE", "STANDARD_ENGLISH", [], movedOn);
    const sat = states.find(state => state.id === "word-2")!;
    expect(sat.movedOn).toBe(true);
    expect(sat.attempts).toBe(2);
    // Every other word is untouched by the decision.
    expect(states.filter(state => state.movedOn).map(state => state.id)).toEqual(["word-2"]);
  });
});

describe("moving on never crashes the reading view", () => {
  const passage = "the cat sat on the mat";

  it("survives a moved-on word at the very end of what was heard", () => {
    // Regression. deriveLiveWordStates runs inside a React effect, so a throw here does not
    // surface as a bad word state — it unmounts the reader and the child cannot do anything
    // at all. Reached by tapping "Need help - move on" on the last word heard so far, which
    // is exactly when a child would.
    for (const attempts of [1, 2, 3, 5]) {
      const movedOn = new Map([["word-2", attempts]]);
      expect(() => deriveLiveWordStates(passage, "the cat sat", "ASSISTED_PRACTICE", "STANDARD_ENGLISH", [], movedOn)).not.toThrow();
    }
  });

  it("survives moving on from several words at once", () => {
    const movedOn = new Map([["word-1", 2], ["word-2", 3], ["word-3", 1]]);
    expect(() => deriveLiveWordStates(passage, "the cat", "ASSISTED_PRACTICE", "STANDARD_ENGLISH", [], movedOn)).not.toThrow();
  });

  it("survives moving on before anything has been heard", () => {
    const movedOn = new Map([["word-0", 1]]);
    expect(() => deriveLiveWordStates(passage, "", "ASSISTED_PRACTICE", "STANDARD_ENGLISH", [], movedOn)).not.toThrow();
  });
});

describe("a word the child has read does not get taken away", () => {
  const passage = "the light made golden circles";
  const read = (statuses: Array<"unread" | "current" | "correct" | "incorrect" | "retried_correct">) =>
    initialLiveWordStates(passage).map((state, index) => ({ ...state, status: statuses[index] ?? "unread", attempts: statuses[index] === "unread" ? 0 : 1 }));

  it("holds a correct word when a later transcript revision disagrees", () => {
    // Reported exactly: "made" turned green, then red, then green, in a loop. The recogniser
    // revises what it thinks it heard, and every revision re-derives every word.
    const before = read(["correct", "correct", "correct", "unread", "unread"]);
    const after = read(["correct", "correct", "incorrect", "unread", "unread"]);
    const merged = keepWordsAlreadyRead(before, after);
    expect(merged[2]!.status).toBe("correct");
  });

  it("holds a self-corrected word too", () => {
    const before = read(["correct", "retried_correct", "unread", "unread", "unread"]);
    const after = read(["correct", "incorrect", "unread", "unread", "unread"]);
    expect(keepWordsAlreadyRead(before, after)[1]!.status).toBe("retried_correct");
  });

  it("lets every other word move freely, so the reading is never frozen", () => {
    const before = read(["correct", "unread", "unread", "unread", "unread"]);
    const after = read(["correct", "incorrect", "current", "unread", "unread"]);
    const merged = keepWordsAlreadyRead(before, after);
    expect(merged.map(state => state.status)).toEqual(["correct", "incorrect", "current", "unread", "unread"]);
  });

  it("carries the higher attempt count forward rather than losing tries", () => {
    const before = read(["correct", "unread", "unread", "unread", "unread"]);
    const after = initialLiveWordStates(passage).map((state, index) => index === 0 ? { ...state, status: "incorrect" as const, attempts: 4 } : state);
    expect(keepWordsAlreadyRead(before, after)[0]).toMatchObject({ status: "correct", attempts: 4 });
  });
});
