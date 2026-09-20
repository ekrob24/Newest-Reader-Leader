import { describe, expect, it } from "vitest";
import { cursorWithinPage, deriveLiveWordStates, liveReadingPosition, readerWordClass } from "./liveWordStates";

const PASSAGE = "Amina carried a little lantern into the garden at dusk. The light made golden circles on the path. Near the tall gate, she saw a hedgehog sniffing beside the flowers. Amina stood very still, then watched it hurry safely under the hedge.";
const WORDS = (PASSAGE.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? []);
const said = (from: number, to: number) => WORDS.slice(from, to).join(" ");

const position = (transcript: string) => liveReadingPosition(deriveLiveWordStates(PASSAGE, transcript, "ASSISTED_PRACTICE"));
const statuses = (transcript: string) => deriveLiveWordStates(PASSAGE, transcript, "ASSISTED_PRACTICE").map(state => state.status);

describe("position follows interims, judgement does not", () => {
  it("puts the cursor where the interim has reached, not where the finals have", () => {
    // The measured case: one final lagged its interim by 16,512ms. Finals alone leave the
    // cursor twenty words behind a child who is reading perfectly well.
    const finals = said(0, 30);
    const interim = said(30, 37);
    expect(position(finals)).toBe(30);
    expect(position(`${finals} ${interim}`)).toBe(37);
  });

  it("does not let the interim colour a single word", () => {
    const finals = said(0, 30);
    const withInterim = `${finals} ${said(30, 37)}`;
    // Judgement is derived from finals only. Whatever the interim says, these are the
    // statuses the screen shows, and they must not change when an interim arrives.
    const judged = statuses(finals);
    expect(judged.slice(0, 30).every(status => status === "correct")).toBe(true);
    expect(judged.slice(31)).toEqual(WORDS.slice(31).map(() => "unread"));
    // Same passage, same finals: the interim-inclusive derivation is a separate call whose
    // statuses are thrown away. Proving they differ is the point of keeping them apart.
    expect(statuses(withInterim)).not.toEqual(judged);
  });

  it("accepts a cursor that steps backwards when the recogniser revises itself", () => {
    // Interims are revised continuously. A shorter revision moves the cursor back, and that
    // is the agreed cost of a cursor that keeps up at all.
    const finals = said(0, 20);
    const ahead = position(`${finals} ${said(20, 28)}`);
    const revised = position(`${finals} ${said(20, 23)}`);
    expect(ahead).toBe(28);
    expect(revised).toBe(23);
    expect(revised).toBeLessThan(ahead);
  });

  it("reports the end of the passage when every word has been reached", () => {
    expect(position(WORDS.join(" "))).toBe(WORDS.length);
  });

  it("leaves the cursor at the start before anything is heard", () => {
    expect(position("")).toBe(0);
  });
});

const STATUSES = ["unread", "current", "correct", "incorrect", "retried_correct"] as const;
const MODES = ["ASSISTED_PRACTICE", "GUIDED_PRACTICE", "MONTHLY_ASSESSMENT"] as const;

describe("the class a word wears", () => {
  it("matches the truth table, exhaustively", () => {
    const table: Record<string, string> = {};
    for (const mode of MODES) for (const settled of STATUSES) for (const atCursor of [false, true]) {
      table[`${mode}|${settled}|${atCursor}`] = readerWordClass(settled, atCursor, mode);
    }
    table["ASSISTED_PRACTICE|undefined|false"] = readerWordClass(undefined, false, "ASSISTED_PRACTICE");
    table["ASSISTED_PRACTICE|undefined|true"] = readerWordClass(undefined, true, "ASSISTED_PRACTICE");
    expect(table).toEqual({
      // Quiet mode draws the cursor and no judgement at all.
      "MONTHLY_ASSESSMENT|unread|false": "", "MONTHLY_ASSESSMENT|unread|true": "current",
      "MONTHLY_ASSESSMENT|current|false": "", "MONTHLY_ASSESSMENT|current|true": "current",
      "MONTHLY_ASSESSMENT|correct|false": "", "MONTHLY_ASSESSMENT|correct|true": "current",
      "MONTHLY_ASSESSMENT|incorrect|false": "", "MONTHLY_ASSESSMENT|incorrect|true": "current",
      "MONTHLY_ASSESSMENT|retried_correct|false": "", "MONTHLY_ASSESSMENT|retried_correct|true": "current",
      // Elsewhere: the cursor only ever marks a word the finals have not judged.
      "ASSISTED_PRACTICE|unread|false": "unread", "ASSISTED_PRACTICE|unread|true": "current",
      "ASSISTED_PRACTICE|current|false": "unread", "ASSISTED_PRACTICE|current|true": "current",
      "ASSISTED_PRACTICE|correct|false": "correct", "ASSISTED_PRACTICE|correct|true": "correct",
      "ASSISTED_PRACTICE|incorrect|false": "incorrect", "ASSISTED_PRACTICE|incorrect|true": "incorrect",
      "ASSISTED_PRACTICE|retried_correct|false": "retried_correct", "ASSISTED_PRACTICE|retried_correct|true": "retried_correct",
      "GUIDED_PRACTICE|unread|false": "unread", "GUIDED_PRACTICE|unread|true": "current",
      "GUIDED_PRACTICE|current|false": "unread", "GUIDED_PRACTICE|current|true": "current",
      "GUIDED_PRACTICE|correct|false": "correct", "GUIDED_PRACTICE|correct|true": "correct",
      "GUIDED_PRACTICE|incorrect|false": "incorrect", "GUIDED_PRACTICE|incorrect|true": "incorrect",
      "GUIDED_PRACTICE|retried_correct|false": "retried_correct", "GUIDED_PRACTICE|retried_correct|true": "retried_correct",
      "ASSISTED_PRACTICE|undefined|false": "unread", "ASSISTED_PRACTICE|undefined|true": "current",
    });
  });

  it("never lets the cursor repaint a word the finals have judged", () => {
    // The flicker fix, stated as a property rather than a case: for every judged status, the
    // class is the same whether or not the interim cursor is sitting on the word.
    for (const mode of ["ASSISTED_PRACTICE", "GUIDED_PRACTICE"] as const) {
      for (const settled of ["correct", "incorrect", "retried_correct"] as const) {
        expect(readerWordClass(settled, true, mode)).toBe(readerWordClass(settled, false, mode));
        expect(readerWordClass(settled, true, mode)).toBe(settled);
      }
    }
  });
});

describe("the cursor held inside the page", () => {
  it("holds a cursor that has run onto a later page at the page's last word", () => {
    expect(cursorWithinPage(37, 16, 31)).toBe(31);
  });
  it("holds a cursor that is still on an earlier page at the page's first word", () => {
    expect(cursorWithinPage(4, 16, 31)).toBe(16);
  });
  it("leaves a cursor that is on this page alone", () => {
    expect(cursorWithinPage(20, 16, 31)).toBe(20);
  });
});
