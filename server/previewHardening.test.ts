import { describe, expect, it } from "vitest";
import { NOINDEX_HEADER, ROBOTS_DISALLOW_ALL, indexingAllowed, shouldRedirectToHttps } from "./previewHardening";

describe("preview hardening", () => {
  it("refuses indexing unless a variable explicitly allows it", () => {
    // Fail safe. A forgotten variable must leave a children's product out of search results,
    // not in them, so anything other than the explicit opt-in counts as refused.
    expect(indexingAllowed({} as NodeJS.ProcessEnv)).toBe(false);
    expect(indexingAllowed({ READER_LEADER_ALLOW_INDEXING: "" } as NodeJS.ProcessEnv)).toBe(false);
    expect(indexingAllowed({ READER_LEADER_ALLOW_INDEXING: "0" } as NodeJS.ProcessEnv)).toBe(false);
    expect(indexingAllowed({ READER_LEADER_ALLOW_INDEXING: "true" } as NodeJS.ProcessEnv)).toBe(false);
    expect(indexingAllowed({ READER_LEADER_ALLOW_INDEXING: "1" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("disallows every crawler on every path", () => {
    expect(ROBOTS_DISALLOW_ALL).toBe("User-agent: *\nDisallow: /\n");
    expect(NOINDEX_HEADER).toContain("noindex");
    expect(NOINDEX_HEADER).toContain("nofollow");
  });

  it("redirects a plain-HTTP hop in front of the app", () => {
    expect(shouldRedirectToHttps({ headers: { "x-forwarded-proto": "http" } })).toBe(true);
    expect(shouldRedirectToHttps({ headers: { "x-forwarded-proto": "HTTP" } })).toBe(true);
    // A chain of proxies: the client-facing hop is the first entry and the one that counts.
    expect(shouldRedirectToHttps({ headers: { "x-forwarded-proto": "http, https" } })).toBe(true);
    expect(shouldRedirectToHttps({ headers: { "x-forwarded-proto": ["http", "https"] } })).toBe(true);
  });

  it("leaves an HTTPS request alone", () => {
    expect(shouldRedirectToHttps({ headers: { "x-forwarded-proto": "https" } })).toBe(false);
    expect(shouldRedirectToHttps({ headers: { "x-forwarded-proto": "https, http" } })).toBe(false);
  });

  it("never redirects when nothing in front of the app said otherwise", () => {
    // No proxy header means a direct connection: local development, the test suite and the
    // browser journey, none of which should be bounced to a scheme they are not serving.
    expect(shouldRedirectToHttps({ headers: {} })).toBe(false);
    expect(shouldRedirectToHttps({ headers: { "x-forwarded-proto": "" } })).toBe(false);
  });
});
