import { describe, expect, it } from "vitest";
import { EXCEPTIONS, partitionFailures, playwrightFailure, summariseVitest, summarisePlaywright, verdict, vitestFailures } from "./gate.mjs";

/**
 * The failure this script exists to prevent is a green verdict over a gate that never ran.
 * So every case below that does not run is asserted to be red, not merely "not passed".
 */
const gateFile = (assertionResults, name = "D:\\reader-leader\\server\\demoFallbackGate.integration.test.ts") => ({ name, assertionResults });
const vitestReport = (files, counts = {}) => ({ testResults: files, numPassedTests: 0, numFailedTests: 0, numPendingTests: 0, ...counts });

const pwSpec = (title, ok, status = ok ? "passed" : "failed") => ({ title, ok, tests: [{ results: [{ status }] }] });
const pwReport = specs => ({ suites: [{ specs: [], suites: [{ specs }] }] });

const bothJourneysPass = summarisePlaywright(pwReport([
  pwSpec("the demo journey", true),
  pwSpec("a dropped function word does not stop the reading", true),
]));

describe("reading the vitest run", () => {
  it("calls the gate passed only when its assertions actually ran and passed", () => {
    const summary = summariseVitest(vitestReport([gateFile([{ fullName: "walks the demo", status: "passed" }])], { numPassedTests: 316 }));
    expect(summary.gate).toBe("passed");
    expect(verdict(summary, bothJourneysPass, [])).toBe(true);
  });

  it("calls a skipped gate skipped, not passed, and refuses to go green", () => {
    // This is the state in the container that could not start MySQL: zero failures, and a
    // gate that never saw a database.
    const summary = summariseVitest(vitestReport([gateFile([{ fullName: "walks the demo", status: "skipped" }])], { numPassedTests: 315, numPendingTests: 58 }));
    expect(summary.gate).toBe("skipped");
    expect(summary.failed).toBe(0);
    expect(verdict(summary, bothJourneysPass, [])).toBe(false);
  });

  it("calls a gate that is not in the run at all missing, and refuses to go green", () => {
    const summary = summariseVitest(vitestReport([{ name: "server/reader.test.ts", assertionResults: [{ status: "passed" }] }], { numPassedTests: 12 }));
    expect(summary.gate).toBe("missing");
    expect(verdict(summary, bothJourneysPass, [])).toBe(false);
  });

  it("names the failing gate assertion", () => {
    const summary = summariseVitest(vitestReport([gateFile([
      { fullName: "the fallback demo's four numbers > walks the demo", status: "failed" },
    ])], { numFailedTests: 1 }));
    expect(summary.gate).toBe("failed");
    expect(summary.gateFailures).toEqual(["the fallback demo's four numbers > walks the demo"]);
    expect(verdict(summary, bothJourneysPass, [])).toBe(false);
  });

  it("finds the gate file whichever way the path is written", () => {
    for (const path of ["server/demoFallbackGate.integration.test.ts", "D:\\rl\\server\\demoFallbackGate.integration.test.ts", "/home/e/rl/server/demoFallbackGate.integration.test.ts"]) {
      expect(summariseVitest(vitestReport([gateFile([{ status: "passed" }], path)])).gate).toBe("passed");
    }
  });

  it("goes red when the gate passed but something else in the suite failed", () => {
    const summary = summariseVitest(vitestReport([gateFile([{ status: "passed" }])], { numPassedTests: 300, numFailedTests: 2 }));
    expect(summary.gate).toBe("passed");
    expect(verdict(summary, bothJourneysPass, [{ name: "something", file: "x.test.ts" }])).toBe(false);
  });

  it("survives a report it could not read at all", () => {
    const summary = summariseVitest(null);
    expect(summary.gate).toBe("missing");
    expect(verdict(summary, bothJourneysPass, [])).toBe(false);
  });
});

describe("reading the Playwright run", () => {
  const passingGate = summariseVitest(vitestReport([gateFile([{ status: "passed" }])], { numPassedTests: 316 }));

  it("reports both journeys by name when both pass", () => {
    expect(bothJourneysPass).toEqual([
      { title: "the demo journey", status: "passed" },
      { title: "a dropped function word does not stop the reading", status: "passed" },
    ]);
  });

  it("goes red when one journey fails", () => {
    const journeys = summarisePlaywright(pwReport([
      pwSpec("the demo journey", true),
      pwSpec("a dropped function word does not stop the reading", false),
    ]));
    expect(journeys[1].status).toBe("failed");
    expect(verdict(passingGate, journeys, [])).toBe(false);
  });

  it("goes red when a journey was skipped rather than run", () => {
    const journeys = summarisePlaywright(pwReport([
      pwSpec("the demo journey", true),
      pwSpec("a dropped function word does not stop the reading", false, "skipped"),
    ]));
    expect(journeys[1].status).toBe("skipped");
    expect(verdict(passingGate, journeys, [])).toBe(false);
  });

  it("goes red when a journey is absent from the report, including an empty one", () => {
    for (const report of [pwReport([pwSpec("the demo journey", true)]), {}, null]) {
      const journeys = summarisePlaywright(report);
      expect(journeys.some(journey => journey.status === "missing")).toBe(true);
      expect(verdict(passingGate, journeys, [])).toBe(false);
    }
  });
});

describe("saying what actually failed", () => {
  it("names each failing test, its file, and the first line of why", () => {
    const failures = vitestFailures({ testResults: [
      { name: "D:\\rl\\server\\reviewQueue.integration.test.ts", assertionResults: [
        { status: "passed", fullName: "fine" },
        { status: "failed", fullName: "orders the queue", failureMessages: ["\u001b[31mAssertionError\u001b[39m: expected 3 to be 2\n  at line 9\n"] },
      ] },
      { name: "/home/e/rl/server/reader.test.ts", assertionResults: [
        { status: "failed", title: "scores a reading", failureMessages: [] },
      ] },
    ] });
    expect(failures).toEqual([
      { file: "reviewQueue.integration.test.ts", name: "orders the queue", message: "AssertionError: expected 3 to be 2" },
      { file: "reader.test.ts", name: "scores a reading", message: "" },
    ]);
  });

  it("returns nothing when nothing failed, and survives an unreadable report", () => {
    expect(vitestFailures({ testResults: [{ name: "a.test.ts", assertionResults: [{ status: "passed" }] }] })).toEqual([]);
    expect(vitestFailures(null)).toEqual([]);
  });

  it("pulls the journey's own error text out, stripped of colour codes", () => {
    const report = { suites: [{ specs: [{ title: "the demo journey", ok: false, tests: [{ results: [{
      error: { message: "Error: \u001b[31mexpect(received)\u001b[39m.toHaveCount(expected)\n\nExpected: 2\nReceived: 0\n" },
    }] }] }] }] };
    const why = playwrightFailure(report, "the demo journey");
    expect(why).toContain("toHaveCount");
    expect(why).toContain("Expected: 2");
    expect(why).not.toContain("\u001b");
  });

  it("falls back to the errors array, and returns empty for a journey it cannot find", () => {
    const report = { suites: [{ specs: [{ title: "the demo journey", ok: false, tests: [{ results: [{ errors: [{ message: "boom" }] }] }] }] }] };
    expect(playwrightFailure(report, "the demo journey")).toBe("boom");
    expect(playwrightFailure(report, "a dropped function word does not stop the reading")).toBe("");
    expect(playwrightFailure(null, "the demo journey")).toBe("");
  });
});

describe("the runner's own tests", () => {
  it("notices when its own test file was not collected", () => {
    const withoutOwn = summariseVitest({ testResults: [{ name: "server/reader.test.ts", assertionResults: [{ status: "passed" }] }] });
    expect(withoutOwn.ownTestsRan).toBe(false);
    const withOwn = summariseVitest({ testResults: [{ name: "D:\\rl\\scripts\\gate.test.mjs", assertionResults: [{ status: "passed" }] }] });
    expect(withOwn.ownTestsRan).toBe(true);
  });
});

describe("the exception mechanism", () => {
  // Tested against a fixture entry, not against whatever EXCEPTIONS happens to hold, so the
  // mechanism stays covered when the list is empty - which it is, and which is the point:
  // the one entry it held was removed when its cause was refuted.
  const recorded = {
    file: "sessionIdentity.integration.test.ts",
    name: "session identity prefers server time for a tablet whose clock is far out, without discarding the reading",
    reason: "pre-existing timezone skew",
    recorded: "2026-09-20",
    holdsWhen: measured => typeof measured?.clockSkewMinutes === "number" && Math.abs(measured.clockSkewMinutes) > 1,
  };
  const list = [recorded];
  const skewed = { clockSkewMinutes: 60 };
  const theFailure = { file: recorded.file, name: recorded.name, message: "AssertionError: expected 3599708 to be less than 60000" };
  const passingGate = summariseVitest(vitestReport([gateFile([{ status: "passed" }])], { numPassedTests: 372, numFailedTests: 1 }));

  it("excuses nothing today, because the list is empty", () => {
    // The entry that was here excused a failure on a cause the measurement then refuted.
    expect(EXCEPTIONS).toEqual([]);
    const { blocking, excused } = partitionFailures([theFailure], skewed);
    expect(excused).toEqual([]);
    expect(blocking).toEqual([theFailure]);
    expect(verdict(passingGate, bothJourneysPass, blocking)).toBe(false);
  });

  it("excuses exactly the named test, on a machine where the condition holds", () => {
    const { blocking, excused } = partitionFailures([theFailure], skewed, list);
    expect(blocking).toEqual([]);
    expect(excused).toHaveLength(1);
    expect(excused[0].reason).toBe("pre-existing timezone skew");
    expect(excused[0].recorded).toBe("2026-09-20");
    expect(verdict(passingGate, bothJourneysPass, blocking)).toBe(true);
  });

  it("does not excuse it where the condition does not hold - not established is not excused", () => {
    for (const measured of [{ clockSkewMinutes: 0 }, { clockSkewMinutes: 1 }, null, undefined, {}]) {
      const { blocking, excused } = partitionFailures([theFailure], measured, list);
      expect(excused).toEqual([]);
      expect(blocking).toHaveLength(1);
      expect(verdict(passingGate, bothJourneysPass, blocking)).toBe(false);
    }
  });

  it("does not let an exception swallow a second failure alongside it", () => {
    const other = { file: "reviewQueue.integration.test.ts", name: "orders the queue", message: "expected 3 to be 2" };
    const { blocking, excused } = partitionFailures([theFailure, other], skewed, list);
    expect(excused.map(item => item.name)).toEqual([recorded.name]);
    expect(blocking).toEqual([other]);
    expect(verdict(passingGate, bothJourneysPass, blocking)).toBe(false);
  });

  it("does not cover a different test in the same file", () => {
    const sibling = { file: recorded.file, name: "session identity keeps a plausible device clock and marks it authoritative", message: "boom" };
    const { blocking, excused } = partitionFailures([sibling], skewed, list);
    expect(excused).toEqual([]);
    expect(blocking).toEqual([sibling]);
  });

  it("does not cover the same test name arriving from a different file", () => {
    const elsewhere = { file: "somethingElse.integration.test.ts", name: recorded.name, message: "boom" };
    expect(partitionFailures([elsewhere], skewed, list).blocking).toEqual([elsewhere]);
  });

  it("still goes red when the gate numbers move, exception or not", () => {
    const movedGate = summariseVitest(vitestReport([gateFile([{ fullName: "walks the demo", status: "failed" }])], { numFailedTests: 2 }));
    const { blocking } = partitionFailures([theFailure], skewed, list);
    expect(blocking).toEqual([]);
    expect(verdict(movedGate, bothJourneysPass, blocking)).toBe(false);
  });

  it("still goes red when a journey fails, exception or not", () => {
    const journeys = summarisePlaywright(pwReport([
      pwSpec("the demo journey", false),
      pwSpec("a dropped function word does not stop the reading", true),
    ]));
    const { blocking } = partitionFailures([theFailure], skewed, list);
    expect(verdict(passingGate, journeys, blocking)).toBe(false);
  });

  it("requires every entry that ever exists to carry a reason, a date and a condition", () => {
    for (const item of [...EXCEPTIONS, recorded]) {
      expect(item.reason).toBeTruthy();
      expect(item.recorded).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof item.holdsWhen).toBe("function");
    }
  });
});
