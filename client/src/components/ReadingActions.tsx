import { trpc } from "@/lib/trpc";
import { PLACEHOLDER_SESSION_ID } from "@shared/sessionId";
import { audioAbsenceSummary, hasStoredAudio, isAudioFailure } from "@shared/audioRetention";
import type { AudioRetentionStatus } from "@shared/types";
import { Download, Headphones, Play, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type Audience = "child" | "parent" | "teacher";

export function downloadText(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

function downloadBytes(filename: string, bytes: Uint8Array, mimeType: string) {
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([data], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

function base64ToBytes(base64: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function downloadBase64(filename: string, dataBase64: string, mimeType: string) {
  downloadBytes(filename, base64ToBytes(dataBase64), mimeType);
}

export function ReportDownloadButton({ childProfileId, audience, label }: { childProfileId: number; audience: Audience; label: string }) {
  const report = trpc.readerLeader.reports.downloadPdf.useQuery({ childProfileId, audience }, { enabled: false, retry: false });
  const download = async () => {
    const result = await report.refetch();
    if (!result.data) return toast(result.error?.message || "Your report could not be prepared.");
    downloadBase64(result.data.filename, result.data.dataBase64, result.data.mimeType);
    toast("Your branded PDF report is downloading.");
  };
  return <button className="report-action" onClick={() => void download()} disabled={report.isFetching}><Download size={15} /> {report.isFetching ? "Preparing…" : label}</button>;
}

type WordTiming = { id: string; text: string; startMs: number; endMs: number };
type PlaybackData = { url: string; transcript: string; wordTimings: WordTiming[] };

function SessionAudioControl({ sessionId, label, highlight = false }: { sessionId?: string | null; label: string; highlight?: boolean }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const audioUrl = trpc.readerLeader.sessions.audioUrl.useQuery({ sessionId: sessionId ?? PLACEHOLDER_SESSION_ID }, { enabled: false, retry: false });

  useEffect(() => () => {
    if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
    audioRef.current?.pause();
  }, []);

  const waitForMetadata = (audio: HTMLAudioElement) => new Promise<void>(resolve => {
    if (audio.readyState >= 1) return resolve();
    audio.addEventListener("loadedmetadata", () => resolve(), { once: true });
    audio.load();
  });

  const play = async () => {
    if (!sessionId) return toast("Your reading is still being saved. Please wait a moment, then try again.");
    const result = await audioUrl.refetch();
    const data = result.data as PlaybackData | undefined;
    if (!data?.url) return toast(result.error?.message || "This recording is unavailable.");
    const audio = audioRef.current;
    if (!audio) return toast("The recording player is preparing. Please try again.");
    const resolvedSource = new URL(data.url, window.location.href).href;
    if (audio.src !== resolvedSource) {
      audio.src = data.url;
      await waitForMetadata(audio);
    }
    if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
    const timing = highlight ? data.wordTimings[Math.min(2, Math.max(0, data.wordTimings.length - 1))] : undefined;
    audio.currentTime = timing ? timing.startMs / 1000 : 0;
    audio.onended = () => setPlaying(false);
    audio.onerror = () => { setPlaying(false); toast("This recording could not be played. Please try again."); };
    try {
      await audio.play();
      setPlaying(true);
      if (timing) {
        const stopAt = Math.min(timing.endMs / 1000 + 0.15, Number.isFinite(audio.duration) ? audio.duration : timing.endMs / 1000 + 0.15);
        stopTimerRef.current = window.setTimeout(() => {
          audio.pause();
          audio.currentTime = stopAt;
          setPlaying(false);
          stopTimerRef.current = null;
        }, Math.max(200, timing.endMs - timing.startMs + 150));
      }
    } catch {
      setPlaying(false);
      toast("Your browser could not start the recording. Check sound is enabled, then try again.");
    }
  };

  return <><audio ref={audioRef} preload="metadata" data-testid={highlight ? "reading-highlight-audio" : "session-audio"} /><button className={`audio-action ${highlight ? "best-moment-action" : ""}`} onClick={() => void play()} disabled={audioUrl.isFetching || playing}><Play size={14} fill="currentColor" /> {audioUrl.isFetching ? "Loading…" : playing ? "Playing…" : label}</button></>;
}

/** An audio control is offered only when there is audio to play. Where there is none, the
 *  reason is stated: an empty player is worse than an honest line about the missing recording. */
function AudioUnavailableNote({ status }: { status: AudioRetentionStatus }) {
  // A deliberate discard is the retention commitment working, so it is never styled as a fault.
  return <span className={`audio-unavailable ${isAudioFailure(status) ? "audio-fault" : "audio-by-design"}`} data-testid="audio-unavailable"><Headphones size={14} /> {audioAbsenceSummary(status)}</span>;
}

export function SessionAudioButton({ sessionId, label = "Play recording", audioStatus }: { sessionId?: string | null; label?: string; audioStatus?: AudioRetentionStatus | null }) {
  if (audioStatus && !hasStoredAudio(audioStatus)) return <AudioUnavailableNote status={audioStatus} />;
  return <SessionAudioControl sessionId={sessionId} label={label} />;
}

export function SessionHighlightButton({ sessionId, label = "Hear a reading highlight" }: { sessionId?: string | null; label?: string }) {
  return <SessionAudioControl sessionId={sessionId} label={label} highlight />;
}

export function SessionTranscriptPlayer({ sessionId, audioStatus }: { sessionId?: string | null; audioStatus?: AudioRetentionStatus | null }) {
  const [playback, setPlayback] = useState<PlaybackData | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clipStopTimerRef = useRef<number | null>(null);
  const audioUrl = trpc.readerLeader.sessions.audioUrl.useQuery({ sessionId: sessionId ?? PLACEHOLDER_SESSION_ID }, { enabled: false, retry: false });

  useEffect(() => () => {
    if (clipStopTimerRef.current !== null) window.clearTimeout(clipStopTimerRef.current);
  }, []);

  const load = async (): Promise<PlaybackData | null> => {
    if (!sessionId) { toast("This saved session does not include a recording."); return null; }
    const result = await audioUrl.refetch();
    if (!result.data?.url) { toast(result.error?.message || "This recording is unavailable."); return null; }
    const data = result.data as PlaybackData;
    setPlayback(data);
    return data;
  };

  const hearWord = async (timing: WordTiming) => {
    const source = playback ?? await load();
    if (!source) return;
    const audio = audioRef.current;
    if (!audio) return toast("The recording player is still preparing. Please choose the word again.");
    const resolvedSource = new URL(source.url, window.location.href).href;
    if (audio.src !== resolvedSource) {
      audio.src = source.url;
      await new Promise<void>(resolve => {
        if (audio.readyState >= 1) return resolve();
        audio.addEventListener("loadedmetadata", () => resolve(), { once: true });
        audio.load();
      });
    }
    audio.currentTime = timing.startMs / 1000;
    const stopAt = timing.endMs / 1000 + 0.15;
    if (clipStopTimerRef.current !== null) window.clearTimeout(clipStopTimerRef.current);
    try {
      await audio.play();
      clipStopTimerRef.current = window.setTimeout(() => {
        audio.pause();
        audio.currentTime = Math.min(stopAt, Number.isFinite(audio.duration) ? audio.duration : stopAt);
        clipStopTimerRef.current = null;
      }, Math.max(150, timing.endMs - timing.startMs + 150));
    } catch { toast("Your browser blocked audio playback. Please try again."); }
  };

  if (audioStatus && !hasStoredAudio(audioStatus)) return <section className="transcript-player"><div><div className="kicker">Word-linked playback</div><h3>No recording to play for this reading.</h3><p>{audioAbsenceSummary(audioStatus)}. The saved transcript and word states below still support a teacher decision.</p></div><AudioUnavailableNote status={audioStatus} /></section>;

  return <section className="transcript-player"><div><div className="kicker">Word-linked playback</div><h3>Listen closely to a saved reading moment.</h3><p>Choose a word to jump to its matching audio moment.</p></div>{!playback ? <button className="audio-action" onClick={() => void load()} disabled={audioUrl.isFetching}><Play size={14} fill="currentColor" /> {audioUrl.isFetching ? "Loading…" : "Open word playback"}</button> : <div className="timed-transcript"><audio ref={audioRef} src={playback.url} preload="metadata" data-testid="word-linked-audio" />{playback.wordTimings.length ? playback.wordTimings.map(timing => <button key={timing.id} onClick={() => void hearWord(timing)} title={`Play ${timing.text}`}><Volume2 size={12} /> {timing.text}</button>) : <p>Word timing is not available for this earlier recording.</p>}</div>}</section>;
}
