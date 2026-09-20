#!/usr/bin/env node
/**
 * Fails the build on assertions that cannot fail.
 *
 * Why this exists. Three times in this project an assertion has been written that asserted
 * nothing, and none was caught by reading it back:
 *
 *   `expect(true).toBe(true)` standing in for a note that belonged in a comment.
 *   `all(... for r in [])`, vacuously true, short-circuiting past the real check behind it.
 *   Five `toMatch` assertions against a value that was always the empty string, because a
 *   response envelope was not being unwrapped. All five passed. The suite was green.
 *
 * The third is the one that makes this worth a build step: it is the project's own
 * characteristic defect - asserting something that was never observed - appearing inside the
 * mechanism built to catch that defect. Mutation testing found it. Mutation testing is the
 * thorough answer and it is manual; this is the free one that runs every time.
 *
 * The general rule this enforces: assert the shape before matching the content. A `toMatch`
 * or `toContain` against a value nobody has proven is non-empty is a coin that only lands one
 * way. Where the rule cannot be expressed mechanically it is written in ENGINE_PROPOSAL.md
 * instead, because a rule nobody can see is not a rule.
 *
 * This is a lint, so it is deliberately shallow: it catches the literal shapes, not every
 * vacuous assertion anyone could write. A check that claimed to catch all of them would be
 * making exactly the kind of unfounded assertion it exists to ban.
 *
 *   node scripts/assert-test-quality.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The application's own test roots, named rather than discovered.
 *
 * `asr-benchmark/` is deliberately absent. It is an evaluation framework that runs beside the
 * product, not inside it: its tests are Python, nothing here imports it, and this scan neither
 * walks it nor is meant to. Were the roots ever replaced by a walk of the repository, this
 * check would start reading Python and either find nothing and pass or throw - and it is a
 * guard against assertions that cannot fail, so it must not become one.
 */
const ROOTS = ["server", "shared", "client", "e2e"];
const TEST_FILE = /\.(test|spec)\.(ts|tsx|mts)$/;

/** Each rule says what it bans and, in `why`, what to do instead. */
const RULES = [
  {
    name: "constant-assertion",
    // expect(true).toBe(true) and friends. A literal compared to a literal.
    pattern: /expect\(\s*(true|false)\s*\)/g,
    why: "expect(true)/expect(false) cannot fail. If it is a note, write a comment; if it is a\n"
      + "     claim, assert the value the claim is about.",
  },
  {
    name: "self-comparison",
    pattern: /expect\(\s*(true|false)\s*\)\s*\.\s*toBe\(\s*\1\s*\)/g,
    why: "asserting a literal equals itself.",
  },
];

function testFiles(directory) {
  let found = [];
  let entries;
  try {
    entries = readdirSync(directory);
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found = found.concat(testFiles(path));
    else if (TEST_FILE.test(entry)) found.push(path);
  }
  return found;
}

const files = ROOTS.flatMap(testFiles);
// A scan that found no files would pass silently, which is the vacuous-check failure again.
if (!files.length) {
  console.error("assert-test-quality: no test files found. Either the roots are wrong or the\n"
    + "tests are gone; both are a build failure, not a pass.");
  process.exit(2);
}

const problems = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  for (const rule of RULES) {
    lines.forEach((line, index) => {
      if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return;
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(line)) {
        problems.push({ file, line: index + 1, rule: rule.name, why: rule.why, text: line.trim() });
      }
    });
  }
}

console.log(`assert-test-quality: scanned ${files.length} test files`);
if (problems.length) {
  console.error(`\n${problems.length} assertion${problems.length === 1 ? "" : "s"} that cannot fail:\n`);
  for (const problem of problems) {
    console.error(`  ${problem.file}:${problem.line}  [${problem.rule}]`);
    console.error(`     ${problem.text}`);
    console.error(`     ${problem.why}\n`);
  }
  process.exit(1);
}
console.log("no always-true assertions found");
