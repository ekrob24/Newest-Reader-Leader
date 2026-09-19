/**
 * ULIDs for reading sessions and their child rows, generated at the point of capture.
 *
 * Why not the database: a session is captured on a classroom tablet and saved through
 * whichever server handles the request. An autoincrement key forces the id to be decided by
 * one database at insert time, which collides the moment sessions are created in more than
 * one place and makes offline capture impossible. Generating the id where the reading
 * happens means the session already knows its own identity before it is ever sent.
 *
 * Why ULID over UUIDv4: the leading 48 bits are the capture timestamp, so ids sort in
 * capture order lexicographically. That keeps index locality on insert and makes "the next
 * session for this child" a range scan rather than a sort. UUIDv7 would do the same job;
 * ULID is preferred here because its Crockford base32 form is case-insensitive, has no
 * hyphens, and excludes I, L, O and U, so an id read aloud or typed from a support ticket
 * does not turn into a different valid id.
 *
 * This is deliberately implemented rather than taken as a dependency: it is forty lines of
 * a stable, well-specified format, and it processes identifiers for children's reading data.
 */

/** Crockford base32: no I, L, O or U, so 1/I, 0/O and similar cannot be confused. */
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_CHARS = 10;
const RANDOM_CHARS = 16;
export const SESSION_ID_LENGTH = TIME_CHARS + RANDOM_CHARS;
/** 48 bits of milliseconds runs out in AD 10889. */
const MAX_TIME = 281474976710655;

function encodeTime(milliseconds: number) {
  if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > MAX_TIME) {
    throw new RangeError(`A session timestamp must be a whole number of milliseconds between 0 and ${MAX_TIME}.`);
  }
  let remaining = milliseconds;
  let out = "";
  for (let index = 0; index < TIME_CHARS; index += 1) {
    out = ENCODING[remaining % 32] + out;
    remaining = Math.floor(remaining / 32);
  }
  return out;
}

function randomChars(random: () => number) {
  let out = "";
  for (let index = 0; index < RANDOM_CHARS; index += 1) out += ENCODING[Math.floor(random() * 32)];
  return out;
}

/** Increments a base32 string, carrying leftwards. Returns null if it would overflow. */
function increment(chars: string) {
  const out = chars.split("");
  for (let index = out.length - 1; index >= 0; index -= 1) {
    const next = ENCODING.indexOf(out[index]) + 1;
    if (next < 32) {
      out[index] = ENCODING[next];
      return out.join("");
    }
    out[index] = ENCODING[0];
  }
  return null;
}

/**
 * A monotonic ULID factory. Two ids generated in the same millisecond still sort in creation
 * order, because the random part is incremented rather than redrawn — otherwise two sessions
 * saved in the same tick could sort backwards against each other.
 */
export function createSessionIdFactory(options: { now?: () => number; random?: () => number } = {}) {
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  let lastTime = -1;
  let lastRandom = "";

  return function nextSessionId(): string {
    const time = now();
    if (time === lastTime) {
      const incremented = increment(lastRandom);
      // Overflowing 80 bits inside one millisecond is not reachable in practice; if it ever
      // happens, draw again rather than return a duplicate or a smaller id.
      lastRandom = incremented ?? randomChars(random);
    } else {
      lastTime = time;
      lastRandom = randomChars(random);
    }
    return encodeTime(time) + lastRandom;
  };
}

/** The process-wide factory. Use this at the point a session or one of its rows is captured. */
export const newSessionId = createSessionIdFactory();

/**
 * A well-formed id that belongs to no session. For query hooks that must be constructed with
 * an argument while disabled; it is never sent. Under the old int keys this slot held `1`,
 * which was a real session's id.
 */
export const PLACEHOLDER_SESSION_ID = "0".repeat(SESSION_ID_LENGTH);

const SESSION_ID_PATTERN = new RegExp(`^[${ENCODING}]{${SESSION_ID_LENGTH}}$`);

export function isSessionId(value: string): boolean {
  return SESSION_ID_PATTERN.test(value);
}

/** The capture time encoded in the id, for ordering and diagnostics. */
export function sessionIdTime(id: string): number {
  if (!isSessionId(id)) throw new Error("Not a session id.");
  return id.slice(0, TIME_CHARS).split("").reduce((total, char) => total * 32 + ENCODING.indexOf(char), 0);
}
