import { describe, expect, it } from "vitest";
import { clockReport, columnSkewMinutes, ulidTime } from "./clock-skew.mjs";
import { createSessionIdFactory, newSessionId, sessionIdTime } from "../shared/sessionId";

/**
 * This diagnostic already reported one confident wrong answer - "no skew", measured off NOW(),
 * while the column it was standing in for was still an hour out. So its arithmetic and its
 * wording are both tested, and the ULID decode is held against the real implementation.
 */
const view = { machineTz: "Europe/London", offsetHours: 1 };
const rows = (...gaps) => gaps.map((gapMinutes, index) => ({ id: `id-${index}`, gapMinutes }));
const read = (overrides = {}) => clockReport({
  globalTz: "SYSTEM", sessionTz: "SYSTEM", systemTz: "GMT Summer Time",
  functionSkewMinutes: 0, samples: rows(0), ...overrides,
}, view).join("\n");

describe("decoding a session id's own timestamp", () => {
  it("agrees with the real implementation across a spread of instants", () => {
    for (const at of [0, 1, 1_000, Date.now(), Date.UTC(2026, 8, 20, 14, 45, 13), 281474976710655]) {
      const id = createSessionIdFactory({ now: () => at })();
      expect(ulidTime(id)).toBe(at);
      expect(ulidTime(id)).toBe(sessionIdTime(id));
    }
    const live = newSessionId();
    expect(ulidTime(live)).toBe(sessionIdTime(live));
  });

  it("returns null rather than a wrong number for anything that is not an id", () => {
    for (const bad of ["", "short", null, undefined, 42, "I".repeat(26), "0".repeat(25)]) {
      expect(ulidTime(bad)).toBeNull();
    }
    expect(ulidTime("0".repeat(26))).toBe(0);
  });
});

describe("agreeing on one column gap", () => {
  it("returns the shared gap when every row agrees", () => {
    expect(columnSkewMinutes(rows(60, 60, 60))).toBe(60);
    expect(columnSkewMinutes(rows(0, 0))).toBe(0);
  });
  it("returns null when the rows disagree, rather than picking one", () => {
    expect(columnSkewMinutes(rows(60, 0))).toBeNull();
    expect(columnSkewMinutes(rows(60, 60, 59))).toBeNull();
  });
  it("returns null when there is nothing to measure", () => {
    expect(columnSkewMinutes([])).toBeNull();
    expect(columnSkewMinutes(undefined)).toBeNull();
  });
});

describe("what the reading says", () => {
  it("always prints what SYSTEM resolves to, which the first version omitted", () => {
    expect(read()).toContain('MySQL system_time_zone   : GMT Summer Time   <- what "SYSTEM" resolves to');
  });

  it("names the column, not the function, when only the column is out", () => {
    const out = read({ functionSkewMinutes: 0, samples: rows(60, 60) });
    expect(out).toContain("THE FUNCTION: NOW(), read back, is exactly on this machine's clock.");
    expect(out).toContain("createdAt is 60 minutes behind the instant each row's own id was minted");
    expect(out).toContain("The column is out by 60 minutes and the function is not.");
  });

  it("refuses to excuse anything when neither is skewed", () => {
    const out = read({ functionSkewMinutes: 0, samples: rows(0, 0, 0) });
    expect(out).toContain("Neither is skewed.");
    expect(out).toContain("nothing here excuses it");
    expect(out).not.toContain("The column is out by");
  });

  it("says so, and asks for the output, when the rows disagree among themselves", () => {
    const out = read({ samples: rows(60, 0, 60) });
    expect(out).toContain("do NOT agree with each other");
    expect(out).toContain("Send this whole output");
  });

  it("says it measured nothing when there are no saved readings, rather than no skew", () => {
    const out = read({ samples: [] });
    expect(out).toContain("no saved readings to measure");
    expect(out).toContain("says nothing about the failing assertion");
    expect(out).not.toContain("Neither is skewed");
  });

  it("keeps the direction straight", () => {
    expect(read({ samples: rows(-60) })).toContain("60 minutes ahead of the instant");
    expect(read({ functionSkewMinutes: -30, samples: rows(0) })).toContain("NOW(), read back, is 30 minutes ahead of this machine's clock");
  });

  it("reports a connection failure as a connection failure and measures nothing", () => {
    expect(clockReport({ error: "ER_ACCESS_DENIED_ERROR" }, view)).toEqual(["Could not connect: ER_ACCESS_DENIED_ERROR"]);
  });
});
