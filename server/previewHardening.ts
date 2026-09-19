import type { Express, NextFunction, Request, Response } from "express";

/**
 * Hardening for a publicly reachable demonstration build of a children's education product.
 *
 * Every switch here fails safe. Indexing is refused unless a variable explicitly allows it,
 * so a forgotten variable leaves the build out of search results rather than in them; and the
 * HTTPS redirect turns itself on by detecting a proxy rather than by being configured, so it
 * cannot be left off by omission either.
 */

/** Set READER_LEADER_ALLOW_INDEXING=1 to let crawlers in. Absent or anything else: refused. */
export function indexingAllowed(env: NodeJS.ProcessEnv = process.env) {
  return env.READER_LEADER_ALLOW_INDEXING === "1";
}

/**
 * Whether this request arrived over a plain-HTTP hop in front of us.
 *
 * Only a proxy that told us the scheme can produce this, so a local run with no proxy header
 * is never redirected and the test suite and `pnpm dev` are unaffected. The redirect matters
 * because the session cookie is SameSite=None and only Secure when the request looks like
 * HTTPS: over plain HTTP the browser discards it and sign-in fails in a way that reads like a
 * password problem.
 */
export function shouldRedirectToHttps(req: Pick<Request, "headers">) {
  const forwarded = req.headers["x-forwarded-proto"];
  if (!forwarded) return false;
  const protocols = (Array.isArray(forwarded) ? forwarded : forwarded.split(",")).map(value => value.trim().toLowerCase());
  if (!protocols.length) return false;
  // The client-facing hop is the first entry.
  return protocols[0] !== "https";
}

export const ROBOTS_DISALLOW_ALL = "User-agent: *\nDisallow: /\n";
export const NOINDEX_HEADER = "noindex, nofollow, noarchive, noimageindex, nosnippet";

export function registerPreviewHardening(app: Express) {
  const allowIndexing = indexingAllowed();

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (shouldRedirectToHttps(req)) {
      const host = req.headers.host;
      // Without a host there is nowhere to send them; fall through rather than guess.
      if (host) return res.redirect(308, `https://${host}${req.originalUrl}`);
    }
    if (!allowIndexing) res.setHeader("X-Robots-Tag", NOINDEX_HEADER);
    next();
  });

  app.get("/robots.txt", (_req: Request, res: Response) => {
    res.type("text/plain").send(allowIndexing ? "User-agent: *\nAllow: /\n" : ROBOTS_DISALLOW_ALL);
  });
}
