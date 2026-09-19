import { defineConfig } from "@playwright/test";

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  // Zero retries on purpose. A retry is a test reporting that it is unreliable while being
  // silenced. If this one is flaky, fix the flake or delete it.
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    // The session cookie is SameSite=None and only Secure when the request looks like HTTPS.
    // Over plain HTTP the browser discards it and nothing can sign in.
    extraHTTPHeaders: { "x-forwarded-proto": "https" },
    permissions: ["microphone"],
    launchOptions: {
      // This sandbox ships Chromium at a fixed path; CI installs its own.
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
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
