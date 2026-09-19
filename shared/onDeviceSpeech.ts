/**
 * On-device speech recognition.
 *
 * Chrome's Web Speech API streams audio to Google's servers by default. That is the wrong
 * arrangement for a children's reading product twice over: a child's voice leaves the device
 * to a third party, and the session depends on a network round trip that stops of its own
 * accord — the stalls, the silent ends and the restarts that never take.
 *
 * Chrome 138 and later can run the recogniser locally. `available()` reports whether a
 * language pack is present, and `install()` fetches one. Nothing here falls back to cloud
 * recognition quietly: the caller is told which one it got, and says so on screen.
 */
export type OnDeviceAvailability = "available" | "downloadable" | "downloading" | "unavailable" | "unsupported";
export type SpeechMode = "on-device" | "cloud" | "unavailable";

type RecognitionConstructor = {
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<OnDeviceAvailability>;
  install?: (options: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
};

export function speechRecognitionConstructor(scope: any): RecognitionConstructor | undefined {
  return scope?.SpeechRecognition ?? scope?.webkitSpeechRecognition;
}

/** What the browser can do right now, without changing anything. */
export async function onDeviceAvailability(scope: any, lang: string): Promise<OnDeviceAvailability> {
  const Recognition = speechRecognitionConstructor(scope);
  if (!Recognition) return "unsupported";
  if (typeof Recognition.available !== "function") return "unsupported";
  try {
    return await Recognition.available({ langs: [lang], processLocally: true });
  } catch {
    return "unsupported";
  }
}

/** Ask the browser to fetch the language pack. Returns whether it is now usable. */
export async function installOnDeviceSpeech(scope: any, lang: string): Promise<boolean> {
  const Recognition = speechRecognitionConstructor(scope);
  if (!Recognition || typeof Recognition.install !== "function") return false;
  try {
    return await Recognition.install({ langs: [lang], processLocally: true });
  } catch {
    return false;
  }
}

/** What a reader should be told about where their voice is being processed. */
export function speechModeNotice(mode: SpeechMode): string {
  switch (mode) {
    case "on-device": return "Your voice stays on this device.";
    case "cloud": return "Your voice is being sent to the browser maker's speech service, because this browser has no on-device reading model.";
    case "unavailable": return "This browser cannot listen along. You can still read and finish; your reading is scored from the recording.";
  }
}

/** True when the reader's voice leaves the device. Never allowed to be silent. */
export function sendsVoiceOffDevice(mode: SpeechMode) {
  return mode === "cloud";
}
