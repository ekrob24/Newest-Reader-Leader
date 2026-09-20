#!/usr/bin/env node
/**
 * Run the gate and say, in words, whether it held.
 *
 * The four numbers in server/demoFallbackGate.integration.test.ts and the two browser
 * journeys in e2e/demo-journey.spec.ts are the demo. They are skipped, not passed, without a
 * database, and a skipped gate reads as green in any summary line that counts failures. So
 * this reports the gate and the journeys by name, states plainly when either did not run, and
 * treats "did not run" as a failure of the check.
 *
 * Cross-platform on purpose: the only Windows-specific thing left is which shell pastes it.
 *
 *   node scripts/gate.mjs
 *   node scripts/gate.mjs --mysql-password "yourpassword"
 */
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const GATE_TEST_FILE = "demoFallbackGate.integration.test.ts";
export const OWN_TEST_FILE = "gate.test.mjs";
export const JOURNEYS = ["the demo journey", "a dropped function word does not stop the reading"];

/**
 * What the vitest run says about the gate.
 *
 * A gate that did not run is not a gate that passed. vitest reports a skipped test as
 * "pending" or "skipped" and counts it in neither passed nor failed, which is exactly how a
 * missing database has been reading as success in this project all week.
 */
export function summariseVitest(report) {
  const files = report?.testResults ?? [];
  const gateFile = files.find(file => String(file.name ?? "").replace(/\\/g, "/").endsWith(GATE_TEST_FILE));
  const assertions = gateFile?.assertionResults ?? [];
  const ran = assertions.filter(item => item.status === "passed" || item.status === "failed");
  const gate = !gateFile ? "missing" : ran.length === 0 ? "skipped" : ran.every(item => item.status === "passed") ? "passed" : "failed";
  return {
    gate,
    // Whether this script's own tests were collected. The first run reported eleven fewer
    // tests than the same commit collects elsewhere, which is exactly the size of this file,
    // so the next run says outright whether it ran rather than leaving it to arithmetic.
    ownTestsRan: files.some(file => String(file.name ?? "").replace(/\\/g, "/").endsWith(OWN_TEST_FILE)),
    gateFailures: assertions.filter(item => item.status === "failed").map(item => item.fullName ?? item.title ?? "(unnamed)"),
    passed: report?.numPassedTests ?? 0,
    failed: report?.numFailedTests ?? 0,
    skipped: (report?.numPendingTests ?? 0) + (report?.numTodoTests ?? 0),
  };
}

/** Every spec Playwright ran, flattened, with the status it ended on. */
export function summarisePlaywright(report) {
  const found = new Map();
  const walk = suite => {
    for (const spec of suite?.specs ?? []) {
      const status = spec.ok === true ? "passed" : (spec.tests ?? []).some(test => (test.results ?? []).some(run => run.status === "skipped")) ? "skipped" : "failed";
      found.set(spec.title, status);
    }
    for (const child of suite?.suites ?? []) walk(child);
  };
  for (const suite of report?.suites ?? []) walk(suite);
  return JOURNEYS.map(title => ({ title, status: found.get(title) ?? "missing" }));
}

/** Strip ANSI so a verdict pasted into a chat window is readable. */
const plain = text => String(text ?? "").replace(/\u001b\[[0-9;]*m/g, "");

/** The failing tests, named, with the first useful line of each failure. */
export function vitestFailures(report) {
  const out = [];
  for (const file of report?.testResults ?? []) {
    for (const item of file.assertionResults ?? []) {
      if (item.status !== "failed") continue;
      const message = plain((item.failureMessages ?? [])[0]).split(/\r?\n/).filter(line => line.trim())[0] ?? "";
      out.push({ name: item.fullName ?? item.title ?? "(unnamed)", file: String(file.name ?? "").replace(/\\/g, "/").split("/").slice(-1)[0], message });
    }
  }
  return out;
}

/** Why a journey failed, in the first few lines Playwright wrote about it. */
export function playwrightFailure(report, title) {
  const found = [];
  const walk = suite => {
    for (const spec of suite?.specs ?? []) if (spec.title === title) found.push(spec);
    for (const child of suite?.suites ?? []) walk(child);
  };
  for (const suite of report?.suites ?? []) walk(suite);
  for (const spec of found) {
    for (const test of spec.tests ?? []) {
      for (const run of test.results ?? []) {
        const message = plain(run.error?.message ?? (run.errors ?? [])[0]?.message);
        if (message.trim()) return message.split(/\r?\n/).filter(line => line.trim()).slice(0, 6).join("\n");
      }
    }
  }
  return "";
}

/** True only when everything the demo rests on actually ran and actually passed. */
export function verdict(vitest, journeys) {
  return vitest.gate === "passed" && vitest.failed === 0 && journeys.every(journey => journey.status === "passed");
}

// ---------------------------------------------------------------------------
// Everything below is the runner. The three functions above hold the judgement
// and are covered by scripts/gate.test.mjs.
// ---------------------------------------------------------------------------

// Run when invoked directly, import cleanly from the tests. Compared case-insensitively
// because Windows hands back a drive letter in whichever case the shell used.
const invokedAs = process.argv[1] ? resolve(process.argv[1]).toLowerCase() : "";
if (invokedAs === fileURLToPath(import.meta.url).toLowerCase()) await main();

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  process.chdir(root);
  const work = mkdtempSync(join(tmpdir(), "rl-gate-"));
  const args = process.argv.slice(2);
  const passwordAt = args.indexOf("--mysql-password");
  const mysqlPassword = passwordAt >= 0 ? args[passwordAt + 1] : process.env.MYSQL_ROOT_PASSWORD;

  if (!(await mysqlIsListening())) {
    fail("No MySQL is listening on 127.0.0.1:3306.", [
      "Start MySQL 8 and run this again. With Docker Desktop:",
      '  docker run -d --name rl-mysql -e MYSQL_ROOT_PASSWORD=rlroot -p 3306:3306 mysql:8.0',
      "Wait thirty seconds after starting it.",
    ]);
  }

  // The same five variables scripts/run-local.ps1 sets, for the same reasons.
  //
  // A database of its own, not the rl_local the demo runs on. Both phases below need a
  // database where the seeded record carries no teacher decisions - scripts/seed-preview.mjs
  // says so in as many words - and the first run of this script proved why: it ran the suite
  // first, the gate test confirmed and overrode two moments and left them recorded, and the
  // demo journey then failed on its own precondition. Wiping rl_local to avoid that would
  // take the demo's database with it, so the gate gets its own and wipes that.
  const env = { ...process.env };
  const ownsDatabase = !env.DATABASE_URL;
  if (ownsDatabase) env.DATABASE_URL = `mysql://root:${encodeURIComponent(mysqlPassword ?? "rlroot")}@127.0.0.1:3306/rl_gate`;
  env.JWT_SECRET ??= "local-development-secret";
  env.VITE_APP_ID ??= "reader-leader-local";
  env.PORT ??= "3100";
  env.READER_LEADER_CHILD_DEMO_PASSWORD ??= "reader-child-2026";
  env.READER_LEADER_TEACHER_DEMO_PASSWORD ??= "reader-teacher-2026";
  env.READER_LEADER_PARENT_DEMO_PASSWORD ??= "reader-parent-2026";
  env.NODE_ENV = "production";
  // Playwright reuses a server that is already up only when CI is unset, and this script
  // starts the server itself rather than letting Playwright run `pnpm start` - that script
  // begins with a POSIX environment assignment, which Windows shells do not understand.
  delete env.CI;

  await step("Installing dependencies", "pnpm", ["install", "--frozen-lockfile"], env);
  await step("Building", "pnpm", ["build"], env);
  // Not fatal. A machine that already has the browser, or cannot reach the download, should
  // still get as far as running the journeys - and if the browser really is missing,
  // Playwright says so itself and the journeys are reported failed rather than the whole
  // check stopping on a download.
  await step("Fetching the test browser (skipped if already present)", "pnpm", ["exec", "playwright", "install", "chromium"], env, { allowAnyExit: true });

  await freshDatabase(env, ownsDatabase);
  const vitestFile = join(work, "vitest.json");
  const vitestRun = await step("Running the whole test suite against a fresh database", "pnpm",
    ["exec", "vitest", "run", "--reporter=json", `--outputFile=${vitestFile}`], env, { allowAnyExit: true });
  const vitestReport = readJson(vitestFile);
  const vitest = summariseVitest(vitestReport);

  // Again, because the suite leaves teacher decisions behind and the journeys need none.
  await freshDatabase(env, ownsDatabase);

  const server = spawn(process.execPath, ["dist/index.js"], { env });
  let serverOutput = "";
  const collectServer = chunk => { serverOutput = (serverOutput + chunk).slice(-20_000); };
  server.stdout.on("data", collectServer);
  server.stderr.on("data", collectServer);
  let journeys = JOURNEYS.map(title => ({ title, status: "missing" }));
  let playwrightReport = null;
  let serverUp = false;
  try {
    serverUp = await waitForServer(Number(env.PORT));
    if (!serverUp) {
      say("  The app did not start, so the browser journeys could not run. It said:");
      say(serverOutput.split(/\r?\n/).slice(-20).join("\n"));
    } else {
      const playwrightFile = join(work, "playwright.json");
      await step("Running both browser journeys", "pnpm", ["exec", "playwright", "test", "--reporter=json"],
        { ...env, PLAYWRIGHT_JSON_OUTPUT_NAME: playwrightFile }, { allowAnyExit: true });
      playwrightReport = readJson(playwrightFile);
      journeys = summarisePlaywright(playwrightReport);
    }
  } finally {
    server.kill();
  }

  report(vitest, journeys, vitestRun, vitestReport, playwrightReport);
}

/**
 * Drop and re-seed the gate's database.
 *
 * Only ever the database this script composed for itself. A DATABASE_URL set in the
 * environment is somebody's decision and is left entirely alone - the run is told it may not
 * be starting clean rather than having the choice taken away from it.
 */
async function freshDatabase(env, owns) {
  if (!owns) {
    say("-> Using the DATABASE_URL already set, and not wiping it.");
    say("   If the journeys fail on decisions already being recorded, that is why.");
  } else {
    say("-> Preparing a clean database...");
    const name = new URL(env.DATABASE_URL).pathname.replace(/^\//, "");
    if (!/^[A-Za-z0-9_]+$/.test(name)) fail(`Refusing to drop a database with an unusual name: ${name}`, []);
    const { default: mysql } = await import("mysql2/promise");
    const url = new URL(env.DATABASE_URL);
    let connection;
    try {
      connection = await mysql.createConnection({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) });
    } catch (error) {
      // A stack trace here is an error message that says nothing to the person reading it.
      if (error?.code === "ER_ACCESS_DENIED_ERROR") {
        fail(`MySQL rejected the login for user "${decodeURIComponent(url.username)}".`, [
          "That is the MySQL root password, not anything to do with the code. Run this again as:",
          '  node scripts/gate.mjs --mysql-password "yourpassword"',
        ]);
      }
      fail(`Could not connect to MySQL at ${url.hostname}:${url.port || 3306}.`, [
        `MySQL said: ${error?.code ?? error?.message ?? error}`,
        "If it has only just started, give it thirty seconds and run this again.",
      ]);
    }
    try { await connection.query(`DROP DATABASE IF EXISTS \`${name}\``); } finally { await connection.end(); }
  }
  await step("   seeding it", "pnpm", ["seed:preview"], env, { allowExitCodes: [3], onFail: [
    "If the message above mentions the login being rejected, this is the MySQL root password.",
    '  node scripts/gate.mjs --mysql-password "yourpassword"',
  ] });
}

function report(vitest, journeys, vitestRun, vitestReport, playwrightReport) {
  const line = "-".repeat(64);
  say(`\n${line}\nRESULT\n${line}`);

  if (vitest.gate === "passed") say("The four gate numbers HELD. 100% and an em dash, then 98% / 91, then 100% / 93, then 100% / 93.");
  else if (vitest.gate === "failed") { say("The four gate numbers DID NOT HOLD."); for (const name of vitest.gateFailures) say(`  failing: ${name}`); }
  else if (vitest.gate === "skipped") say("The four gate numbers WERE NOT CHECKED - the gate test was skipped, which means it could not see your database.");
  else say("The four gate numbers WERE NOT CHECKED - the gate test was not found in the run at all.");

  for (const journey of journeys) {
    const word = { passed: "PASSED", failed: "FAILED", skipped: "was SKIPPED", missing: "DID NOT RUN" }[journey.status];
    say(`Browser journey "${journey.title}" ${word}.`);
    if (journey.status !== "passed") {
      const why = playwrightFailure(playwrightReport, journey.title);
      for (const line of (why || "  (Playwright recorded no message for it.)").split("\n")) say(`    ${line}`);
    }
  }

  say(`\nEverything else: ${vitest.passed} tests passed, ${vitest.failed} failed, ${vitest.skipped} skipped.`);
  if (!vitest.ownTestsRan) say(`(${OWN_TEST_FILE} was not collected on this machine - this script's own tests did not run.)`);
  if (vitestRun.timedOut) say("(the test run was stopped after an hour)");

  // Say which ones. A verdict with no diagnosis sends the reader back to whoever wrote this
  // with nothing to act on, which is exactly what the first version of this script did.
  const failures = vitestFailures(vitestReport);
  if (failures.length) {
    say("\nThe tests that failed:");
    for (const failure of failures) {
      say(`  ${failure.file} - ${failure.name}`);
      if (failure.message) say(`      ${failure.message}`);
    }
  }

  const green = verdict(vitest, journeys);
  say(`\n${line}`);
  if (green) {
    say("GREEN. The gate held and both journeys passed. Nothing to do.");
    say(line);
    process.exit(0);
  }
  say("RED. Do not carry this into the final as it stands.");
  say("");
  if (vitest.gate === "passed") {
    say("The four numbers the fallback demo rests on are fine. What failed is above.");
    say("Send this whole window before changing anything - the named failures say where to");
    say("look, and reverting on a guess costs a run.");
  } else {
    say("The gate itself moved, which is the serious case. To take off the change that");
    say("touches the live reading cursor and keep the tricky-words removal:");
    say("");
    say("  git revert --no-edit f8e1921");
    say("  git push");
    say("  node scripts/gate.mjs");
    say("");
    say("If it is still red after that, the problem is older than both changes. Send this");
    say("whole window and stop there.");
  }
  say(line);
  process.exit(1);
}

function say(text) { process.stdout.write(`${text}\n`); }

function fail(headline, lines) {
  say(`\n${headline}\n`);
  for (const line of lines) say(line);
  process.exit(1);
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function mysqlIsListening() {
  return new Promise(resolve => {
    const socket = createConnection({ host: "127.0.0.1", port: 3306 });
    const settle = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(4000);
    socket.on("connect", () => settle(true));
    socket.on("timeout", () => settle(false));
    socket.on("error", () => settle(false));
  });
}

async function waitForServer(port) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
      return true;
    } catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
  }
  return false;
}

/** Run one step quietly. On failure, show the tail of what it said and stop. */
function step(label, command, commandArgs, env, options = {}) {
  say(`-> ${label}...`);
  return new Promise(resolve => {
    // shell: true so that `pnpm` resolves to pnpm.cmd on Windows.
    const child = spawn(command, commandArgs, { env, shell: true });
    let output = "";
    const collect = chunk => { output += chunk; if (output.length > 200_000) output = output.slice(-200_000); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 60 * 60 * 1000);
    child.on("close", code => {
      clearTimeout(timer);
      const ok = !timedOut && (code === 0 || (options.allowExitCodes ?? []).includes(code));
      if (ok || options.allowAnyExit) return resolve({ code, output, timedOut });
      say("");
      say(output.split(/\r?\n/).slice(-30).join("\n"));
      say("");
      say(`${label} failed. Stopping here.`);
      for (const line of options.onFail ?? []) say(line);
      process.exit(1);
    });
  });
}
