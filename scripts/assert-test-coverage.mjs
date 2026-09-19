#!/usr/bin/env node
/**
 * Fails the build unless every test actually ran and passed.
 *
 * Why this exists. Seven suites in this repository are gated on DATABASE_URL and skip
 * silently without one. A CI job with no database would run the remaining subset, report
 * green, and quietly stop covering tenancy isolation, the session key change, the exercise
 * approval gate and the readingWords write path — the coverage that looks present and is not,
 * which is the exact failure this project keeps finding. A green badge gets quoted, so a
 * skipped suite has to turn CI red.
 *
 * The floor matters as much as the skip check. A collection failure produces zero tests, zero
 * skipped and zero failed, which a naive "no skips" guard passes happily. Asserting a minimum
 * total is what stops this check being vacuous.
 */
import { readFileSync } from "node:fs";

/**
 * Raise this when tests are added; it is a floor, not an expectation. Lowering it is a
 * deliberate act that should appear in a diff, because it means coverage was removed.
 */
const MINIMUM_TESTS = 163;

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("usage: assert-test-coverage.mjs <vitest-json-report>");
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (error) {
  console.error(`Could not read the vitest report at ${reportPath}: ${error.message}`);
  console.error("The test run did not produce a report, which is itself a failure.");
  process.exit(1);
}

const total = report.numTotalTests ?? 0;
const passed = report.numPassedTests ?? 0;
const failed = report.numFailedTests ?? 0;
const pending = report.numPendingTests ?? 0;
const todo = report.numTodoTests ?? 0;

const skippedNames = (report.testResults ?? [])
  .flatMap(file => (file.assertionResults ?? []).map(test => ({ file: file.name, test })))
  .filter(({ test }) => test.status === "pending" || test.status === "todo" || test.status === "skipped")
  .map(({ file, test }) => `  ${file.replace(process.cwd() + "/", "")} > ${test.fullName ?? test.title}`);

const problems = [];
if (failed > 0) problems.push(`${failed} test(s) failed.`);
if (pending + todo > 0) {
  problems.push(
    `${pending + todo} test(s) did not run. A skipped suite is not a passing suite — if these are the\n` +
    `database-gated suites, DATABASE_URL is missing or the database is unreachable:\n${skippedNames.join("\n")}`,
  );
}
if (total < MINIMUM_TESTS) {
  problems.push(
    `Only ${total} test(s) were collected, below the floor of ${MINIMUM_TESTS}. Either tests were\n` +
    `removed, or collection failed and this report is not describing the suite you think it is.`,
  );
}
if (total !== passed) problems.push(`${total} test(s) collected but only ${passed} passed.`);

console.log(`tests: ${total} collected, ${passed} passed, ${failed} failed, ${pending + todo} skipped (floor ${MINIMUM_TESTS})`);
if (problems.length) {
  console.error("\nTest coverage check failed:\n");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log("Every collected test ran and passed, and none were skipped.");
