import { describe, expect, it, vi } from "vitest";
import { classifyStorageOutcome } from "./audioOutcome";
import { StorageUnavailableError } from "./storage";

const stored = { key: "reader-leader/recordings/1/session.webm", url: "/manus-storage/x" };

describe("storage outcome for a reading session", () => {
  it("keeps the key when the upload succeeded", () => {
    expect(classifyStorageOutcome({ status: "fulfilled", value: stored })).toEqual({ audioStorageKey: stored.key, audioStatus: "stored" });
  });

  it("degrades rather than failing the session when storage is not configured", () => {
    const reason = new StorageUnavailableError("Storage config missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY");
    expect(classifyStorageOutcome({ status: "rejected", reason })).toEqual({ audioStorageKey: null, audioStatus: "storage_unavailable" });
  });

  it("separates a configured-but-failing upload from an unconfigured one", () => {
    const reason = new Error("Storage upload to S3 failed (503)");
    expect(classifyStorageOutcome({ status: "rejected", reason })).toEqual({ audioStorageKey: null, audioStatus: "storage_rejected" });
  });

  it("never returns a null key without a reason for it", () => {
    for (const reason of [new StorageUnavailableError("x"), new Error("y"), "a string rejection", undefined]) {
      const outcome = classifyStorageOutcome({ status: "rejected", reason });
      expect(outcome.audioStorageKey).toBeNull();
      expect(outcome.audioStatus).not.toBe("stored");
      expect(outcome.audioStatus).not.toBe("not_captured");
    }
  });

  it("is the real path the storage helper takes when its configuration is absent", async () => {
    // Guards the instanceof above. Without this, changing storagePut to throw a plain Error
    // would silently collapse an unconfigured deployment into "storage_rejected" — the wrong
    // reason, shown to a teacher, with every other test in this file still green.
    vi.resetModules();
    vi.doMock("./_core/env", () => ({ ENV: { forgeApiUrl: "", forgeApiKey: "" } }));
    try {
      const { storagePut } = await import("./storage");
      const { classifyStorageOutcome: classify } = await import("./audioOutcome");
      const [result] = await Promise.allSettled([storagePut("reader-leader/recordings/probe.webm", Buffer.from("x"), "audio/webm")]);
      expect(result!.status).toBe("rejected");
      expect(classify(result!).audioStatus).toBe("storage_unavailable");
    } finally {
      vi.doUnmock("./_core/env");
      vi.resetModules();
    }
  });
});
