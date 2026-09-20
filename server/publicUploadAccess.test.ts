import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./routers";
import { createContext } from "./_core/context";

/**
 * `reading.processRecording` is open to anyone and now stores nothing.
 *
 * It remains a `publicProcedure`, which in this codebase is `t.procedure` with no middleware
 * at all: the no-account demo read is meant to work without signing in, and that part is
 * deliberate. What was not deliberate was the `storagePut` it used to make first, which turned
 * an open endpoint into an unauthenticated write under this project's own storage credentials
 * - no account, no rate limit, no content-type check, no deletion.
 *
 * The ordering was the sharper half of it. Because the store came before the transcription,
 * everything that failed afterwards still left the object written, including transcription
 * failing for want of an OPENAI_API_KEY this project deliberately does not set. Such a
 * deployment stored every posted object and then returned an error: a write primitive that
 * reported failure, which is the worst kind to inherit because a route that looks broken gets
 * ignored rather than investigated.
 *
 * The fix was to delete the call. The bytes were already in memory for transcription, nothing
 * ever read the object back, and the key went into a variable that was never used. So these
 * assertions now hold the route to storing nothing, and they fail if a `storagePut` returns:
 * with storage unconfigured under test, any code path that tries to store dies inside it with
 * StorageUnavailableError, which is exactly what these tests assert does NOT happen.
 *
 * Still unguarded and recorded as such: no rate limit, no count limit, and a content type that
 * is coerced rather than checked. Those cost nothing while the route stores nothing, and they
 * become real again the moment anybody re-adds a write here.
 */
const app = express();
app.use(express.json({ limit: "50mb" }));
app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

let server: Server;
let origin = "";

beforeAll(async () => {
  await new Promise<void>(resolve => {
    server = app.listen(0, () => {
      const address = server.address();
      origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

const post = (body: unknown) => fetch(`${origin}/api/trpc/reading.processRecording`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  // The server uses a superjson transformer, so input arrives wrapped.
  body: JSON.stringify({ json: body }),
});

const payload = (overrides: Record<string, unknown> = {}) => ({
  audioBase64: Buffer.from("not really audio at all").toString("base64"),
  audioMime: "audio/webm",
  expectedText: "Amina carried a little lantern into the garden at dusk.",
  durationSeconds: 30,
  ...overrides,
});

async function errorMessage(response: Response) {
  const body = await response.json() as { error?: { json?: { message?: string } } };
  const message = body.error?.json?.message ?? "";
  // A test whose assertions all run against an empty string would pass by accident.
  expect(message, "the route must have returned something to assert on").not.toBe("");
  return message;
}

describe("POST reading.processRecording with no session", () => {
  it("is not refused for want of an account, because the demo read is meant to work signed out", async () => {
    expect(await errorMessage(await post(payload()))).not.toMatch(/unauthor|sign in|log in/i);
  });

  it("stores nothing: it never reaches storage at all", async () => {
    // Storage is unconfigured here, so any attempt to store raises StorageUnavailableError
    // and says so. Reaching transcription instead is the proof that nothing was written.
    const message = await errorMessage(await post(payload()));
    expect(message).not.toMatch(/storage config missing/i);
    expect(message).toMatch(/transcription service is not configured/i);
  });

  it("accepts bytes that are not audio, because the type is coerced and never checked", async () => {
    // safeAudioMimeType maps anything unrecognised to audio/webm rather than rejecting it,
    // and the bytes themselves are never inspected. A zip, an image or an executable is
    // stored as .webm with an audio content type.
    const zipMagic = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]).toString("base64");
    for (const mime of ["application/zip", "image/png", "text/html", undefined]) {
      const response = await post(payload({ audioBase64: zipMagic, audioMime: mime }));
      const message = await errorMessage(response);
      expect(message, String(mime)).not.toMatch(/unsupported|not audio/i);
      expect(message, String(mime)).toMatch(/transcription service is not configured/i);
    }
  });

  it("does cap one request's size, which is the only limit that exists", async () => {
    const tooBig = "A".repeat(6_000_001);
    expect(await errorMessage(await post(payload({ audioBase64: tooBig })))).toMatch(/too big|string|6000000|length/i);
  });

  it("applies no rate or count limit: repeated anonymous posts are all accepted alike", async () => {
    // Nothing in the codebase rate-limits. Harmless while nothing is stored, and the reason
    // this must be reconsidered the moment anyone adds a write back to this route.
    const messages = await Promise.all(Array.from({ length: 5 }, () => post(payload()).then(errorMessage)));
    expect(messages.every(message => /transcription service is not configured/i.test(message))).toBe(true);
  });
});
