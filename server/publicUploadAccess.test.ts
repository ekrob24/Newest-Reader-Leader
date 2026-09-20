import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./routers";
import { createContext } from "./_core/context";

/**
 * What `reading.processRecording` requires of a caller: nothing.
 *
 * Documents a finding, not a design. The route is a `publicProcedure`, which in this codebase
 * is `t.procedure` with no middleware at all, and it calls `storagePut` BEFORE it transcribes.
 * So an anonymous caller can post bytes and have them persisted under this project's own
 * storage credentials, with no account, no rate limit and no trace.
 *
 * The ordering matters more than the guard: because the store happens first, a failure
 * anywhere after it - including the transcription failing for want of an OPENAI_API_KEY this
 * project deliberately does not set - still leaves the object written. On such a deployment
 * every call to this route stores the bytes and then returns an error. That is a write
 * primitive that reports failure.
 *
 * Storage is unconfigured under test, so a request that reaches the handler fails inside
 * `storagePut` with StorageUnavailableError. That specific failure is the proof of reach: an
 * authenticated route would have returned UNAUTHORIZED without ever touching storage.
 *
 * Written so that adding authentication, or storing nothing, BREAKS these assertions. Whoever
 * fixes this has to come here and state the new behaviour.
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
  it("is not refused for want of an account", async () => {
    const response = await post(payload());
    expect(await errorMessage(response)).not.toMatch(/unauthor|sign in|log in/i);
  });

  it("reaches storage before anything can stop it", async () => {
    // StorageUnavailableError is raised inside storagePut. Getting this far means the bytes
    // would have been written on a deployment where storage IS configured.
    expect(await errorMessage(await post(payload()))).toMatch(/storage config missing/i);
  });

  it("accepts bytes that are not audio, because the type is coerced and never checked", async () => {
    // safeAudioMimeType maps anything unrecognised to audio/webm rather than rejecting it,
    // and the bytes themselves are never inspected. A zip, an image or an executable is
    // stored as .webm with an audio content type.
    const zipMagic = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]).toString("base64");
    for (const mime of ["application/zip", "image/png", "text/html", undefined]) {
      const response = await post(payload({ audioBase64: zipMagic, audioMime: mime }));
      const message = await errorMessage(response);
      expect(message, String(mime)).not.toMatch(/type|format|not audio/i);
      expect(message, String(mime)).toMatch(/storage config missing/i);
    }
  });

  it("does cap one request's size, which is the only limit that exists", async () => {
    const tooBig = "A".repeat(6_000_001);
    expect(await errorMessage(await post(payload({ audioBase64: tooBig })))).toMatch(/too big|string|6000000|length/i);
  });

  it("applies no rate or count limit: repeated anonymous posts are all accepted alike", async () => {
    // Nothing in the codebase rate-limits. Five in a row behave identically to the first,
    // and each one is a stored object on a configured deployment.
    const messages = await Promise.all(Array.from({ length: 5 }, () => post(payload()).then(errorMessage)));
    expect(messages.every(message => /storage config missing/i.test(message))).toBe(true);
  });
});
