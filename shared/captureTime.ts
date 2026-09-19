/**
 * Reconciling the classroom tablet's clock with the server's.
 *
 * Word timings are measured on the device, against the device's clock, which we do not
 * control: a school tablet can be days out, or reset to epoch after a flat battery. The
 * server's clock is trustworthy but only tells us when the upload arrived, which may be long
 * after the reading if the device was offline.
 *
 * So both are stored and neither is discarded. `capturedAt` keeps the device's reported clock
 * exactly as it arrived, `createdAt` keeps the server's, and `capturedAtSource` records which
 * one we treat as authoritative. When the two disagree by more than the tolerance below, the
 * server's time wins and the source is marked "server" — but the device's value stays in the
 * row, so a wrong clock can be diagnosed later rather than silently overwritten.
 */

/**
 * How far a device clock may sit from the server's before we stop believing it. Generous
 * enough for ordinary drift and a slow upload; tight enough that a reset or mistyped clock is
 * caught. A reading that genuinely happened offline hours earlier will be marked "server",
 * which is the safe direction: we would rather understate our confidence in a device clock
 * than order a child's sessions wrongly.
 */
export const CAPTURE_CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

export type CaptureTimeSource = "device" | "server";

export type ResolvedCaptureTime = {
  /** The device's clock exactly as reported, or null when the device supplied none. */
  capturedAt: Date | null;
  /** Which clock is authoritative for ordering this session. */
  capturedAtSource: CaptureTimeSource;
  /** Device minus server, in milliseconds; null when there is no device clock to compare. */
  clockSkewMs: number | null;
};

export function resolveCaptureTime(
  deviceClock: Date | null | undefined,
  serverNow: Date,
  toleranceMs: number = CAPTURE_CLOCK_TOLERANCE_MS,
): ResolvedCaptureTime {
  if (!deviceClock || Number.isNaN(deviceClock.getTime())) {
    return { capturedAt: null, capturedAtSource: "server", clockSkewMs: null };
  }
  const clockSkewMs = deviceClock.getTime() - serverNow.getTime();
  const plausible = Math.abs(clockSkewMs) <= toleranceMs;
  return { capturedAt: deviceClock, capturedAtSource: plausible ? "device" : "server", clockSkewMs };
}

/** The instant to order a session by, honouring the recorded decision. */
export function effectiveCaptureTime(session: { capturedAt: Date | null; capturedAtSource: CaptureTimeSource; createdAt: Date }): Date {
  return session.capturedAtSource === "device" && session.capturedAt ? session.capturedAt : session.createdAt;
}
