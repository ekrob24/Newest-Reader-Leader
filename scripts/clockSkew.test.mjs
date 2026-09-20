import { describe, expect, it } from "vitest";
import { skewReport } from "./clock-skew.mjs";

/**
 * The diagnostic settles a question, so its arithmetic is tested rather than trusted.
 * A wrong sign here would send the reader looking at the wrong clock.
 */
const at = iso => new Date(iso);
const read = (mysqlNow, now, extra = {}) => skewReport({
  globalTz: "SYSTEM", sessionTz: "UTC", machineTz: "Europe/London", offsetHours: 1,
  mysqlNow: at(mysqlNow), now: at(now), ...extra,
}).join("\n");

describe("reading the clock skew", () => {
  it("reports the hour a BST machine reads a UTC server's timestamp one hour early", () => {
    // The failing assertion was 3,599,708ms - an hour, less the test's own runtime.
    const out = read("2026-09-20T12:00:00Z", "2026-09-20T13:00:00Z");
    expect(out).toContain("SKEW: 60 minutes.");
    expect(out).toContain("MySQL session time_zone  : UTC");
    expect(out).toContain("This machine's timezone  : Europe/London (UTC+1)");
  });

  it("keeps the sign when the skew runs the other way", () => {
    expect(read("2026-09-20T13:00:00Z", "2026-09-20T12:00:00Z")).toContain("SKEW: -60 minutes.");
  });

  it("calls a machine that agrees with its server no-skew, and says to look elsewhere", () => {
    const out = read("2026-09-20T13:00:00Z", "2026-09-20T13:00:20Z", { sessionTz: "SYSTEM", offsetHours: 0 });
    expect(out).toContain("No skew.");
    expect(out).toContain("some other cause");
    expect(out).not.toContain("SKEW:");
  });

  it("does not call a few seconds of query time a skew", () => {
    expect(read("2026-09-20T13:00:00Z", "2026-09-20T13:00:45Z")).toContain("No skew.");
  });

  it("shows a negative offset without a stray plus sign", () => {
    expect(read("2026-09-20T13:00:00Z", "2026-09-20T13:00:00Z", { offsetHours: -5 })).toContain("(UTC-5)");
  });
});
