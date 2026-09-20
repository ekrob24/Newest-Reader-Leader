import { describe, expect, it } from "vitest";
import { analyseReadingText, initialiseWordStates, mayViewChildProgress, tokenize } from "./reader";
import { isTeacher } from "./readerDb";

describe("Reader Leader prototype analysis", () => {
  it("tokenizes child-friendly text without punctuation", () => {
    expect(tokenize("A kite's tail—swirled!")).toEqual(["a", "kite's", "tail", "swirled"]);
  });

  it("reports an exact read, and still computes the accuracy the teacher will rank by", () => {
    const result = analyseReadingText("The bright kite rose", "The bright kite rose", 30);
    expect(result.accuracy).toBe(100);
    expect(result.pace).toBe(8);
  });

  it("says the same thing to a child who read it perfectly and a child who did not", () => {
    // The message used to split on accuracy >= 92: "Wonderful focus" above the line, "You
    // stayed with a tricky text" below. That handed the child the same unconfirmed judgement
    // the percentage did, and told a reader the recogniser had mis-heard that she struggled.
    const perfect = analyseReadingText("The bright kite rose over the tall grey wall", "The bright kite rose over the tall grey wall", 30);
    const poor = analyseReadingText("The bright kite rose over the tall grey wall", "The kite", 30);
    expect(perfect.accuracy).toBe(100);
    expect(poor.accuracy).toBeLessThan(92);
    expect(perfect.childMessage).toBe(poor.childMessage);
    expect(perfect.childMessage).not.toMatch(/wonderful|tricky text/i);
  });

  it("does vary the message on something the child actually did", () => {
    const text = "The bright kite rose over the tall grey wall";
    // Two attempts on "kite": mergeAttemptHistory only believes an attempt history that shows
    // more attempts than this pass through the transcript found.
    const states = initialiseWordStates(text).map(state => (state.text === "kite" ? { ...state, status: "retried_correct" as const, attempts: 2 } : state));
    const corrected = analyseReadingText(text, text, 30, "ASSISTED_PRACTICE", states);
    expect(corrected.selfCorrections).toContain("kite");
    expect(corrected.childMessage).toMatch(/another go/i);
  });

  it("selects gentle practice words for an omission", () => {
    const result = analyseReadingText("The glimmered lantern shone", "The lantern shone", 20);
    expect(result.practiceWords).toContain("glimmered");
    expect(result.events.some(event => event.eventType === "omission" && event.action === "practise_gently")).toBe(true);
  });

  it("keeps a child or parent scoped to linked profiles while teachers can view class progress", () => {
    expect(mayViewChildProgress("child", "amina", ["amina"])).toBe(true);
    expect(mayViewChildProgress("parent", "leo", ["amina"])).toBe(false);
    expect(mayViewChildProgress("teacher", "leo", [])).toBe(true);
  });

  it("recognises only teacher and administrator roles as teacher privileges", () => {
    expect(isTeacher("teacher")).toBe(true);
    expect(isTeacher("admin")).toBe(true);
    expect(isTeacher("parent")).toBe(false);
    expect(isTeacher("child")).toBe(false);
  });

  it("records an assisted-practice self-correction and retry count", () => {
    const attempts = initialiseWordStates("The glimmered lantern");
    attempts[1] = { ...attempts[1], attempts: 2, status: "retried_correct" };
    const result = analyseReadingText("The glimmered lantern", "The glimmered lantern", 30, "ASSISTED_PRACTICE", attempts);
    expect(result.selfCorrections).toContain("glimmered");
    expect(result.retrySummary).toContainEqual({ word: "glimmered", retries: 1 });
    expect(result.wordStates[1].status).toBe("retried_correct");
  });

  it("keeps monthly assessment feedback silent and scores only the first pass", () => {
    const attempts = initialiseWordStates("The glimmered lantern");
    attempts[1] = { ...attempts[1], attempts: 3, status: "retried_correct" };
    const result = analyseReadingText("The glimmered lantern", "The lantern", 30, "MONTHLY_ASSESSMENT", attempts);
    expect(result.practiceWords).toEqual([]);
    expect(result.retrySummary).toEqual([]);
    expect(result.selfCorrections).toEqual([]);
    expect(result.events.find(event => event.eventType === "omission")?.action).toBe("teacher_review");
    expect(result.nextStep).toContain("No correction prompts");
  });

  it("requests a model word after two guided-practice attempts remain incorrect", () => {
    const attempts = initialiseWordStates("The glimmered lantern");
    attempts[1] = { ...attempts[1], attempts: 2, status: "incorrect" };
    const result = analyseReadingText("The glimmered lantern", "The lantern", 30, "GUIDED_PRACTICE", attempts);
    expect(result.modelWords).toContain("glimmered");
  });

  it("accepts reviewed Irish English transcript variants provisionally and keeps them in teacher review", () => {
    const result = analyseReadingText("The thin path was caught", "The tin pat was cot", 30, "ASSISTED_PRACTICE", undefined, "IRISH_ENGLISH_SUPPORT");
    expect(result.accuracy).toBe(100);
    expect(result.practiceWords).toEqual([]);
    expect(result.events.filter(event => event.eventType === "dialect_variation")).toHaveLength(3);
    expect(result.events.filter(event => event.eventType === "dialect_variation").every(event => event.action === "teacher_review")).toBe(true);
  });

  it("does not accept reviewed Irish English variants when the teacher has not enabled the support profile", () => {
    const result = analyseReadingText("The caught kite", "The cot kite", 30);
    expect(result.accuracy).toBeLessThan(100);
    expect(result.events.some(event => event.eventType === "substitution")).toBe(true);
  });
});

describe("reading duration is recorded, not rewritten", () => {
  const passage = "The lantern glowed softly in the quiet garden tonight.";

  it("stores the duration that was read, not a comfortable minimum", () => {
    // Regression pin. This used to return 20 for any read under twenty seconds, so a
    // three-second reading reached the teacher's running record as a twenty-second one.
    expect(analyseReadingText(passage, passage, 3).durationSeconds).toBe(3);
    expect(analyseReadingText(passage, passage, 1).durationSeconds).toBe(1);
    expect(analyseReadingText(passage, passage, 19).durationSeconds).toBe(19);
    expect(analyseReadingText(passage, passage, 600).durationSeconds).toBe(600);
  });

  it("marks a short read as an unreliable pace sample instead of distorting it", () => {
    expect(analyseReadingText(passage, passage, 3).paceReliable).toBe(false);
    expect(analyseReadingText(passage, passage, 60).paceReliable).toBe(true);
  });

  it("survives a duration of zero without inventing one", () => {
    // Previously `durationSeconds || 60` turned a zero into a minute. Zero is now recorded
    // as zero; only the division is guarded, so the pace stays finite.
    const analysis = analyseReadingText(passage, passage, 0);
    expect(analysis.durationSeconds).toBe(0);
    expect(analysis.paceReliable).toBe(false);
    expect(Number.isFinite(analysis.pace)).toBe(true);
  });

  it("still computes an ordinary pace over an ordinary read", () => {
    const analysis = analyseReadingText(passage, passage, 60);
    expect(analysis.pace).toBe(9);
  });
});
