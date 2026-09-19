import { describe, expect, it } from "vitest";
import { SESSION_ID_LENGTH, createSessionIdFactory, isSessionId, newSessionId, sessionIdTime } from "./sessionId";

describe("session identifiers", () => {
  it("is 26 Crockford base32 characters", () => {
    const id = newSessionId();
    expect(id).toHaveLength(SESSION_ID_LENGTH);
    expect(isSessionId(id)).toBe(true);
    expect(id).not.toMatch(/[ILOU]/);
  });

  it("encodes the capture time so ids sort in capture order", () => {
    let clock = 1_700_000_000_000;
    const next = createSessionIdFactory({ now: () => clock });
    const first = next();
    clock += 1000;
    const second = next();
    expect(sessionIdTime(first)).toBe(1_700_000_000_000);
    expect(first < second).toBe(true);
    expect([second, first].sort()).toEqual([first, second]);
  });

  it("stays monotonic within a single millisecond", () => {
    const next = createSessionIdFactory({ now: () => 1_700_000_000_000, random: () => 0 });
    const ids = Array.from({ length: 50 }, next);
    expect(new Set(ids).size).toBe(50);
    expect([...ids].sort()).toEqual(ids);
  });

  it("does not collide across many draws", () => {
    const ids = new Set(Array.from({ length: 20_000 }, () => newSessionId()));
    expect(ids.size).toBe(20_000);
  });

  it("rejects values that are not session ids", () => {
    for (const bad of ["", "abc", "I".repeat(26), "0".repeat(25), "0".repeat(27), `${"0".repeat(25)}u`]) {
      expect(isSessionId(bad)).toBe(false);
    }
    // Lowercase is not accepted: one canonical form avoids two ids for one session.
    expect(isSessionId(newSessionId().toLowerCase())).toBe(false);
  });
});
