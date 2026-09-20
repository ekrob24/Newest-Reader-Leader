#!/usr/bin/env node
/**
 * Why a timestamp MySQL wrote itself can come back an hour out.
 *
 * Read-only. It writes nothing and changes nothing; it prints what MySQL thinks the time is,
 * what this machine thinks the time is, and the two timezone settings that decide whether
 * those agree.
 *
 *   node scripts/clock-skew.mjs --mysql-password "yourpassword"
 *
 * The suspicion it exists to confirm or refute: readingSessions.createdAt is DEFAULT now(),
 * so MySQL generates it in the MySQL session's timezone, while the mysql2 driver reads the
 * value back and interprets it in this machine's timezone. When those differ - a MySQL
 * container on UTC and a laptop on British Summer Time - every server-generated timestamp
 * lands an hour out, and readingSessions.capturedAt does not, because the application writes
 * that one and the same wrong conversion is applied in both directions.
 */
import mysql from "mysql2/promise";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/**
 * The reading, as lines. Pure, so the arithmetic that decides "skew" or "no skew" is tested
 * rather than trusted - a diagnostic that reports the wrong sign sends the reader the wrong
 * way, and this one exists to settle a question, not to decorate it.
 */
export function skewReport({ globalTz, sessionTz, machineTz, offsetHours, mysqlNow, now }) {
  const skewMinutes = Math.round((now.getTime() - mysqlNow.getTime()) / 60000);
  const lines = [
    `MySQL global time_zone   : ${globalTz}`,
    `MySQL session time_zone  : ${sessionTz}`,
    `This machine's timezone  : ${machineTz} (UTC${offsetHours >= 0 ? "+" : ""}${offsetHours})`,
    `MySQL NOW(), as the driver reads it: ${mysqlNow.toISOString()}`,
    `This machine, right now            : ${now.toISOString()}`,
    "",
  ];
  if (Math.abs(skewMinutes) <= 1) {
    lines.push("No skew. A server-generated timestamp comes back as the instant it was written,");
    lines.push("so the failing assertion has some other cause.");
  } else {
    lines.push(`SKEW: ${skewMinutes} minutes.`);
    lines.push("Every timestamp MySQL generates is read back that far from the instant it was");
    lines.push("written. That is the failing assertion, and it is the two settings above");
    lines.push("disagreeing - not the clock on either machine being wrong.");
  }
  return lines;
}

if (resolve(process.argv[1] ?? "").toLowerCase() !== fileURLToPath(import.meta.url).toLowerCase()) {
  // Imported by the tests; nothing below should run.
} else await main();

async function main() {

const args = process.argv.slice(2);
const at = args.indexOf("--mysql-password");
const password = at >= 0 ? args[at + 1] : process.env.MYSQL_ROOT_PASSWORD ?? "rlroot";
const url = process.env.DATABASE_URL ?? `mysql://root:${encodeURIComponent(password)}@127.0.0.1:3306/rl_gate`;

let connection;
try {
  connection = await mysql.createConnection(url);
} catch (error) {
  console.error(`Could not connect: ${error?.code ?? error?.message ?? error}`);
  console.error('Run it as: node scripts/clock-skew.mjs --mysql-password "yourpassword"');
  process.exit(1);
}

try {
  const [rows] = await connection.query(
    "SELECT @@global.time_zone AS globalTz, @@session.time_zone AS sessionTz, NOW() AS mysqlNow",
  );
  const { globalTz, sessionTz, mysqlNow } = rows[0];
  const lines = skewReport({
    globalTz, sessionTz,
    machineTz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    offsetHours: -new Date().getTimezoneOffset() / 60,
    mysqlNow: mysqlNow instanceof Date ? mysqlNow : new Date(String(mysqlNow)),
    now: new Date(),
  });
  for (const line of lines) console.log(line);
} finally {
  await connection.end();
}
}
