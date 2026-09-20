#!/usr/bin/env node
/**
 * Why readingSessions.createdAt can come back an hour from the instant it was written.
 *
 * Read-only. It writes nothing, creates nothing and changes nothing.
 *
 * The first version of this asked MySQL for NOW() and compared it to this machine's clock.
 * That was the wrong measurement and it produced a confident "no skew" while the failing
 * assertion was still an hour out. NOW() is a function; createdAt is a TIMESTAMP column, and
 * MySQL converts a TIMESTAMP column through the session timezone on the way in and on the way
 * out. The two can disagree, and only the column is what the test reads.
 *
 * So this measures both, separately:
 *
 *   the function  - MySQL's NOW(), as the driver reads it, against this machine's clock.
 *   the column    - readingSessions.createdAt against the instant the row's own id was minted.
 *                   Every session id is a ULID whose leading 48 bits are the millisecond the
 *                   application generated it, one statement before the insert. That makes each
 *                   saved row carry its own independent record of when it was written, with no
 *                   database involved, so the comparison needs no writing and no guessing.
 *
 * It also prints @@system_time_zone, the value "SYSTEM" actually resolves to, which is the
 * thing the first version left out.
 *
 *   node scripts/clock-skew.mjs --mysql-password "yourpassword"
 */
import mysql from "mysql2/promise";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/**
 * The millisecond encoded in a ULID's first ten characters.
 *
 * Deliberately a local copy rather than an import: this file runs under plain `node`, and
 * shared/sessionId.ts is TypeScript. scripts/clockSkew.test.mjs holds the copy to the original
 * over a spread of ids, so the duplicate cannot drift.
 */
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function ulidTime(id) {
  if (typeof id !== "string" || id.length !== 26) return null;
  let total = 0;
  for (const char of id.slice(0, 10)) {
    const value = ENCODING.indexOf(char);
    if (value < 0) return null;
    total = total * 32 + value;
  }
  return total;
}

/** Read both clocks and both conversions. Nothing here writes. */
export async function measureClocks(url, now = () => Date.now()) {
  let connection;
  try {
    connection = await mysql.createConnection(url);
  } catch (error) {
    return { error: error?.code ?? error?.message ?? String(error) };
  }
  try {
    const [settings] = await connection.query(
      "SELECT @@global.time_zone AS globalTz, @@session.time_zone AS sessionTz, @@system_time_zone AS systemTz, NOW() AS mysqlNow",
    );
    const { globalTz, sessionTz, systemTz, mysqlNow } = settings[0];
    const asRead = mysqlNow instanceof Date ? mysqlNow : new Date(String(mysqlNow));
    const functionSkewMinutes = Number.isNaN(asRead.getTime()) ? null : Math.round((now() - asRead.getTime()) / 60000);

    let rows = [];
    try {
      // Every row, not the newest twenty. The first version of this sampled twenty and reported
      // "all agree" while the row the failing test complained about sat outside the window -
      // a sample that cannot contain the case under investigation answers a different question.
      const [saved] = await connection.query(
        "SELECT id, createdAt, capturedAt, capturedAtSource FROM readingSessions ORDER BY createdAt DESC LIMIT 2000",
      );
      rows = saved;
    } catch {
      rows = [];
    }
    const samples = [];
    for (const row of rows) {
      const minted = ulidTime(String(row.id));
      const stored = row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt));
      if (minted === null || Number.isNaN(stored.getTime())) continue;
      samples.push({
        id: String(row.id),
        gapMinutes: Math.round((stored.getTime() - minted) / 60000),
        createdAt: stored.toISOString(),
        minted: new Date(minted).toISOString(),
        capturedAtSource: String(row.capturedAtSource ?? ""),
        hasDeviceClock: row.capturedAt !== null && row.capturedAt !== undefined,
      });
    }
    return { globalTz, sessionTz, systemTz, functionSkewMinutes, samples };
  } finally {
    await connection.end();
  }
}

/**
 * A day. Beyond this a row was dated on purpose, not by a clock going wrong.
 *
 * The seeded monthly-assessment rows are backdated by months so a teacher has a trend to look
 * at, so their createdAt is nowhere near the instant their id was minted and never should be.
 * Reporting those as anomalies is crying wolf, which is how a diagnostic stops being read.
 */
const DELIBERATELY_DATED_MINUTES = 24 * 60;

export function splitSamples(samples) {
  const all = samples ?? [];
  return {
    written: all.filter(sample => Math.abs(sample.gapMinutes) < DELIBERATELY_DATED_MINUTES),
    deliberatelyDated: all.filter(sample => Math.abs(sample.gapMinutes) >= DELIBERATELY_DATED_MINUTES),
  };
}

/** The one number that decides it: the gap every row written at its own moment agrees on. */
export function columnSkewMinutes(samples) {
  const { written } = splitSamples(samples);
  if (!written.length) return null;
  const first = written[0].gapMinutes;
  return written.every(sample => sample.gapMinutes === first) ? first : null;
}

/**
 * The reading, as lines. Pure, so the arithmetic that decides what is skewed and what is not
 * is tested rather than trusted - the previous version of this reported "no skew" over a
 * defect that was really there, because it measured the wrong thing with correct arithmetic.
 */
export function clockReport(measurement, { machineTz, offsetHours }) {
  if (measurement.error) return [`Could not connect: ${measurement.error}`];
  const { globalTz, sessionTz, systemTz, functionSkewMinutes, samples } = measurement;
  const column = columnSkewMinutes(samples);
  const lines = [
    `MySQL global time_zone   : ${globalTz}`,
    `MySQL session time_zone  : ${sessionTz}`,
    `MySQL system_time_zone   : ${systemTz}   <- what "SYSTEM" resolves to`,
    `This machine's timezone  : ${machineTz} (UTC${offsetHours >= 0 ? "+" : ""}${offsetHours})`,
    "",
    `THE FUNCTION: NOW(), read back, is ${describe(functionSkewMinutes)} this machine's clock.`,
  ];

  const { written, deliberatelyDated } = splitSamples(samples);
  const dated = deliberatelyDated.length ? ` (${deliberatelyDated.length} more were dated on purpose and are not measured)` : "";
  if (!written.length) {
    lines.push(`THE COLUMN  : no readings written at their own moment to measure${dated}. Run the gate first, then this.`);
    lines.push("");
    lines.push("Without the column measurement this says nothing about the failing assertion.");
    return lines;
  }
  if (column === null) {
    // Show the rows that are out, not the first few rows. A timezone moves every row together;
    // a handful out among many is a different fault and the offenders are the evidence.
    const offenders = written.filter(sample => Math.abs(sample.gapMinutes) > 1);
    lines.push(`THE COLUMN  : ${written.length} rows measured${dated}; ${offenders.length} of them are out, the rest are exact.`);
    for (const sample of offenders.slice(0, 8)) {
      lines.push(`    ${sample.gapMinutes >= 0 ? "+" : ""}${sample.gapMinutes} min  ${sample.id}`);
      lines.push(`        createdAt ${sample.createdAt}  id minted ${sample.minted}  source ${sample.capturedAtSource}${sample.hasDeviceClock ? " (device clock recorded)" : ""}`);
    }
    lines.push("");
    lines.push("Some rows out and the rest exact is not a timezone setting - a timezone moves");
    lines.push("every row together. Whatever those rows have in common is the cause.");
    return lines;
  }
  lines.push(`THE COLUMN  : createdAt is ${describe(column)} the instant each row's own id was minted, across all ${written.length} measured rows${dated}.`);
  lines.push("");
  if (Math.abs(column) <= 1 && Math.abs(functionSkewMinutes ?? 0) <= 1) {
    lines.push("Neither is skewed. The failing assertion has some cause that is not the clock");
    lines.push("or the timezone, and nothing here excuses it.");
  } else if (Math.abs(column) > 1) {
    lines.push(`The column is out by ${column} minutes and the function is not. MySQL converts a`);
    lines.push("TIMESTAMP column through the session timezone in both directions; NOW() does not");
    lines.push("go through that conversion. That difference is the failing assertion.");
  } else {
    lines.push("The function is out but the column is not, which is the reverse of what the");
    lines.push("failing assertion describes. Send this whole output.");
  }
  return lines;
}

function describe(minutes) {
  if (minutes === null) return "unreadable against";
  if (minutes === 0) return "exactly on";
  return `${Math.abs(minutes)} minutes ${minutes > 0 ? "behind" : "ahead of"}`;
}

if (resolve(process.argv[1] ?? "").toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--mysql-password");
  const password = at >= 0 ? args[at + 1] : process.env.MYSQL_ROOT_PASSWORD ?? "rlroot";
  const url = process.env.DATABASE_URL ?? `mysql://root:${encodeURIComponent(password)}@127.0.0.1:3306/rl_gate`;
  const measurement = await measureClocks(url);
  const lines = clockReport(measurement, {
    machineTz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    offsetHours: -new Date().getTimezoneOffset() / 60,
  });
  for (const line of lines) console.log(line);
  if (measurement.error) {
    console.error('Run it as: node scripts/clock-skew.mjs --mysql-password "yourpassword"');
    process.exit(1);
  }
}
