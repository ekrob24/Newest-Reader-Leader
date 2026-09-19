import { describe, expect, it } from "vitest";
import { CAPTURE_CLOCK_TOLERANCE_MS, effectiveCaptureTime, resolveCaptureTime } from "./captureTime";

const server = new Date("2026-09-19T10:00:00.000Z");

describe("capture clock reconciliation", () => {
  it("trusts a device clock within tolerance and keeps the skew", () => {
    const device = new Date(server.getTime() - 30_000);
    expect(resolveCaptureTime(device, server)).toEqual({ capturedAt: device, capturedAtSource: "device", clockSkewMs: -30_000 });
  });

  it("prefers server time when the device clock is implausible, and still keeps the device value", () => {
    const device = new Date(server.getTime() + 36 * 60 * 60 * 1000);
    const resolved = resolveCaptureTime(device, server);
    expect(resolved.capturedAtSource).toBe("server");
    // The reported value is not discarded — a wrong clock has to stay diagnosable.
    expect(resolved.capturedAt).toEqual(device);
    expect(resolved.clockSkewMs).toBe(36 * 60 * 60 * 1000);
    expect(effectiveCaptureTime({ ...resolved, createdAt: server })).toEqual(server);
  });

  it("treats a flat-battery epoch reset as implausible", () => {
    const resolved = resolveCaptureTime(new Date(0), server);
    expect(resolved.capturedAtSource).toBe("server");
    expect(resolved.capturedAt).toEqual(new Date(0));
  });

  it("falls back to server time when the device supplies nothing or nonsense", () => {
    for (const device of [null, undefined, new Date("not a date")]) {
      expect(resolveCaptureTime(device, server)).toEqual({ capturedAt: null, capturedAtSource: "server", clockSkewMs: null });
    }
  });

  it("holds the boundary exactly at the tolerance", () => {
    const atLimit = new Date(server.getTime() + CAPTURE_CLOCK_TOLERANCE_MS);
    const pastLimit = new Date(server.getTime() + CAPTURE_CLOCK_TOLERANCE_MS + 1);
    expect(resolveCaptureTime(atLimit, server).capturedAtSource).toBe("device");
    expect(resolveCaptureTime(pastLimit, server).capturedAtSource).toBe("server");
  });

  it("orders by the device clock only when it was trusted", () => {
    const device = new Date(server.getTime() - 1000);
    expect(effectiveCaptureTime({ capturedAt: device, capturedAtSource: "device", createdAt: server })).toEqual(device);
    expect(effectiveCaptureTime({ capturedAt: device, capturedAtSource: "server", createdAt: server })).toEqual(server);
    expect(effectiveCaptureTime({ capturedAt: null, capturedAtSource: "server", createdAt: server })).toEqual(server);
  });
});
