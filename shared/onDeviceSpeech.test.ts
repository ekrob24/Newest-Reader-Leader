import { describe, expect, it } from "vitest";
import { onDeviceAvailability, installOnDeviceSpeech, sendsVoiceOffDevice, speechModeNotice } from "./onDeviceSpeech";

const scopeWith = (overrides: Record<string, unknown>) => ({ SpeechRecognition: overrides });

describe("on-device speech", () => {
  it("reports unsupported when the browser has no recogniser at all", async () => {
    expect(await onDeviceAvailability({}, "en-IE")).toBe("unsupported");
  });

  it("reports unsupported on a browser whose recogniser predates on-device models", async () => {
    // Chrome before 138. It has SpeechRecognition but no available(), so asking it whether it
    // can run locally must not be mistaken for a yes.
    expect(await onDeviceAvailability(scopeWith({}), "en-IE")).toBe("unsupported");
  });

  it("passes the language through and asks specifically for local processing", async () => {
    let asked: unknown;
    const scope = scopeWith({ available: async (options: unknown) => { asked = options; return "available"; } });
    expect(await onDeviceAvailability(scope, "en-IE")).toBe("available");
    expect(asked).toEqual({ langs: ["en-IE"], processLocally: true });
  });

  it("treats a throwing browser as unsupported rather than crashing the reader", async () => {
    const scope = scopeWith({ available: async () => { throw new Error("nope"); } });
    expect(await onDeviceAvailability(scope, "en-IE")).toBe("unsupported");
    const installScope = scopeWith({ install: async () => { throw new Error("nope"); } });
    expect(await installOnDeviceSpeech(installScope, "en-IE")).toBe(false);
  });

  it("never lets a voice leave the device without saying so", () => {
    expect(sendsVoiceOffDevice("cloud")).toBe(true);
    expect(sendsVoiceOffDevice("on-device")).toBe(false);
    expect(sendsVoiceOffDevice("unavailable")).toBe(false);
    // The cloud notice has to name what is happening, not soften it.
    expect(speechModeNotice("cloud")).toMatch(/sent to/i);
    expect(speechModeNotice("on-device")).toMatch(/stays on this device/i);
  });
});
