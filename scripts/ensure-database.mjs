#!/usr/bin/env node
/**
 * Create the database named in DATABASE_URL if it does not exist yet.
 *
 * drizzle-kit migrate connects to a named database and fails if it is absent, so a fresh
 * machine hits "Unknown database" after installing MySQL and doing everything else right.
 * Uses the mysql2 driver the app already depends on, so no mysql command-line client is
 * needed — Windows machines generally do not have one.
 */
import mysql from "mysql2/promise";

const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error("DATABASE_URL is not set.");
  process.exit(2);
}

const url = new URL(raw);
const name = url.pathname.replace(/^\//, "");
if (!name) {
  console.error(`DATABASE_URL has no database name: ${url.protocol}//${url.host}/`);
  process.exit(2);
}
if (!/^[A-Za-z0-9_]+$/.test(name)) {
  console.error(`Refusing to create a database with an unusual name: ${name}`);
  process.exit(2);
}

let connection;
try {
  connection = await mysql.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  });
} catch (error) {
  // The common case by a distance, and a stack trace buries it.
  if (error?.code === "ER_ACCESS_DENIED_ERROR") {
    console.error(`MySQL rejected the login for user "${decodeURIComponent(url.username)}".`);
    console.error("The password in DATABASE_URL is not the one this MySQL was installed with.");
    console.error("Re-run the local script with the password you set, for example:");
    console.error('  powershell -ExecutionPolicy Bypass -File .\\scripts\\run-local.ps1 -MysqlPassword "yourpassword"');
    console.error('  MYSQL_ROOT_PASSWORD="yourpassword" ./scripts/run-local.sh');
    process.exit(1);
  }
  if (error?.code === "ECONNREFUSED") {
    console.error(`Nothing is listening on ${url.hostname}:${url.port || 3306}. Start MySQL first.`);
    process.exit(1);
  }
  throw error;
}
try {
  const [before] = await connection.query("SHOW DATABASES LIKE ?", [name]);
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  console.log(Array.isArray(before) && before.length ? `Database ${name} already exists.` : `Created database ${name}.`);
} finally {
  await connection.end();
}
