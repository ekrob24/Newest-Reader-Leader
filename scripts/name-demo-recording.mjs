#!/usr/bin/env node
/**
 * Playwright writes the video under a generated per-test folder. This moves it to one
 * predictable path so the walkthrough can be linked, emailed or attached without anyone
 * having to go hunting through test-results directories.
 */
import { readdirSync, statSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = "demo-recording";
const DESTINATION = join(ROOT, "reader-leader-walkthrough.webm");

if (!existsSync(ROOT)) {
  console.error(`No ${ROOT} directory. Run pnpm demo:record, which sets READER_LEADER_RECORD=1.`);
  process.exit(1);
}

function findVideos(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findVideos(path);
    return entry.name.endsWith(".webm") && path !== DESTINATION ? [path] : [];
  });
}

const videos = findVideos(ROOT);
if (!videos.length) {
  console.error("The run produced no video. Check that READER_LEADER_RECORD=1 was set.");
  process.exit(1);
}
if (videos.length > 1) {
  console.error(`Expected one video, found ${videos.length}:\n  ${videos.join("\n  ")}`);
  process.exit(1);
}

mkdirSync(ROOT, { recursive: true });
renameSync(videos[0], DESTINATION);
const { size } = statSync(DESTINATION);
console.log(`Walkthrough: ${DESTINATION} (${(size / 1_000_000).toFixed(1)} MB)`);
