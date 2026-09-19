#!/usr/bin/env node
/**
 * Generate the preview's demo passwords and JWT secret into a gitignored local file.
 *
 * Deliberately a file rather than stdout piped anywhere: a chat transcript, a CI log and a
 * shell history are all places a credential should not end up, and a file with 0600 on it is
 * the smallest thing that is not one of those.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const OUTPUT = "preview-secrets.local.txt";
const word = () => randomBytes(18).toString("base64url");

const body = [
  "Reader Leader — preview credentials",
  `Generated ${new Date().toISOString()}`,
  "",
  "These are for the public preview only. They are not in git (.gitignore covers this file)",
  "and should be shared out of band — not in the same message as the URL.",
  "",
  "Set these as Railway service variables:",
  "",
  `READER_LEADER_CHILD_DEMO_PASSWORD=${word()}`,
  `READER_LEADER_TEACHER_DEMO_PASSWORD=${word()}`,
  `READER_LEADER_PARENT_DEMO_PASSWORD=${word()}`,
  `JWT_SECRET=${randomBytes(32).toString("base64url")}`,
  "",
  "To rotate: rerun this script, update the variables in Railway, redeploy. Anyone holding an",
  "old password loses access at the redeploy, which is the point of rotating over reusing.",
  "",
].join("\n");

writeFileSync(OUTPUT, body, { mode: 0o600 });
console.log(`Wrote ${OUTPUT}. It is gitignored. Do not paste its contents into a chat or an issue.`);
