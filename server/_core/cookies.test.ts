import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { getSessionCookieOptions } from "./cookies";

const request = (headers: Record<string, string | string[]> = {}, protocol = "http") =>
  ({ headers, protocol } as unknown as Request);

describe("session cookie", () => {
  it("never pairs SameSite=None with an insecure cookie", () => {
    // The pair is illegal, so a browser discards the cookie entirely rather than storing an
    // insecure one. The symptom is a sign-in that bounces straight back to the login screen,
    // which reads as a wrong password and is nothing of the sort.
    for (const req of [request(), request({ "x-forwarded-proto": "http" })]) {
      const options = getSessionCookieOptions(req);
      expect(options.secure).toBe(false);
      expect(options.sameSite).not.toBe("none");
    }
  });

  it("keeps SameSite=None where it is legal, so cross-site embedding still works", () => {
    for (const req of [request({ "x-forwarded-proto": "https" }), request({}, "https")]) {
      const options = getSessionCookieOptions(req);
      expect(options.secure).toBe(true);
      expect(options.sameSite).toBe("none");
    }
  });

  it("reads the client-facing hop from a chain of proxies", () => {
    expect(getSessionCookieOptions(request({ "x-forwarded-proto": "https, http" })).secure).toBe(true);
    expect(getSessionCookieOptions(request({ "x-forwarded-proto": ["https"] })).secure).toBe(true);
  });

  it("is always httpOnly and scoped to the whole site", () => {
    const options = getSessionCookieOptions(request());
    expect(options.httpOnly).toBe(true);
    expect(options.path).toBe("/");
  });
});
