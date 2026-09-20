import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "http";
import { registerPreviewHardening } from "./previewHardening";
import { registerStorageProxy } from "./_core/storageProxy";

/**
 * What the storage proxy currently requires of a caller: nothing.
 *
 * This documents a finding rather than a design. `GET /manus-storage/*` is mounted on the
 * Express app ahead of the tRPC router, takes a storage key straight from the URL path, and
 * presigns it with the server's own credentials. There is no session check in front of it, so
 * the access control on `sessions.audioUrl` governs who is told a key and not who can fetch
 * the file it names. Recording keys are `reader-leader/recordings/{userId}/session-{ms}.{ext}`,
 * which is a small integer and a millisecond timestamp.
 *
 * The assertions below are deliberately written so that adding authentication BREAKS them.
 * That is the point: whoever fixes this has to come here and change the expectation to the
 * new behaviour, so the fix cannot be partial or accidental.
 *
 * Forge credentials are absent under test, so a request that reaches the handler fails inside
 * it with its own "not configured" error. That specific failure is the proof of reach: an
 * authenticated route would have rejected the caller before ever getting there.
 */
const app = express();
app.use(express.json());
registerPreviewHardening(app);
registerStorageProxy(app);

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

const ANOTHER_CHILDS_RECORDING = "/manus-storage/reader-leader/recordings/999/session-1700000000000.webm";

describe("GET /manus-storage/* as an anonymous caller", () => {
  it("is not refused: no session, no cookie, and the handler still runs", async () => {
    const response = await fetch(`${origin}${ANOTHER_CHILDS_RECORDING}`, { redirect: "manual" });
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
    // Reached the handler's own configuration failure, which is as far as it can get here.
    // With storage configured this is where it would 307 to a signed URL for the file.
    expect(await response.text()).toContain("Storage proxy not configured");
  });

  it("does not depend on the key belonging to the caller, because there is no caller", async () => {
    for (const key of [
      "/manus-storage/reader-leader/recordings/1/session-1.webm",
      "/manus-storage/reader-leader/recordings/2/session-2.wav",
      "/manus-storage/some/other/tenant/file.webm",
    ]) {
      const response = await fetch(`${origin}${key}`, { redirect: "manual" });
      expect(response.status, key).not.toBe(401);
      expect(response.status, key).not.toBe(403);
    }
  });

  it("rejects only an empty key, which is the sole check it performs", async () => {
    const response = await fetch(`${origin}/manus-storage/`, { redirect: "manual" });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Missing storage key");
  });

  it("applies the preview hardening headers, so that middleware ran and simply does not authenticate", async () => {
    // Rules out "the route was never reached" as an explanation for the above.
    const response = await fetch(`${origin}${ANOTHER_CHILDS_RECORDING}`, { redirect: "manual" });
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });
});
