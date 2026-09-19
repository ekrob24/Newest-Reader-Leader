import { defineConfig } from "@playwright/test";

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;
/** Set by `pnpm demo:record`. Turns on video and a trace, and slows the run enough to watch. */
const RECORDING = process.env.READER_LEADER_RECORD === "1";

export default defineConfig({
  testDir: "e2e",
  // Zero retries on purpose. A retry is a test reporting that it is unreliable while being
  // silenced. If this one is flaky, fix the flake or delete it.
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  // Off by default. A walkthrough recording is a deliberate act — `pnpm demo:record` sets
  // this — so an ordinary run neither films itself nor uploads a video from CI.
  outputDir: RECORDING ? "demo-recording" : "test-results",
  use: {
    baseURL: BASE_URL,
    video: RECORDING ? { mode: "on", size: { width: 1280, height: 800 } } : "off",
    trace: RECORDING ? "on" : "off",
    viewport: { width: 1280, height: 800 },
    // The session cookie is SameSite=None and only Secure when the request looks like HTTPS.
    // Over plain HTTP the browser discards it and nothing can sign in.
    extraHTTPHeaders: { "x-forwarded-proto": "https" },
    permissions: ["microphone"],
    launchOptions: {
      // This sandbox ships Chromium at a fixed path; CI installs its own.
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
      // Only when recording: a run at full speed is unwatchable, and the point of the
      // recording is that a person can follow it.
      slowMo: RECORDING ? 400 : 0,
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--use-file-for-fake-audio-capture=e2e/synthetic-tone-not-a-human-voice.wav",
        "--no-sandbox",
      ],
    },
  },
  // `pnpm start` rather than `pnpm dev`: the built server is what the demo runs.
  webServer: {
    command: "pnpm start",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { PORT: String(PORT), NODE_ENV: "production" },
  },
});
