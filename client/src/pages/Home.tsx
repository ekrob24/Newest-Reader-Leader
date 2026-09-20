import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { ReportDownloadButton, SessionAudioButton, SessionTranscriptPlayer } from "@/components/ReadingActions";
import { DemoLoginLanding } from "@/components/DemoLoginLanding";
import { AssessmentTrendChart } from "@/components/AssessmentTrendChart";
import { AssignmentConfirmationScreen, MaterialReviewScreen } from "@/components/TeacherWorkflow";
import { TeacherDashboard } from "@/components/TeacherDashboard";
import { ParentDashboard } from "@/components/ParentDashboard";
import { trpc } from "@/lib/trpc";
import type { MaterialRightsSource } from "../../../drizzle/schema";
import { advanceReadingPosition, deriveLiveReading, deriveLiveWordStates, firstGuidedModelWord, initialLiveWordStates, keepWordsAlreadyRead, READING_WORD_PATTERN, readerWordClass, type LiveWordState } from "@shared/liveWordStates";
import kiteArtwork from "../assets/story-art/kite.webp";
import lanternArtwork from "../assets/story-art/lantern.webp";
import plantArtwork from "../assets/story-art/plant.webp";
import robotArtwork from "../assets/story-art/robot.webp";
import { hasChildReadingEvidence, readingCapture, readingCaptureMessage } from "@shared/readingEvidence";
import { installOnDeviceSpeech, onDeviceAvailability, sendsVoiceOffDevice, speechModeNotice, type SpeechMode } from "@shared/onDeviceSpeech";
import { SAVE_PENDING, childSaveMessage, isSaved, type SaveOutcome } from "@shared/saveOutcome";
import { ACCURACY_WITHHELD_NOTE } from "@shared/accuracyAudience";
import { PACE_AWAITS_REVIEW, isPaceMeaningful } from "@shared/readingPace";
import type { AudioRetentionStatus } from "@shared/types";
import { appendRecognitionTranscript } from "@shared/recognitionTranscript";
import { activeRetryWord, createReadingPages, isReadingPageComplete } from "@shared/readingPagination";
import type { ReadingLanguageSupport } from "@shared/dialectSupport";
import { getBrowserConnectionQuality, type ConnectionStatus } from "@shared/connectionQuality";
import { AlertCircle, ArrowLeft, Award, BookOpen, Check, ChevronRight, CirclePause, FileText, Flame, Gauge, Headphones, Home as HomeIcon, LoaderCircle, LogOut, Mic, MicOff, Pause, Play, RotateCcw, ShieldCheck, Sparkles, Square, Star, Trophy, Upload, UsersRound, Volume2, WandSparkles, Wifi, WifiOff, X } from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation, useRoute } from "wouter";

type View = "library" | "reading" | "report" | "quiz" | "teacher" | "parent";
type ReadingState = "ready" | "listening" | "paused" | "processing";
type RecognitionStatus = "ready" | "listening" | "processing" | "paused" | "unavailable";
type CoachMoment = "idle" | "prompt" | "self-correction" | "silent";
type AssessmentMode = "GUIDED_PRACTICE" | "ASSISTED_PRACTICE" | "MONTHLY_ASSESSMENT";
type WordState = LiveWordState;
type Story = { id: string; materialId?: number; title: string; level: string; focus: string; duration: string; description: string; text: string; art: "kite" | "plant" | "robot" | "lantern"; color: string; accent: string };
/** Restart the recogniser after this much silence while the child is meant to be reading.
 *  The browser's speech service stops on its own and does not always fire onend. */
const RECOGNITION_RESTART_AFTER_MS = 9_000;
/** How long the recogniser must be stranded before the reader is told anything at all. */
const MIC_TROUBLE_AFTER_MS = 4_000;

type Report = { transcript: string; mode: AssessmentMode; correctWords: number; totalWords: number; durationSeconds: number; retrySummary: { word: string; retries: number }[]; selfCorrections: string[]; modelWords: string[]; childMessage: string; nextStep: string; transcriptionStatus: "transcribed" | "guided"; hasRecording?: boolean; paceReliable?: boolean; audioStatus?: AudioRetentionStatus };

const stories: Story[] = [
  { id: "kite", title: "The Moonlight Kite", level: "Level 3 · Sky Blue", focus: "Expression & smooth phrasing", duration: "4 min read", description: "Mina follows a silver kite into a field after sunset.", art: "kite", color: "#dfe7ff", accent: "#2350c5", text: "Mina found a bright kite caught in the tall grass. Its silver tail glimmered in the moonlight. She lifted the string and the kite rose over the quiet field. A gentle wind carried it higher, and Mina laughed as it danced among the stars." },
  { id: "seed", title: "The Secret Seed", level: "Level 3 · Sun Yellow", focus: "Tricky vowel teams", duration: "3 min read", description: "A tiny seed teaches Ben that patience can grow into magic.", art: "plant", color: "#fff1bd", accent: "#48a16d", text: "Ben planted a small seed beside the school gate. Every morning he brought a cup of water and whispered a cheerful hello. On Friday, a green shoot pushed through the soil. By spring, a sunflower stood taller than Ben and turned its golden face towards the sun." },
  { id: "robot", title: "Rainy-Day Robot", level: "Level 4 · Red Circle", focus: "Pace & punctuation", duration: "5 min read", description: "Zuri and a helpful robot invent a new way to brighten a wet afternoon.", art: "robot", color: "#ffdcd4", accent: "#e64b38", text: "Rain tapped on Zuri's window all afternoon. Her little robot, Bolt, rolled across the table and flashed a blue light. Together they built a tiny boat from a cereal box. They sailed it through puddles in the garden until the grey clouds opened and a rainbow appeared." },
];
const fallbackTranscripts: Record<string, string> = { kite: "Mina found a bright kite caught in the tall grass. Its silver tail glimmered in the moonlight. She lifted the string and the kite rose over the quiet field. A gentle wind carried it higher, and Mina laughed as it danced among the stars.", seed: "Ben planted a small seed beside the school gate. Every morning he brought a cup of water and whispered a cheerful hello. On Friday a green shoot pushed through the soil.", robot: "Rain tapped on Zuri's window all afternoon. Her little robot Bolt rolled across the table and flashed a blue light. Together they built a tiny boat from a cereal box." };
const words = (text: string) => text.match(READING_WORD_PATTERN) ?? [];

function createGuidedReport(story: Story, transcript: string, durationSeconds: number, mode: AssessmentMode, wordStates: WordState[]): Report {
  const expected = words(story.text).map(word => word.toLowerCase());
  /**
   * Counted from the word states the matcher produced, not by comparing positions.
   *
   * This line was `expected.filter((word, index) => heard[index] === word).length` - strict
   * positional equality, so one word the recogniser dropped put every word after it against
   * the wrong expected word. That is precisely the failure deriveLiveWordStates documents at
   * length and solves with bounded re-anchoring; the live matcher was fixed and this scorer
   * was not. Measured on "Rainy-Day Robot" with one unstressed "a" dropped: the matcher says
   * 29 of 30, this said 17, and 57% is what went into the saved record while the child's
   * screen showed her she had read it. There is one alignment implementation now.
   */
  const correctWords = wordStates.filter(state => state.status === "correct" || state.status === "retried_correct").length;
  const retrySummary = mode === "MONTHLY_ASSESSMENT" ? [] : wordStates.filter(state => state.attempts > 1).map(state => ({ word: state.text, retries: state.attempts - 1 }));
  const selfCorrections = mode === "MONTHLY_ASSESSMENT" ? [] : wordStates.filter(state => state.status === "retried_correct").map(state => state.text);
  const safeDuration = Math.max(durationSeconds, 1);
  const paceReliable = isPaceMeaningful(durationSeconds);
  return { transcript, mode, correctWords, totalWords: expected.length, durationSeconds: safeDuration, retrySummary, selfCorrections, modelWords: mode === "GUIDED_PRACTICE" ? wordStates.filter(state => state.status === "incorrect" && state.attempts >= 2).map(state => state.text) : [], childMessage: mode === "MONTHLY_ASSESSMENT" ? "You finished your monthly reading check with calm focus." : selfCorrections.length ? "You had another go at a tricky word. That is a smart reader move." : "You kept the story moving. You can choose one small word activity next.", nextStep: mode === "MONTHLY_ASSESSMENT" ? "No correction prompts were used during this first-pass reading check." : "Choose one sentence you enjoyed and read it again with a smooth, steady voice.", paceReliable, transcriptionStatus: "guided" };
}

function playSpeech(text: string, onStart?: () => void, onEnd?: () => void) {
  if (!("speechSynthesis" in window) || !text.trim()) { toast("Read-aloud is not available in this browser."); return false; }
  window.speechSynthesis.cancel();
  const message = new SpeechSynthesisUtterance(text);
  message.rate = .82;
  message.pitch = 1.04;
  message.onstart = () => onStart?.();
  message.onend = () => onEnd?.();
  message.onerror = () => { onEnd?.(); toast("Read-aloud could not start. Check that your device sound is on, then try again."); };
  window.speechSynthesis.resume();
  window.speechSynthesis.speak(message);
  return true;
}
function arrayBufferToBase64(buffer: ArrayBuffer) { let binary = ""; const bytes = new Uint8Array(buffer); for (let index = 0; index < bytes.byteLength; index += 1) binary += String.fromCharCode(bytes[index]); return window.btoa(binary); }


export default function Home() {
  const { user, loading, isAuthenticated, logout, refresh } = useAuth();
  const [location, setLocation] = useLocation();
  const [, reviewParams] = useRoute("/teacher/materials/:id/review");
  const utils = trpc.useUtils();
  const [view, setView] = useState<View>("library");
  const [selectedStory, setSelectedStory] = useState<Story>(stories[0]);
  const [warmUpStory, setWarmUpStory] = useState<Story | null>(null);
  const [readingState, setReadingState] = useState<ReadingState>("ready");
  const [recognitionStatus, setRecognitionStatus] = useState<RecognitionStatus>("ready");
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(() => getBrowserConnectionQuality());
  const [hesitationHint, setHesitationHint] = useState(false);
  /** The browser's own word for why recognition stopped. Shown rather than guessed at. */
  const [recognitionError, setRecognitionError] = useState<string | null>(null);
  /** Only after the recogniser has been stranded long enough that this is not an ordinary
   *  restart. Derived from a sustained state rather than an instantaneous one, so it cannot
   *  flash at the moment the child presses the button. */
  const [micTrouble, setMicTrouble] = useState(false);
  /** What the recogniser is currently guessing, before it settles. Shown, never scored. */
  const [interimTranscript, setInterimTranscript] = useState("");
  const interimTranscriptRef = useRef("");
  /** Where this browser processes the child's voice. Shown, never assumed. */
  const [speechMode, setSpeechMode] = useState<SpeechMode>("cloud");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null);
  const [hasSavedRecording, setHasSavedRecording] = useState(false);
  // The single source for whether this reading reached the server. Only mutation callbacks
  // write to it, so no screen can claim a save the server did not confirm.
  const [saveOutcome, setSaveOutcome] = useState<SaveOutcome>(SAVE_PENDING);
  const lastAttemptRef = useRef<(() => void) | null>(null);
  const [modelSpeaking, setModelSpeaking] = useState(false);
  const [coachMoment, setCoachMoment] = useState<CoachMoment>("idle");
  const [assessmentMode, setAssessmentMode] = useState<AssessmentMode>("ASSISTED_PRACTICE");
  const [wordStates, setWordStates] = useState<WordState[]>(() => initialLiveWordStates(stories[0].text));
  /** Where the reader is. Follows interims and only ever moves forwards; see liveWordStates. */
  const [positionIndex, setPositionIndex] = useState(0);
  const [movedOnAttempts, setMovedOnAttempts] = useState<Map<string, number>>(() => new Map());
  const previousAccountRole = useRef<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const wasPausedRef = useRef(0);
  const pausedDurationRef = useRef(0);
  const shouldCompleteRef = useRef(false);
  const recognitionDesiredRef = useRef(false);
  const transcriptFrameRef = useRef<number | null>(null);
  const pendingTranscriptRef = useRef("");
  const liveTranscriptRef = useRef("");
  /** Interim speech rescued from a stopping recogniser. Part of the record, never of judgement. */
  const committedInterimRef = useRef("");
  const lastRecognitionAtRef = useRef(0);
  const restartTimerRef = useRef<number | null>(null);
  const recognitionFailuresRef = useRef(0);
  const notListeningSinceRef = useRef<number | null>(null);
  const speechModeRef = useRef<SpeechMode>("cloud");
  const guidedModelledWordsRef = useRef(new Set<string>());

  const accountQuery = trpc.readerLeader.account.me.useQuery(undefined, { enabled: isAuthenticated });
  const accountRole = accountQuery.data?.role ?? user?.role ?? "user";
  const isTeacherAccount = accountRole === "teacher" || accountRole === "admin";
  const isParentAccount = accountRole === "parent" || accountRole === "admin";
  const childProfile = accountQuery.data?.profile;
  const teacherDashboard = trpc.readerLeader.dashboards.teacher.useQuery(undefined, { enabled: isAuthenticated && isTeacherAccount });
  const parentDashboard = trpc.readerLeader.dashboards.parent.useQuery(undefined, { enabled: isAuthenticated && isParentAccount });
  const childProgress = trpc.readerLeader.sessions.childProgress.useQuery({ childProfileId: childProfile?.id ?? 1 }, { enabled: Boolean(childProfile?.id) });
  const assignedMaterials = trpc.readerLeader.materials.assignedForMe.useQuery(undefined, { enabled: accountRole === "child" });
  const joinClass = trpc.readerLeader.account.joinClass.useMutation({ onSuccess: async data => { await utils.readerLeader.materials.assignedForMe.invalidate(); toast(`You are now connected to ${data.readerClass.name}.`); } });
  // This call is the last line of defence, so its own failure cannot be quiet. It reports a
  // reading the server refused; if it is itself refused there is nowhere else to put the
  // fact, and the only remaining record is the child's screen.
  const reportUnrecordedAttempt = trpc.readerLeader.sessions.recordUnrecordedAttempt.useMutation({
    onError: error => console.error("[readerLeader] could not record an unsaved reading:", error.message),
  });
  // A reading the server refused still happened. Leave a record a teacher can see, so the
  // gap in the child's history is visible to someone rather than to no one.
  const noteUnsavedReading = (reason: "save_rejected" | "no_reading_evidence", detail: string, durationSeconds?: number) => {
    if (!childProfile?.id) return;
    reportUnrecordedAttempt.mutate({
      childProfileId: childProfile.id,
      materialId: selectedStory.materialId,
      storyTitle: selectedStory.title.slice(0, 180),
      reason,
      // A rejected save's message can be a serialised list of validation issues, which is
      // far longer than the column. Truncating here is what stops the report of a failure
      // failing the same way the thing it reports failed.
      detail: detail.slice(0, 400),
      durationSeconds,
    });
  };
  const markSaved = (sessionId: string, audioStorageKey: unknown) => {
    setSavedSessionId(sessionId);
    setHasSavedRecording(Boolean(audioStorageKey));
    setSaveOutcome({ status: "saved", sessionId });
    void utils.readerLeader.sessions.childProgress.invalidate();
    void utils.readerLeader.dashboards.teacher.invalidate();
    void utils.readerLeader.dashboards.parent.invalidate();
  };
  const markNotSaved = (detail: string, durationSeconds?: number) => {
    setSavedSessionId(null);
    setHasSavedRecording(false);
    setSaveOutcome({ status: "failed", reason: detail, retryable: true });
    noteUnsavedReading("save_rejected", detail, durationSeconds);
  };
  const saveSession = trpc.readerLeader.sessions.save.useMutation({
    onSuccess: data => markSaved(data.session.id, data.session.audioStorageKey),
    onError: error => markNotSaved(error.message),
  });
  // Counts what is settled plus what is still being guessed. The cursor keeps up with the
  // child in real time while nothing unsettled reaches the word states or the record.
  // The bar and the highlight must answer from the same place.
  //
  // This counted words of raw transcript against words of story - what the recogniser emitted,
  // not what matched. So the moment the matcher lost the reader, the highlight stopped and the
  // bar kept advancing, and a child was told to keep going by one element while another had
  // stopped following her. It is the software asserting something it did not observe, in the
  // version of that defect a child sees.
  //
  // It now counts words the matcher has actually reached, which is what the highlight shows.
  // When matching stalls the bar stalls with it. That does not fix the matching; it stops the
  // product claiming progress it cannot see.
  const processedWords = useMemo(() => wordStates.filter(state => state.status !== "unread" && state.status !== "current").length, [wordStates]);
  const selectedStoryWords = useMemo(() => selectedStory.text.match(/\S+\s*/g) ?? [], [selectedStory]);
  const languageSupport = (childProgress.data?.learnerSettings?.languageSupport || "STANDARD_ENGLISH") as ReadingLanguageSupport;
  const educatorApprovedVariants = childProgress.data?.irishVariantContext?.variants || [];

  useEffect(() => {
    if (!isAuthenticated || accountQuery.isLoading || previousAccountRole.current === accountRole) return;
    previousAccountRole.current = accountRole;
    if (accountRole === "teacher" || accountRole === "admin") setView("teacher");
    else if (accountRole === "parent") setView("parent");
    else if (accountRole === "child") setView("library");
  }, [accountRole, accountQuery.isLoading, isAuthenticated]);

  useEffect(() => {
    if (!liveTranscript.trim()) return;
    const derived = deriveLiveWordStates(selectedStory.text, liveTranscript, assessmentMode, languageSupport, educatorApprovedVariants, movedOnAttempts);
    // A word the child has already read stays read, whatever a later revision decides.
    setWordStates(previous => keepWordsAlreadyRead(previous, derived));
  }, [assessmentMode, educatorApprovedVariants, languageSupport, liveTranscript, movedOnAttempts, selectedStory.text]);

  // Position, separately, from finals plus the interim in flight. Judgement above is
  // untouched: it still sees only what the recogniser has settled, which is what stopped the
  // green-red-green flicker. Nothing here writes a status, and the cursor never goes back.
  useEffect(() => {
    const heard = `${liveTranscript} ${committedInterimRef.current} ${interimTranscript}`.replace(/\s+/g, " ").trim();
    if (!heard) return setPositionIndex(0);
    const { position } = deriveLiveReading(selectedStory.text, heard, assessmentMode, languageSupport, educatorApprovedVariants, movedOnAttempts);
    setPositionIndex(previous => advanceReadingPosition(previous, position));
  }, [assessmentMode, educatorApprovedVariants, interimTranscript, languageSupport, liveTranscript, movedOnAttempts, selectedStory.text]);

  useEffect(() => {
    const update = () => setConnectionStatus(getBrowserConnectionQuality());
    const connection = (navigator as Navigator & { connection?: { addEventListener?: (name: string, callback: () => void) => void; removeEventListener?: (name: string, callback: () => void) => void } }).connection;
    window.addEventListener("online", update); window.addEventListener("offline", update); connection?.addEventListener?.("change", update); update();
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); connection?.removeEventListener?.("change", update); };
  }, []);

  useEffect(() => {
    if (assessmentMode !== "GUIDED_PRACTICE") return;
    const needsModel = firstGuidedModelWord(wordStates, guidedModelledWordsRef.current);
    if (!needsModel) return;
    guidedModelledWordsRef.current.add(needsModel.id);
    if (readingState === "listening") pauseOrResume();
    playSpeech(needsModel.text);
    setCoachMoment("prompt");
    toast(`Let’s hear “${needsModel.text}” together, then you can try it again.`);
  }, [assessmentMode, readingState, wordStates]);

  useEffect(() => {
    // Runs whenever the child is meant to be reading, not only while recognition reports
    // itself as listening: a recogniser stuck in any other state is exactly what the
    // watchdog below has to notice.
    if (readingState !== "listening") {
      setHesitationHint(false);
      return;
    }
    // Never alongside the microphone warning: "take a breath and keep going" is the wrong
    // advice, and the wrong explanation, when nothing is listening.
    if (recognitionStatus !== "listening") setHesitationHint(false);
    const timer = window.setInterval(() => {
      if (recognitionStatus === "listening" && lastRecognitionAtRef.current && Date.now() - lastRecognitionAtRef.current > 5_500) setHesitationHint(true);
      // The browser's speech service stops on its own and onend does not always bring it
      // back, so the child ends up reading to a microphone that is not listening with
      // nothing on screen saying so.
      //
      // Watch the recogniser's own state, not how long the child has been quiet. A quiet
      // child with a healthy recogniser is a child thinking about a word; restarting then
      // aborts something that was working, and the abort is what produced the error the
      // reader was shown. What needs recovering is a recogniser that has stopped saying it
      // is listening and has not come back.
      if (recognitionStatus === "listening") {
        notListeningSinceRef.current = null;
        if (micTrouble) setMicTrouble(false);
        return;
      }
      if (notListeningSinceRef.current === null) { notListeningSinceRef.current = Date.now(); return; }
      const strandedFor = Date.now() - notListeningSinceRef.current;
      // Long enough that an ordinary restart, which takes a moment, never shows a warning.
      if (strandedFor > MIC_TROUBLE_AFTER_MS && !micTrouble) setMicTrouble(true);
      if (recognitionDesiredRef.current && strandedFor > RECOGNITION_RESTART_AFTER_MS) {
        notListeningSinceRef.current = Date.now();
        scheduleRecognitionRestart();
      }
    }, 700);
    return () => window.clearInterval(timer);
  }, [readingState, recognitionStatus, micTrouble]);

  // Decide once, at load, where speech will be processed — and fetch the local model if the
  // browser has one available to download. Not silent either way: the reader is told.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let availability = await onDeviceAvailability(window, "en-IE");
      if (availability === "downloadable" || availability === "downloading") {
        const installed = await installOnDeviceSpeech(window, "en-IE");
        availability = installed ? "available" : await onDeviceAvailability(window, "en-IE");
      }
      if (cancelled) return;
      const mode: SpeechMode = availability === "available" ? "on-device" : "cloud";
      speechModeRef.current = mode;
      setSpeechMode(mode);
    })();
    return () => { cancelled = true; };
  }, []);

  const finishWithReport = (candidate: Report, persist = true) => {
    setReport(candidate);
    setReadingState("ready");
    setRecognitionStatus("ready");
    if (childProfile?.id && persist) {
      const coach = coachMoment === "silent" ? [{ word: "castle", action: "teacher_review" as const, note: "Possible pronunciation variation — flagged for teacher review. The coach stayed silent." }] : coachMoment === "prompt" || coachMoment === "self-correction" ? [{ word: "garden", action: "prompt" as const, note: "Try that word again when you are ready." }] : [];
      const attempt = () => {
        setSaveOutcome(SAVE_PENDING);
        saveSession.mutate({ childProfileId: childProfile.id, materialId: selectedStory.materialId, storyTitle: selectedStory.title, expectedText: selectedStory.text, transcript: candidate.transcript, durationSeconds: candidate.durationSeconds, assessmentMode, wordStates, demoInterventions: coach });
      };
      lastAttemptRef.current = attempt;
      attempt();
    } else if (persist) {
      // No child profile, so nothing was ever sent. Say that, rather than showing a screen
      // that reads as a successful save.
      lastAttemptRef.current = null;
      setSaveOutcome({ status: "not_attempted", reason: "No reading profile is signed in." });
    }
    setView("report");
  };
  const processAndSave = trpc.readerLeader.sessions.processAndSave.useMutation({
    onSuccess: data => {
      finishWithReport({ ...data.analysis, transcriptionStatus: data.transcriptionStatus, hasRecording: Boolean(data.session.audioStorageKey), audioStatus: data.audioStatus }, false);
      markSaved(data.session.id, data.session.audioStorageKey);
    },
    // The server rejected this reading. Fall back to the guided report for the child's
    // feedback, but do not let the fallback pretend the reading was kept.
    onError: error => { finishWithGuidedTranscript({ persist: false }); markNotSaved(error.message); },
  });
  const processRecording = trpc.reading.processRecording.useMutation({
    onSuccess: data => finishWithReport(data),
    onError: () => { finishWithGuidedTranscript(); toast("The live transcript was unavailable, so the session used guided practice feedback."); },
  });

  function resetWordStates(story: Story) { guidedModelledWordsRef.current.clear(); setMovedOnAttempts(new Map()); setPositionIndex(0); setWordStates(initialLiveWordStates(story.text)); }
  function clearLiveTranscript() { liveTranscriptRef.current = ""; committedInterimRef.current = ""; pendingTranscriptRef.current = ""; setLiveTranscript(""); setInterimTranscript(""); }
  function launchStory(story: Story) { setSelectedStory(story); clearLiveTranscript(); setReport(null); setSavedSessionId(null); setHasSavedRecording(false); setModelSpeaking(false); setCoachMoment("idle"); setHesitationHint(false); setAssessmentMode(childProgress.data?.learnerSettings?.defaultReadingMode || "ASSISTED_PRACTICE"); resetWordStates(story); setReadingState("ready"); setRecognitionStatus("ready"); setView("reading"); }
  function chooseStory(story: Story) { setWarmUpStory(story); }
  function selectAssessmentMode(mode: AssessmentMode) { setAssessmentMode(mode); clearLiveTranscript(); setCoachMoment("idle"); resetWordStates(selectedStory); }
  function recordWordAttempt(correct: boolean) {
    const target = wordStates.find(state => state.status === "current") ?? wordStates.find(state => state.status === "incorrect");
    if (!target) return;
    const nextAttempts = target.attempts + 1;
    setWordStates(previous => previous.map((state, index) => {
      if (state.id === target.id) return { ...state, attempts: nextAttempts, status: assessmentMode === "MONTHLY_ASSESSMENT" || correct ? (state.status === "incorrect" ? "retried_correct" : "correct") : "incorrect" };
      if (state.id === `word-${Number(target.id.replace("word-", "")) + 1}` && (assessmentMode === "MONTHLY_ASSESSMENT" || correct)) return { ...state, status: "current" };
      return state;
    }));
    if (!correct && assessmentMode === "GUIDED_PRACTICE" && nextAttempts >= 2) { if (readingState === "listening") pauseOrResume(); playSpeech(target.text); setCoachMoment("prompt"); toast("The Reading Coach played a model after two tries. Listen, then have another go."); }
    else if (correct && target.status === "incorrect") setCoachMoment("self-correction");
  }
  function moveOnFromTrickyWord(wordId?: string) {
    if (assessmentMode === "MONTHLY_ASSESSMENT") return;
    const target = (wordId ? wordStates.find(state => state.id === wordId) : undefined) ?? wordStates.find(state => state.status === "current") ?? wordStates.find(state => state.status === "incorrect");
    if (!target) return;
    const targetIndex = Number.parseInt(target.id.replace("word-", ""), 10);
    if (!Number.isFinite(targetIndex)) return toast("Keep reading from the next word when you are ready.");
    // The attempts the child actually made, not a floor of three.
    setMovedOnAttempts(previous => new Map(previous).set(target.id, Math.max(target.attempts, 1)));
    setWordStates(previous => previous.map((state, index) => {
      if (state.id === target.id) return { ...state, status: "incorrect", attempts: Math.max(state.attempts, 1), movedOn: true };
      if (index === targetIndex + 1 && state.status === "unread") return { ...state, status: "current" };
      return state;
    }));
    setHesitationHint(false);
    setCoachMoment("idle");
    toast(`That word is saved to practise after your story. You can keep reading.`);
  }
  function hearModel(text: string) {
    if (readingState === "listening") pauseOrResume();
    setModelSpeaking(true);
    if (!playSpeech(text, () => setModelSpeaking(true), () => setModelSpeaking(false))) setModelSpeaking(false);
  }
  function cleanupRecording() { recognitionDesiredRef.current = false; if (restartTimerRef.current !== null) { window.clearTimeout(restartTimerRef.current); restartTimerRef.current = null; } recognitionFailuresRef.current = 0; recognitionRef.current?.stop?.(); recognitionRef.current = null; if (transcriptFrameRef.current !== null) window.cancelAnimationFrame(transcriptFrameRef.current); transcriptFrameRef.current = null; streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null; recorderRef.current = null; }
  /**
   * Everything the child has said, settled or not.
   *
   * Word states are derived from finalised speech only, so the highlighting cannot flicker.
   * The saved record must not be that strict: a recogniser that is stopped — which every
   * restart does, and finishing does — discards whatever it had not settled yet, and that
   * speech was still spoken. Dropping it produced a saved reading with no transcript at all,
   * scored 0%.
   */
  /**
   * What the child said, for the record. Finals, plus interim speech a stopping recogniser
   * would otherwise have thrown away, plus whatever interim is in flight right now.
   *
   * Kept apart from `liveTranscript`, which is finals only and is what judgement is derived
   * from. Folding unsettled speech into that stream - which is what committing an interim used
   * to do, on every recogniser restart, and restarts are frequent - scores words the
   * recogniser has not settled and is a route straight back to the green-red-green flicker the
   * finals-only rule exists to prevent. The requirement underneath is real: a stopped
   * recogniser discards unsettled speech, and dropping it produced empty transcripts scored at
   * nought. But that requirement is about the saved record, not about the colours.
   */
  function spokenTranscript() {
    return `${liveTranscriptRef.current} ${committedInterimRef.current} ${interimTranscriptRef.current}`.replace(/\s+/g, " ").trim();
  }
  /** Fold unsettled speech into the record - and only into the record - before a recogniser is
   *  replaced or stopped. */
  function commitInterimSpeech() {
    if (!interimTranscriptRef.current) return;
    committedInterimRef.current = `${committedInterimRef.current} ${interimTranscriptRef.current}`.replace(/\s+/g, " ").trim();
    interimTranscriptRef.current = "";
    setInterimTranscript("");
  }
  /**
   * Credit an open pause before anyone reads the clock. Idempotent.
   *
   * Pausing recorded the moment and only the resume branch credited it, so a reading paused
   * and then finished - pause, walk away, come back, Finish story - carried the whole idle
   * period as reading time. Live data showed a 2,040-second session among reads of 26 to 92
   * seconds, and settledWordsCorrectPerMinute divides by exactly that number, so a teacher
   * who reviewed it would have been shown a pace built on an invented duration.
   */
  function settleElapsed() {
    if (wasPausedRef.current === 0) return;
    pausedDurationRef.current += Date.now() - wasPausedRef.current;
    wasPausedRef.current = 0;
  }
  /** Reading time in seconds, or null when there is no start to measure from. */
  function elapsedSeconds(): number | null {
    settleElapsed();
    if (startedAtRef.current <= 0) return null;
    return Math.max(0, Math.round((Date.now() - startedAtRef.current - pausedDurationRef.current) / 1000));
  }
  function hasReadingEvidence() { return hasChildReadingEvidence(spokenTranscript(), wordStates); }
  function finishWithGuidedTranscript({ persist = true }: { persist?: boolean } = {}) {
    if (!hasReadingEvidence()) { setReadingState("ready"); setRecognitionStatus("ready"); toast("Read a little before finishing so Reader Leader can make a helpful report."); return; }
    const elapsed = elapsedSeconds() ?? 0;
    finishWithReport(createGuidedReport(selectedStory, spokenTranscript(), elapsed, assessmentMode, wordStates), persist);
  }
  async function sendRecording(blob: Blob) {
    // Report the reading time that actually elapsed. This used to be raised to twenty
    // seconds to clear the server's old minimum, which meant a short read was sent, stored
    // and shown to a teacher as a twenty-second one.
    const elapsed = elapsedSeconds() ?? 0;
    // No audio, or more than the server will accept. The reading still happened, so it still
    // goes to the server — as a guided save rather than being quietly dropped here.
    if (blob.size === 0 || blob.size > 4_500_000) {
      toast(blob.size === 0 ? "No sound reached the microphone, so your words were saved from the live transcript." : "That recording was too long to send, so your words were saved from the live transcript.");
      return finishWithGuidedTranscript();
    }
    try { const payload = { audioBase64: arrayBufferToBase64(await blob.arrayBuffer()), audioMime: blob.type || "audio/webm", expectedText: selectedStory.text, durationSeconds: elapsed, fallbackTranscript: spokenTranscript() }; if (childProfile?.id) processAndSave.mutate({ ...payload, childProfileId: childProfile.id, materialId: selectedStory.materialId, storyTitle: selectedStory.title, assessmentMode, wordStates }); else processRecording.mutate(payload); } catch { finishWithGuidedTranscript(); }
  }
  /**
   * Own exactly one recogniser at a time.
   *
   * The browser's speech service stops by itself, and the old code restarted it from two
   * places at once: the instance's own onend, and the watchdog. Both could create a new
   * recogniser before the previous one had finished ending, so two were live together — each
   * appending to liveTranscriptRef from the baseline it captured when it was created. The
   * transcript then went backwards or repeated, which marks words already read as misread.
   * Whichever lost the race also left recognitionRef pointing at a dead object, so the next
   * restart had nothing real to stop.
   *
   * So: every start goes through here, the previous instance has its handlers detached and is
   * aborted before a new one exists, and a result from an instance that is no longer the
   * current one is discarded.
   */
  function beginRecognition() {
    const Recognition = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!Recognition) { setRecognitionStatus("unavailable"); return toast("Live words are not supported by this browser. Your saved recording can still be reviewed after you finish."); }
    if (restartTimerRef.current !== null) { window.clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
    recognitionDesiredRef.current = true;

    const previous = recognitionRef.current;
    if (previous) {
      // Stopping discards anything not yet settled, so keep it first.
      commitInterimSpeech();
      previous.onresult = null; previous.onerror = null; previous.onend = null; previous.onstart = null;
      try { previous.abort?.(); } catch { /* already gone */ }
    }

    const recognitionBase = liveTranscriptRef.current;
    const recognition = new Recognition();
    recognition.lang = "en-IE"; recognition.continuous = true; recognition.interimResults = true; recognition.maxAlternatives = 1;
    // Local when the browser can. This keeps a child's voice on the device, and it removes
    // the network round trip to the browser maker's speech service, which is what stops of
    // its own accord and leaves the reader talking to nothing.
    if (speechModeRef.current === "on-device") recognition.processLocally = true;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionFailuresRef.current = 0;
      lastRecognitionAtRef.current = Date.now();
      setRecognitionStatus("listening");
    };
    recognition.onresult = (event: any) => {
      // A result from a recogniser we have already replaced would rewind the transcript.
      if (recognitionRef.current !== recognition) return;
      // Finalised results only. Interim results are the recogniser thinking aloud: it revises
      // them continuously, and every revision re-derived every word, so a word turned green,
      // then red, then green, in a loop. They are also not a record of what a child said, so
      // they have no business in a transcript that gets scored and saved. Kept separately,
      // they still drive the live sense of being heard.
      let finalText = "";
      let interimText = "";
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalText += `${result[0].transcript} `;
        else interimText += `${result[0].transcript} `;
      }
      interimTranscriptRef.current = interimText.trim();
      setInterimTranscript(interimText.trim());
      if (!finalText.trim()) {
        // Still mid-phrase: the child is being heard, but nothing is settled to score yet.
        recognitionFailuresRef.current = 0;
        lastRecognitionAtRef.current = Date.now();
        setHesitationHint(false);
        setRecognitionStatus("listening");
        return;
      }
      const combinedTranscript = appendRecognitionTranscript(recognitionBase, finalText);
      liveTranscriptRef.current = combinedTranscript;
      pendingTranscriptRef.current = combinedTranscript;
      if (transcriptFrameRef.current === null) transcriptFrameRef.current = window.requestAnimationFrame(() => { transcriptFrameRef.current = null; setLiveTranscript(pendingTranscriptRef.current); });
      recognitionFailuresRef.current = 0;
      lastRecognitionAtRef.current = Date.now(); setHesitationHint(false);
      setRecognitionStatus("listening");
    };
    recognition.onerror = (event: any) => {
      if (recognitionRef.current !== recognition) return;
      // "aborted" is what the browser reports when this app stops recognition itself, which
      // every restart does, and "no-speech" is a child thinking. Neither is a fault, and
      // showing them told the reader something was wrong when nothing was.
      if (event.error === "aborted" || event.error === "no-speech") return;
      setRecognitionError(typeof event?.error === "string" ? event.error : "unknown");
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        // A permission refusal is not something to retry at the child.
        recognitionDesiredRef.current = false;
        setRecognitionStatus("unavailable");
        return;
      }
      recognitionFailuresRef.current += 1;
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      if (recognitionDesiredRef.current) { setRecognitionStatus("processing"); scheduleRecognitionRestart(); }
    };

    try {
      recognition.start();
      // Synchronously, not only in onstart: onstart can lag by hundreds of milliseconds, and
      // in that gap the reader was told the microphone had stopped the instant they started.
      lastRecognitionAtRef.current = Date.now();
      setRecognitionError(null);
      setRecognitionStatus("listening");
    } catch {
      // Usually the previous instance has not finished ending. Back off and try again rather
      // than leaving a recogniser that was never started as the current one.
      recognitionFailuresRef.current += 1;
      setRecognitionStatus("processing");
      scheduleRecognitionRestart();
    }
  }

  /** One restart in flight at a time, backing off as failures repeat. */
  function scheduleRecognitionRestart() {
    if (!recognitionDesiredRef.current) return;
    if (restartTimerRef.current !== null) return;
    const delay = Math.min(200 * 2 ** Math.max(0, recognitionFailuresRef.current - 1), 4_000);
    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = null;
      if (recognitionDesiredRef.current) beginRecognition();
    }, delay);
  }

  async function startReading() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { startedAtRef.current = Date.now(); setReadingState("listening"); setRecognitionStatus("unavailable"); return toast("Recording is not available in this browser. You can still complete the guided reading session."); }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : ""; const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      streamRef.current = stream; recorderRef.current = recorder; chunksRef.current = []; pausedDurationRef.current = 0; startedAtRef.current = Date.now(); lastRecognitionAtRef.current = Date.now(); setHesitationHint(false);
      recorder.ondataavailable = event => { if (event.data.size > 0) chunksRef.current.push(event.data); };
      recorder.onstop = () => { const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }); cleanupRecording(); if (shouldCompleteRef.current) { shouldCompleteRef.current = false; setReadingState("processing"); setRecognitionStatus("processing"); void sendRecording(blob); } };
      recorder.start(1000); beginRecognition(); setReadingState("listening");
    } catch { startedAtRef.current = Date.now(); setReadingState("listening"); setRecognitionStatus("unavailable"); toast("Microphone access was not granted. Guided practice remains available."); }
  }
  function pauseOrResume() { const recorder = recorderRef.current; if (readingState === "listening") { recorder?.pause(); recognitionDesiredRef.current = false; recognitionRef.current?.stop?.(); wasPausedRef.current = Date.now(); setRecognitionStatus("paused"); return setReadingState("paused"); } if (readingState === "paused") { recorder?.resume(); settleElapsed(); beginRecognition(); setReadingState("listening"); } }
  function restartReading() { shouldCompleteRef.current = false; wasPausedRef.current = 0; pausedDurationRef.current = 0; if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop(); else cleanupRecording(); startedAtRef.current = 0; pausedDurationRef.current = 0; clearLiveTranscript(); setCoachMoment("idle"); setReadingState("ready"); setRecognitionStatus("ready"); toast("Fresh start. Take your time and enjoy the story."); }
  function completeReading() {
    if (readingState === "processing") return;
    if (!hasReadingEvidence()) { toast("Start reading before finishing. Even a few words are enough to begin a helpful report."); return; }
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") { shouldCompleteRef.current = true; recorder.stop(); return; }
    if (recorder?.state === "paused") { recorder.stop(); cleanupRecording(); }
    settleElapsed();
    setReadingState("processing"); window.setTimeout(finishWithGuidedTranscript, 160);
  }
  function completeGuidedSession() { shouldCompleteRef.current = false; settleElapsed(); if (!hasReadingEvidence()) { cleanupRecording(); setReadingState("ready"); setRecognitionStatus("ready"); return toast("Read a little before finishing so Reader Leader can make a helpful report."); } if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop(); cleanupRecording(); setRecognitionStatus("processing"); finishWithGuidedTranscript(); }
  function chooseView(next: View) { if (next === "teacher" && !isTeacherAccount) return toast("Sign in with a teacher account to open the Teacher Dashboard."); if (next === "parent" && !isParentAccount) return toast("Sign in with a parent account to open the Parent Dashboard."); if (next === "reading" && !childProfile) return toast("Set up a child profile before starting a Reading Session."); setView(next); }
  function switchWorkspace(target: "child" | "teacher") { window.sessionStorage.setItem("reader-leader-switch-role", target); void logout(); }

  if (loading) return <div className="auth-screen"><div className="auth-loading">Opening your reading space…</div></div>;
  if (!isAuthenticated) return <DemoLoginLanding />;
  if (accountQuery.isLoading) return <div className="auth-screen"><div className="auth-loading">Finding your Reader Leader account…</div></div>;
  if (accountRole === "user") return <AccountSetup onDone={async () => { await refresh(); await accountQuery.refetch(); window.location.reload(); }} />;
  if (reviewParams?.id || location === "/teacher/assignments/confirmation") {
    if (!isTeacherAccount) return <div className="auth-screen"><section className="setup-card"><h1>Teacher access required</h1><p>This workflow is available only in the authorised Teacher Dashboard.</p><button className="primary-cta" onClick={() => setLocation("/")}>Return to my reading space</button></section></div>;
    return <div className="rl-app teacher-workflow-app"><header className="top-bar"><button className="brand" onClick={() => setLocation("/")} aria-label="Reader Leader home"><span className="brand-mark"><span /></span> Reader Leader</button><div className="account-pill"><span><strong>{user?.name || "Teacher"}</strong><small>Teacher Dashboard</small></span><button onClick={() => void logout()} aria-label="Sign out"><LogOut size={16} /></button></div></header>{reviewParams?.id ? <MaterialReviewScreen materialId={Number(reviewParams.id)} /> : <AssignmentConfirmationScreen />}</div>;
  }

  const displayName = childProfile?.displayName ?? user?.name ?? "Reader";
  const navItem = (target: View, label: string, Icon: typeof BookOpen) => <button className={`nav-link pressable ${view === target ? "active" : ""}`} onClick={() => chooseView(target)} key={target}><Icon size={17} strokeWidth={2.3} /> {label}</button>;
  const parentContext = view === "parent" && isParentAccount;
  const accountLabel = parentContext ? "Parent Dashboard" : accountRole === "admin" ? "Administrator access" : accountRole === "teacher" ? "Teacher Dashboard" : accountRole === "parent" ? "Parent Dashboard" : "Child Account";
  const assignedStories: Story[] = (assignedMaterials.data ?? []).map((material, index) => ({ id: `material-${material.id}`, materialId: material.id, title: material.title, level: material.readingLevel, focus: material.exerciseSet?.activity || "Teacher-selected reading practice", duration: "Teacher assignment", description: "A new reading passage assigned by your teacher.", text: material.sourceText, art: "lantern", color: "#fde7c9", accent: "#c2761f" }));
  const kidsMode = accountRole === "child" && (view === "reading" || view === "report" || view === "quiz");
  const surfaceClass = accountRole === "child" ? "student-app" : parentContext ? "parent-app" : isTeacherAccount ? "teacher-app" : "";
  return <div className={`rl-app ${surfaceClass} view-${view} ${kidsMode ? "kids-mode-app" : ""}`}><header className="top-bar"><button className="brand pressable" onClick={() => setView(isTeacherAccount && !parentContext ? "teacher" : isParentAccount ? "parent" : "library")} aria-label="Reader Leader home"><span className="brand-mark"><span /></span> Reader Leader</button><div className="account-pill"><span><strong>{parentContext ? "Family Reading Space" : accountRole === "admin" ? "Reader Leader Admin" : user?.name || displayName}</strong><small>{accountLabel}</small></span><button className="pressable" onClick={() => void logout()} aria-label="Sign out"><LogOut size={16} /></button></div></header><div className="layout"><aside className={`side-nav ${parentContext ? "family-nav" : isTeacherAccount ? "teacher-nav" : "child-nav"}`}><div className="nav-intro">{parentContext ? "FAMILY · READING TOGETHER" : accountRole === "admin" ? "ADMINISTRATOR · ALL RECORDS" : `${displayName.toUpperCase()} · ${childProfile?.bookBand || "READ, GROW, LEAD"}`}<br />Reader Leader</div><nav className="nav-links">{accountRole === "admin" && !parentContext && navItem("library", "Reading Library", BookOpen)}{!isTeacherAccount && !isParentAccount && navItem("library", "Reading Library", BookOpen)}{!isTeacherAccount && !isParentAccount && navItem("reading", "Read with Reader Leader", Mic)}{isTeacherAccount && !parentContext && navItem("teacher", "Teacher Dashboard", UsersRound)}{isParentAccount && <><>{navItem("parent", "Parent Dashboard", HomeIcon)}</><button className="nav-link workspace-link pressable" onClick={() => switchWorkspace("child")}><BookOpen size={17} strokeWidth={2.3} /> Reading Library<small>Child sign-in</small></button><button className="nav-link workspace-link pressable" onClick={() => switchWorkspace("teacher")}><UsersRound size={17} strokeWidth={2.3} /> Teacher Dashboard<small>Teacher sign-in</small></button></>}</nav><div className="side-note"><strong>Today’s mission</strong>{parentContext ? "Ask about one part of the story." : isTeacherAccount ? "Review one reading moment with curiosity." : "Read one small page with a brave voice."}</div></aside><main className="page"><i className="bauhaus shape-circle" /><i className="bauhaus shape-square" /><i className="bauhaus shape-triangle" />{view === "library" && <LibraryView name={childProfile?.displayName ?? "Amina"} profile={childProfile} progress={childProgress.data?.summary} minutesRead={childProgress.data?.minutesReadThisWeek} quizHistory={childProgress.data?.quizHistory || []} latestSessionId={childProgress.data?.sessions?.[0]?.id} assignedStories={assignedStories} joinClass={code => joinClass.mutate({ classCode: code })} joining={joinClass.isPending} chooseStory={chooseStory} />}{view === "reading" && <ReadingView story={selectedStory} storyWords={selectedStoryWords} processedWords={processedWords} state={readingState} recognitionStatus={recognitionStatus} connectionStatus={connectionStatus} transcript={liveTranscript} isProcessing={processRecording.isPending || processAndSave.isPending} coachMoment={coachMoment} assessmentMode={assessmentMode} wordStates={wordStates} positionIndex={positionIndex} hesitationHint={hesitationHint} micTrouble={micTrouble} speechMode={speechMode} onModeChange={selectAssessmentMode} onWordAttempt={recordWordAttempt} onMoveOn={moveOnFromTrickyWord} onRestartMic={() => { recognitionFailuresRef.current = 0; notListeningSinceRef.current = null; setRecognitionError(null); setMicTrouble(false); beginRecognition(); }} recognitionError={recognitionError} onBack={() => { restartReading(); setView("library"); }} onStart={startReading} onPauseResume={pauseOrResume} onRestart={restartReading} onComplete={completeReading} onGuidedComplete={completeGuidedSession} onCoach={setCoachMoment} />}{view === "report" && report && <ReportView story={selectedStory} report={report} coachMoment={coachMoment} sessionId={savedSessionId} childProfileId={childProfile?.id} saveOutcome={saveOutcome} retrying={saveSession.isPending} onRetrySave={lastAttemptRef.current ? () => lastAttemptRef.current?.() : undefined} onQuiz={() => setView("quiz")} onReadAgain={() => chooseStory(selectedStory)} onLibrary={() => setView("library")} />}{view === "quiz" && childProfile?.id && selectedStory.materialId && <QuizView childProfileId={childProfile.id} materialId={selectedStory.materialId} onDone={() => setView("library")} />}{view === "teacher" && <TeacherDashboard data={teacherDashboard.data} loading={teacherDashboard.isLoading} />}{view === "parent" && <ParentDashboard data={parentDashboard.data} loading={parentDashboard.isLoading} onReadTogether={() => switchWorkspace("child")} />}</main></div>{warmUpStory && <VocabularySoundWarmUp story={warmUpStory} onClose={() => setWarmUpStory(null)} onBegin={() => { launchStory(warmUpStory); setWarmUpStory(null); }} />}</div>;
}

function LoginLanding() {
  const selectAccount = (role: "child" | "teacher" | "parent") => { localStorage.setItem("reader-leader-intended-role", role); startLogin(); };
  return <div className="auth-screen"><i className="bauhaus shape-circle" /><i className="bauhaus shape-square" /><section className="login-panel"><button className="brand" aria-label="Reader Leader"><span className="brand-mark"><span /></span> Reader Leader</button><div className="kicker">AI reading coach</div><h1 className="login-title">Read with<br /><span>courage.</span></h1><p>Choose the account that fits you. Reader Leader keeps each child’s progress, classroom information, and family insights in the right place.</p><div className="auth-grid"><button className="auth-card child" onClick={() => selectAccount("child")}><Mic size={28} /><strong>Child</strong><span>Read stories, get kind coaching, and see your progress.</span><em>Sign in as a child <ChevronRight size={16} /></em></button><button className="auth-card teacher" onClick={() => selectAccount("teacher")}><UsersRound size={28} /><strong>Teacher</strong><span>Review class reading, create material, and assign activities.</span><em>Sign in as a teacher <ChevronRight size={16} /></em></button><button className="auth-card parent" onClick={() => selectAccount("parent")}><HomeIcon size={28} /><strong>Parent</strong><span>Celebrate progress and plan a small reading moment together.</span><em>Sign in as a parent <ChevronRight size={16} /></em></button></div><p className="auth-foot"><ShieldCheck size={15} /> Sign-in uses a protected account. Select a role once, then connect family or class records safely.</p></section></div>;
}

function AccountSetup({ onDone }: { onDone: () => Promise<void> }) {
  const intended = typeof window === "undefined" ? "child" : localStorage.getItem("reader-leader-intended-role") || "child";
  const [value, setValue] = useState(""); const [working, setWorking] = useState(false);
  const child = trpc.readerLeader.account.setupChild.useMutation(); const teacher = trpc.readerLeader.account.setupTeacher.useMutation(); const parent = trpc.readerLeader.account.linkParent.useMutation();
  const config = intended === "teacher" ? { heading: "Set up your Teacher Dashboard", label: "Class name", placeholder: "e.g. Ms Kelly’s Class", action: "Create my class" } : intended === "parent" ? { heading: "Connect your family record", label: "Child family code", placeholder: "e.g. FAMILY-AB12CD", action: "Connect my child" } : { heading: "Make your reading profile", label: "Your first name", placeholder: "e.g. Amina", action: "Start my Reading Journey" };
  const submit = async () => { if (!value.trim()) return toast(`Add ${config.label.toLowerCase()} to continue.`); setWorking(true); try { if (intended === "teacher") await teacher.mutateAsync({ className: value }); else if (intended === "parent") await parent.mutateAsync({ familyCode: value }); else await child.mutateAsync({ displayName: value }); await onDone(); } catch (error) { toast(error instanceof Error ? error.message : "We could not finish your account setup."); setWorking(false); } };
  return <div className="auth-screen"><section className={`setup-card setup-card--${intended}`}><button className="brand pressable" aria-label="Reader Leader"><span className="brand-mark"><span /></span> Reader Leader</button><div className="kicker">Protected account setup</div><h1>{config.heading}</h1><p>One small step now creates the right reading space for this account. You can keep a family code or class code to link authorised records later.</p><label>{config.label}<input value={value} placeholder={config.placeholder} onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void submit(); }} /></label><button className="primary-cta pressable" disabled={working} onClick={() => void submit()}>{working ? "Setting up…" : config.action} <ChevronRight size={18} /></button></section></div>;
}

function LibraryView({ name, profile, progress, minutesRead, quizHistory, latestSessionId, assignedStories, joinClass, joining, chooseStory }: { name: string; profile: any; progress?: { sessionsCompleted: number; averageWcpm: number | null; readingsWithSettledPace: number }; minutesRead?: number; quizHistory: any[]; latestSessionId?: string; assignedStories: Story[]; joinClass: (code: string) => void; joining: boolean; chooseStory: (story: Story) => void }) {
  // These were `: 91` and `: 108` - a story match and a reading speed invented for a child with
  // no saved readings at all. A child who has not read yet is told she has not read yet.
  const sessionsCompleted = progress?.sessionsCompleted ?? 0;
  const minutes = minutesRead ?? 0;
  const libraryStories = [...assignedStories, ...stories];
  const [classCode, setClassCode] = useState("");
  return <div className="view-wrap student-library"><section className="hero-grid student-library-hero"><div><div className="kicker">{name}’s Reading Progress</div><h1 className="title">Choose your<br /><span className="marker">next story.</span></h1><p className="subtitle">Pick a story, read it in your own voice, and find one small thing to grow today. There is no rush—strong readers keep going.</p><div className="library-actions"><button className="primary-cta pressable" onClick={() => chooseStory(libraryStories[0] || stories[0])}><Mic size={18} /> Start today’s read</button><button className="secondary-cta pressable" onClick={() => playSpeech((libraryStories[0] || stories[0]).text)}><Headphones size={18} /> Hear a model</button></div></div><aside className="progress-card"><span className="eyebrow">Your reading progress</span><div className="progress-big"><strong>{sessionsCompleted}</strong><span>{sessionsCompleted === 1 ? "story read" : "stories read"}</span></div><div className="progress-stats"><span><b>{minutes}</b> minutes this week</span></div><p><Flame size={15} fill="currentColor" /> {ACCURACY_WITHHELD_NOTE}</p></aside></section>{profile && <section className="connection-card"><div><div className="kicker">Your connections</div><strong>Family code: <b>{profile.familyCode}</b></strong><p>Share this code with your parent. They can connect their own protected account to celebrate your reading progress.</p></div><form onSubmit={event => { event.preventDefault(); if (classCode.trim()) joinClass(classCode.trim()); }}><label>Class code<input value={classCode} onChange={event => setClassCode(event.target.value.toUpperCase())} placeholder="CLASS-AB12CD" /></label><button className="compact-action pressable" disabled={joining} type="submit">{joining ? "Connecting…" : "Join my class"}</button></form></section>}{profile && latestSessionId && <section className="child-report-card"><div><div className="kicker">My reading celebration</div><strong>Bring your reading wins home.</strong><p>Download a bright summary of your latest saved session to share with a grown-up.</p></div><ReportDownloadButton childProfileId={profile.id} audience="child" label="Download my PDF" /></section>}<section><div className="section-heading"><h2>{assignedStories.length ? "Your teacher assigned" : "Pick your next story"}</h2><p>Levels are friendly guides, not tests.</p></div><div className="story-grid">{libraryStories.map(story => <article className="story-card pressable" key={story.id}><StoryArt story={story} /><div className="story-meta"><span className="level-pill" style={{ "--pill": story.color } as React.CSSProperties}>{story.level}</span><span>{story.duration}</span></div><h3>{story.title}</h3><p>{story.description}</p><button className="compact-action pressable" onClick={() => chooseStory(story)}>Open story <ChevronRight size={15} /></button></article>)}</div></section>{quizHistory.length > 0 && <section className="quiz-history"><div><div className="kicker">My quiz progress</div><h2>Every try helps your brain grow.</h2></div><div className="history-row">{quizHistory.slice(0, 4).map((attempt, index) => <span key={attempt.id}><b>{attempt.score}/{attempt.totalQuestions}</b><small>Attempt {quizHistory.length - index}</small></span>)}</div></section>}<section className="progress-strip"><div className="progress-copy"><h3>Your next<br />small step.</h3><p>Open your latest story again and read one sentence you enjoyed with a smooth, steady voice.</p><button className="compact-action pressable" style={{ marginTop: 12 }} onClick={() => chooseStory(libraryStories[0] || stories[0])}>Practise now <ChevronRight size={15} /></button></div><div className="achievement-row cognitive-pillars"><div className="achievement"><span className="achievement-icon"><Award size={20} /></span>Memory</div><div className="achievement"><span className="achievement-icon"><Sparkles size={20} /></span>Attention</div><div className="achievement"><span className="achievement-icon"><Gauge size={20} /></span>Processing Speed</div><div className="achievement"><span className="achievement-icon"><Volume2 size={20} /></span>Phonics / Sequencing</div></div></section></div>;
}

/**
 * The story illustrations.
 *
 * Imported as files rather than written into the source as data URIs. The build E was shown
 * carried them inline, and the one she opened in DevTools was a WebP header followed by a long
 * run of zero bytes - a picture truncated into something that decodes to nothing, which is why
 * the cards sometimes showed art and sometimes did not. Imported this way, Vite emits each file
 * with a content hash and bakes the URL into the bundle, so a missing or corrupt file fails the
 * build rather than the child's screen.
 */
const storyArtwork: Record<Story["art"], { src: string; alt: string }> = {
  kite: { src: kiteArtwork, alt: "A child in a yellow coat running with a red kite under a crescent moon." },
  lantern: { src: lanternArtwork, alt: "A glowing lantern among leaves, with a hedgehog peeping out and fireflies around it." },
  plant: { src: plantArtwork, alt: "A child in a straw hat kneeling to plant a green seedling, with a watering can and a worm." },
  robot: { src: robotArtwork, alt: "A child and a small robot sharing an umbrella and splashing in the rain." },
};

function StoryArt({ story }: { story: Story }) {
  // The drawn shapes are the fallback and only the fallback. They are not painted behind the
  // picture, because a sun and a hill showing through a finished illustration looks like a
  // rendering fault rather than a design. They appear when, and only when, the picture does
  // not load, so the card is never an empty box or a broken-image icon.
  const [artworkFailed, setArtworkFailed] = useState(false);
  const artwork = storyArtwork[story.art];
  return <div className="story-art" style={{ "--art-bg": story.color, "--art-accent": story.accent } as React.CSSProperties}>
    {artworkFailed ? <>
      <span className="sun" /><span className="hill" />
      {story.art === "kite" && <span className="kite" />}
      {story.art === "plant" && <span className="plant" />}
      {story.art === "robot" && <span className="robot" />}
      {story.art === "lantern" && <span className="lantern" />}
    </> : <img className="story-artwork" src={artwork.src} alt={artwork.alt} loading="lazy" decoding="async" onError={() => setArtworkFailed(true)} />}
  </div>;
}

function VocabularySoundWarmUp({ story, onClose, onBegin }: { story: Story; onClose: () => void; onBegin: () => void }) {
  const focusWords = words(story.text).filter((word, index, all) => word.length >= 6 && all.findIndex(item => item.toLowerCase() === word.toLowerCase()) === index).slice(0, 3);
  const soundTip = story.id === "seed" ? "Listen for vowel teams that work together in a word." : story.id === "robot" ? "Use punctuation as a clue for when your voice can pause." : "Look for gentle letter sounds and smooth word endings.";
  return <div className="warmup-backdrop" role="presentation"><section className="warmup-modal" role="dialog" aria-modal="true" aria-labelledby="warmup-title"><button type="button" className="warmup-close" onClick={onClose} aria-label="Close vocabulary and sound warm-up"><X size={18} /></button><div className="kicker">Before you begin</div><h1 id="warmup-title">Vocabulary &amp; Sound Warm-Up</h1><p>Meet a few story words first. These are friendly clues, not a test—listen, notice, and have a go.</p><div className="warmup-word-grid">{focusWords.map((word, index) => <article key={word}><span>{index + 1}</span><b>{word}</b><button type="button" onClick={() => playSpeech(word)}><Volume2 size={15} /> Hear word</button></article>)}</div><div className="sound-warmup-tip"><Sparkles size={18} /><div><b>Sound focus</b><p>{soundTip}</p></div></div><div className="warmup-actions"><button type="button" className="secondary-cta" onClick={onClose}>Not now</button><button type="button" className="primary-cta" onClick={onBegin}><Mic size={17} /> Start guided reading</button></div></section></div>;
}

function ReadingView({ story, storyWords, processedWords, state, recognitionStatus, transcript, isProcessing, assessmentMode, wordStates, positionIndex, hesitationHint, micTrouble, speechMode, recognitionError, onRestartMic, onMoveOn, onBack, onStart, onPauseResume, onComplete }: { story: Story; storyWords: string[]; processedWords: number; state: ReadingState; recognitionStatus: RecognitionStatus; connectionStatus: ConnectionStatus; transcript: string; isProcessing: boolean; coachMoment: CoachMoment; assessmentMode: AssessmentMode; wordStates: WordState[]; positionIndex: number; hesitationHint: boolean; micTrouble: boolean; speechMode: SpeechMode; recognitionError: string | null; onRestartMic: () => void; onModeChange: (mode: AssessmentMode) => void; onWordAttempt: (correct: boolean) => void; onMoveOn: () => void; onBack: () => void; onStart: () => void; onPauseResume: () => void; onRestart: () => void; onComplete: () => void; onGuidedComplete: () => void; onCoach: (moment: CoachMoment) => void }) {
  const microphoneUnavailable = recognitionStatus === "unavailable";
  const isListening = state === "listening" && !microphoneUnavailable; const isPaused = state === "paused";
  const [isModelSpeaking, setIsModelSpeaking] = useState(false);
  const [speakingWordId, setSpeakingWordId] = useState<string | null>(null);
  const pages = useMemo(() => createReadingPages(story.text, 16), [story.text]);
  const [pageIndex, setPageIndex] = useState(0);
  const activePage = pages[pageIndex] ?? pages[0];
  useEffect(() => { setPageIndex(0); }, [story.id]);
  useEffect(() => { if (!transcript.trim()) setPageIndex(0); }, [transcript]);
  useEffect(() => {
    if (pageIndex >= pages.length - 1 || !isReadingPageComplete(activePage, wordStates, assessmentMode)) return;
    setPageIndex(current => Math.min(current + 1, pages.length - 1));
  }, [activePage, assessmentMode, pageIndex, pages.length, wordStates]);
  // The page follows the reader, not only the recogniser. Position runs ahead of the finals,
  // so a page that turned only on judgement left a child who was ahead looking at a page with
  // no cursor on it - or, when the cursor was clamped into the page to compensate, parked on
  // its last word. Forward only: a page never turns back.
  useEffect(() => {
    if (positionIndex <= activePage.endWordIndex) return;
    // Seek to the page holding the cursor, once. Advancing one page per run re-fired on the
    // new page and walked through the rest of the story, so a single bad cursor value showed
    // up as a sprint to the end rather than as being one page out. Forward only.
    const target = pages.findIndex(page => positionIndex <= page.endWordIndex);
    if (target === -1) return;
    setPageIndex(current => Math.max(current, target));
  }, [activePage.endWordIndex, pages, positionIndex]);
  // Scoped to the page on screen. Searching the whole passage kept pointing the retry
  // prompt at a word from a page the reader had already left behind.
  const pageWordStates = wordStates.slice(activePage.startWordIndex, activePage.endWordIndex + 1);
  const currentWord = activeRetryWord(pageWordStates, assessmentMode);
  const needsGentleRetry = assessmentMode !== "MONTHLY_ASSESSMENT" && currentWord?.status === "incorrect";
  // Offered as soon as a word is flagged, not after three tries. The speech recogniser
  // mishears a word on the first attempt, and until this appeared there was nothing on the
  // screen that let the child continue: the page will not advance past a flagged word, so a
  // misheard reader was simply stuck. The child most likely to be misheard is the one this
  // product exists for, which makes waiting for a third attempt the wrong default.
  const showMoveOn = assessmentMode !== "MONTHLY_ASSESSMENT" && currentWord?.status === "incorrect";
  const showWordHint = assessmentMode !== "MONTHLY_ASSESSMENT" && currentWord?.status === "incorrect";
  const progress = Math.min(100, Math.round((processedWords / Math.max(storyWords.length, 1)) * 100));
  const hearModel = (text: string, wordId?: string) => {
    if (state === "listening") onPauseResume();
    setIsModelSpeaking(true);
    setSpeakingWordId(wordId ?? null);
    if (!playSpeech(text, undefined, () => { setIsModelSpeaking(false); setSpeakingWordId(null); })) { setIsModelSpeaking(false); setSpeakingWordId(null); }
  };
  return <div className="kids-reading-shell"><header className="kids-reading-head"><button type="button" className="back-link" onClick={onBack}><ArrowLeft size={17} /> Back to Reading Library</button><div><h1 className="story-label">{story.title}</h1><p>Page {pageIndex + 1} of {pages.length}</p></div><div className="kids-progress" aria-label={`${progress}% through the story`}><i style={{ width: `${progress}%` }} /></div></header><section className="kids-reader-stage"><div className="reader-text kids-reader-text" aria-label={`Reading passage page ${pageIndex + 1}`}>{activePage.tokens.map((word, pageOffset) => { const index = activePage.startWordIndex + pageOffset; const wordState = wordStates[index]; const stateClass = readerWordClass(wordState?.status, index === positionIndex && isListening, assessmentMode); const isHintWord = showWordHint && wordState?.id === currentWord?.id; const isPostReadingMiss = assessmentMode !== "MONTHLY_ASSESSMENT" && wordState?.status === "incorrect" && !isListening; const isTappableModelWord = isPostReadingMiss || isHintWord; const wordContent = <>{word}{wordState?.status === "retried_correct" && assessmentMode !== "MONTHLY_ASSESSMENT" ? <i className="retry-check" aria-label="Self-corrected"><Check size={11} /></i> : null}{isHintWord ? <span className="word-help-tooltip">Tap this word to hear it <Volume2 size={13} /></span> : null}</>; return isTappableModelWord && wordState ? <button type="button" className={`reader-word ${stateClass} missed-word ${speakingWordId === wordState.id ? "speaking" : ""}`} key={`${word}-${index}`} onClick={() => hearModel(word.replace(/[^a-zA-Z']/g, ""), wordState.id)} aria-label={`Hear how to say ${word.replace(/[^a-zA-Z']/g, "")}`}>{wordContent}</button> : <span className={`reader-word ${stateClass} ${isHintWord ? "needs-help" : ""}`} key={`${word}-${index}`}>{wordContent}</span>; })}</div><p className={`speech-mode-note ${sendsVoiceOffDevice(speechMode) ? "off-device" : ""}`} data-testid="speech-mode-note">{speechModeNotice(speechMode)}</p>{hesitationHint && assessmentMode !== "MONTHLY_ASSESSMENT" && <div className="kids-gentle-pause">A small pause is okay. Take a breath and keep going.</div>}{isListening && micTrouble && <div className="kids-mic-warning" role="status" data-testid="mic-warning"><span>The microphone stopped hearing you. Reader Leader is trying to switch it back on.</span><button type="button" onClick={onRestartMic}><Mic size={15} /> Turn it back on</button>{recognitionError ? <small>The browser said: {recognitionError}</small> : null}</div>}</section><div className="kids-control-bar"><button type="button" className="hear-page-button" onClick={() => hearModel(activePage.tokens.join(""), "page")} aria-pressed={isModelSpeaking}><Volume2 size={19} /><span>{isModelSpeaking && speakingWordId === "page" ? "Reading aloud…" : "Hear page"}</span></button>{state === "ready" ? <button type="button" className="kids-mic-button" onClick={onStart}><Mic size={31} /><span>Tap to Read</span></button> : <button type="button" className={`kids-mic-button ${isListening ? "listening" : ""}`} onClick={onPauseResume}>{isListening ? <><Pause size={29} fill="currentColor" /><span>Pause</span></> : <><Play size={29} fill="currentColor" /><span>Keep reading</span></>}</button>}{pageIndex < pages.length - 1 ? <button type="button" className="next-page-button" onClick={() => setPageIndex(index => Math.min(index + 1, pages.length - 1))}>Next page <ChevronRight size={17} /></button> : null}<button type="button" className="finish-button kids-finish-button" onClick={onComplete} disabled={isProcessing}>{isProcessing ? "Getting report…" : "Finish story"}</button></div>{showMoveOn && <div className="kids-move-on-card" role="status"><b>That word can wait for later.</b><span>We will save it for a short word activity after your story.</span><button type="button" onClick={onMoveOn}>Need help—move on <ChevronRight size={16} /></button></div>}<span className="sr-only" role="status" aria-live="polite">{recognitionStatus === "unavailable" ? "Guided reading is ready." : isListening ? "Listening." : state === "processing" ? "Preparing your reading report." : `Page ${pageIndex + 1} ready to read.`}</span></div>;
}

function ReportView({ story, report, sessionId, hasRecording = Boolean(report.hasRecording ?? (sessionId && report.transcriptionStatus === "transcribed")), childProfileId, saveOutcome, retrying, onRetrySave, onQuiz, onReadAgain, onLibrary }: { story: Story; report: Report; coachMoment: CoachMoment; sessionId: string | null; hasRecording?: boolean; childProfileId?: number; saveOutcome: SaveOutcome; retrying: boolean; onRetrySave?: () => void; onQuiz: () => void; onReadAgain: () => void; onLibrary: () => void }) {
  const monthly = report.mode === "MONTHLY_ASSESSMENT";
  const hasRetries = report.retrySummary.length > 0;
  // The heading used to turn on accuracy >= 60, which made it a pass mark in words. What is
  // left turns on whether the software heard anything at all - which it does know.
  const reportHeading = report.correctWords > 0 ? "You finished your reading" : "Let\u2019s try that one again";
  const saved = isSaved(saveOutcome);
  // A reading nothing was heard in is not a poor reading. Say which one happened.
  const capture = readingCapture(report.correctWords, report.transcript.trim() ? report.transcript.trim().split(/\s+/).length : 0);
  const captureMessage = readingCaptureMessage(capture);
  return <div className="report-wrap"><section className="report-hero"><div className="report-burst"><div className="star-badge"><Star size={44} fill="#f4c746" /></div><h1>{monthly ? "Monthly reading check complete" : "That was a brave read!"}</h1></div><div className="report-main"><div className="kicker">{monthly ? "Monthly Assessment" : "Reading Report"} · {story.title}</div><h2>{captureMessage ? "Let\u2019s try that one again" : monthly ? "You finished your monthly reading check." : reportHeading}</h2><p>{captureMessage ?? report.childMessage}</p><div className="report-actions">{monthly ? <button className="primary-cta" onClick={onLibrary}><BookOpen size={17} /> Back to Reading Library</button> : <button className="primary-cta" onClick={onReadAgain}><RotateCcw size={17} /> Read it again</button>}<button className="secondary-cta" onClick={onLibrary}><BookOpen size={17} /> {monthly ? "Choose a story" : "New story"}</button>{story.materialId && <button className="quiz-start" onClick={onQuiz}><Sparkles size={17} /> Quick quiz</button>}</div>{childProfileId && <div className="report-tools"><ReportDownloadButton childProfileId={childProfileId} audience="child" label="Download my celebration" />{sessionId && hasRecording ? <SessionAudioButton sessionId={sessionId} label="Play my recording" /> : <span className="recording-status">No recording was saved for this reading.</span>}</div>}<div className={`save-state save-state-${saveOutcome.status}`} role="status" data-testid="save-state" data-save-status={saveOutcome.status}>{saved ? <Check size={15} /> : saveOutcome.status === "pending" ? <RotateCcw size={15} /> : <AlertCircle size={15} />}<span>{childSaveMessage(saveOutcome)}</span>{saveOutcome.status === "failed" && onRetrySave ? <button type="button" className="save-retry" onClick={onRetrySave} disabled={retrying}>{retrying ? "Trying…" : "Try again"}</button> : null}</div><p className="accuracy-withheld" data-testid="accuracy-withheld">{ACCURACY_WITHHELD_NOTE} {PACE_AWAITS_REVIEW}</p></div></section><section className="report-details">{monthly ? <article className="detail-card monthly-card"><h3>Monthly Assessment</h3><p>This was a first-pass reading check. Reader Leader did not show red words, ask for retries, or interrupt your reading.</p><div className="prototype-note">Your teacher can review any quiet reading notes alongside your work and choose the next best step with you.</div></article> : <><article className="detail-card"><h3>Self-Corrections & Retries</h3>{hasRetries ? <div className="practice-list">{report.retrySummary.map(item => <div className="practice-item" key={item.word}><strong>{item.word}</strong><span>{item.retries} {item.retries === 1 ? "retry" : "retries"}{report.selfCorrections.includes(item.word) ? " · corrected" : ""}</span></div>)}</div> : <p className="calm-note">No extra retries were needed in this session. Keep using the same calm, steady pace.</p>}<div className="prototype-note">{report.nextStep}</div></article></>}<article className="detail-card"><h3>{monthly ? "Teacher review note" : "Listen back"}</h3>{monthly ? <p className="calm-note">Your teacher will use the saved first-pass match and WCPM as one helpful piece of your reading picture.</p> : <><p className="calm-note">Hear your own brave reading, then choose one word activity above.</p>{sessionId && hasRecording ? <SessionAudioButton sessionId={sessionId} label="Listen to my reading" /> : <p className="prototype-note">A recording appears here only when this reading was captured successfully.</p>}</>}<div className="prototype-note">Numbers are practice signals, not a reading diagnosis.</div></article></section></div>;
}

function QuizView({ childProfileId, materialId, onDone }: { childProfileId: number; materialId: number; onDone: () => void }) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [result, setResult] = useState<{ score: number; totalQuestions: number; explanations: { questionIndex: number; explanation: string }[] } | null>(null);
  const quiz = trpc.readerLeader.quizzes.forAssignedMaterial.useQuery({ materialId });
  const submit = trpc.readerLeader.quizzes.submit.useMutation({ onSuccess: data => setResult(data), onError: error => toast(error.message) });
  if (quiz.isLoading) return <div className="quiz-wrap"><div className="quiz-card">Getting your teacher’s quick quiz ready…</div></div>;
  if (!quiz.data) return <div className="quiz-wrap"><div className="quiz-card"><h1>Quiz not ready yet</h1><p>Your teacher may still be reviewing this activity. Choose another story, then come back later.</p><button className="primary-cta" onClick={onDone}>Back to Reading Library</button></div></div>;
  if (result) return <div className="quiz-wrap"><div className="quiz-card quiz-result"><div className="star-badge"><Star size={40} fill="#f4c746" /></div><div className="kicker">Quick quiz complete</div><h1>You got {result.score} of {result.totalQuestions}!</h1><p>{result.score === result.totalQuestions ? "You remembered the important parts of the story. Brilliant thinking!" : "You gave every question a brave try. You can revisit the story ideas and have another go."}</p><div className="quiz-explanations">{result.explanations.map(item => <div key={item.questionIndex}><b>Question {item.questionIndex + 1}</b><span>{item.explanation}</span></div>)}</div><div className="report-actions"><button className="primary-cta" onClick={() => { setAnswers({}); setResult(null); }}><RotateCcw size={17} /> Try again</button><button className="secondary-cta" onClick={onDone}><BookOpen size={18} /> Back to Reading Library</button></div></div></div>;
  const questions = quiz.data.questions;
  const ready = questions.every((_, index) => answers[index]);
  return <div className="quiz-wrap"><div className="quiz-card"><div className="kicker">Teacher-assigned quick quiz</div><h1>{quiz.data.title}</h1><p>{quiz.data.activity}</p><div className="quiz-progress"><i style={{ width: `${Math.round((Object.keys(answers).length / questions.length) * 100)}%` }} /></div>{questions.map((question, index) => <section className="quiz-question" key={question.prompt}><strong>{index + 1}. {question.prompt}</strong><div>{question.options.map(option => <button key={option} className={answers[index] === option ? "selected" : ""} onClick={() => setAnswers(previous => ({ ...previous, [index]: option }))}><span>{answers[index] === option ? <Check size={14} /> : String.fromCharCode(65 + question.options.indexOf(option))}</span>{option}</button>)}</div></section>)}<div className="quiz-footer"><span>{Object.keys(answers).length}/{questions.length} answers chosen</span><button className="primary-cta" disabled={!ready || submit.isPending} onClick={() => submit.mutate({ childProfileId, materialId, answers: questions.map((_, questionIndex) => ({ questionIndex, selectedAnswer: answers[questionIndex] })) })}>{submit.isPending ? "Checking…" : "Finish quiz"} <ChevronRight size={17} /></button></div></div></div>;
}

function TeacherView({ data, loading }: { data: any; loading: boolean }) {
  const utils = trpc.useUtils();
  const seedDemo = trpc.readerLeader.demo.seedCohort.useMutation({ onSuccess: async item => { await utils.readerLeader.dashboards.teacher.invalidate(); toast(`Demo class loaded. Share ${item.readerClass.joinCode} with a child profile to show the full flow.`); } });
  const pupils = data?.pupils?.length ? data.pupils : [{ childProfileId: 0, displayName: "Amina Roe", bookBand: "Gold", accuracy: 91, wcpm: 112, sessionCount: 3 }, { childProfileId: 1, displayName: "Ben O’Neill", bookBand: "Silver", accuracy: 87, wcpm: 96, sessionCount: 2 }, { childProfileId: 2, displayName: "Sara Khan", bookBand: "Bronze", accuracy: 94, wcpm: 118, sessionCount: 4 }];
  const sessions = pupils.reduce((sum: number, pupil: any) => sum + (pupil.sessionCount || 0), 0);
  const averageAccuracy = Math.round(pupils.reduce((sum: number, pupil: any) => sum + (pupil.accuracy || 0), 0) / pupils.length);
  const averageWcpm = Math.round(pupils.reduce((sum: number, pupil: any) => sum + (pupil.wcpm || 0), 0) / pupils.length);
  const review = data?.needsReview || [];
  return <div className="view-wrap"><section className="dashboard-head"><div><div className="kicker">Teacher Dashboard</div><h1 className="dashboard-title">Notice the<br /><span className="marker">reader.</span></h1><p className="dashboard-subtitle">Reading information is a conversation starter—not an automatic verdict. Review low-confidence moments with the child, their work, and your professional judgement.</p></div><span className="view-chip">{loading ? "Loading records" : data?.classes?.[0]?.name || "My Class"}</span></section>{data?.classes?.[0]?.joinCode ? <div className="teacher-code"><b>Class code</b><span>{data.classes[0].joinCode}</span><p>Share it with a child after they create their Reading Profile. Their family code appears in their Reading Library.</p></div> : <ClassCreator />}<button className="demo-seed" onClick={() => seedDemo.mutate()} disabled={seedDemo.isPending}><Sparkles size={15} /> {seedDemo.isPending ? "Loading cohort…" : "Load guided demo cohort"}</button><section className="stat-grid"><Stat value={pupils.length} label="pupils in class" color="#f4c746" icon={<UsersRound size={21} />} /><Stat value={`${averageAccuracy}%`} label="average accuracy" color="#dfe7ff" icon={<BookOpen size={21} />} /><Stat value={averageWcpm} label="average WCPM" color="#d9f0e5" icon={<Flame size={21} />} /><Stat value={review.length || 3} label="moments to review" color="#ffdcd4" icon={<Sparkles size={21} />} /></section><section className="dashboard-grid"><article className="dashboard-card"><div className="card-title-row"><h2>Class overview</h2><span>{sessions} sessions this week</span></div><table className="student-table"><thead><tr><th>Student</th><th>Book band</th><th>Accuracy</th><th>WCPM</th></tr></thead><tbody>{pupils.map((student: any) => <tr key={student.childProfileId}><td><span className="student"><i className="student-initial" style={{ "--avatar": student.bookBand === "Gold" ? "#f4c746" : student.bookBand === "Silver" ? "#dfe7ff" : "#ffdcd4" } as React.CSSProperties}>{student.displayName.split(" ").map((word: string) => word[0]).join("")}</i>{student.displayName}</span></td><td><span className="band-pill">{student.bookBand}</span></td><td>{student.accuracy || "—"}%</td><td>{student.wcpm || "—"}</td></tr>)}</tbody></table></article><article className="dashboard-card"><div className="card-title-row"><h2>Review gently</h2><span>{review.length} live flags</span></div><div className="review-list">{review.length ? review.map((item: any, index: number) => <div className="review-event" key={`${item.sessionId}-${index}`}><div className="review-name"><span>{item.storyTitle}</span><span>Saved session</span></div><p>{item.note}</p><button onClick={() => toast("Marked for your next reading conversation.")}>Review with pupil</button></div>) : <div className="empty-card">No new low-confidence moments. The sample below shows how a stay-silent flag will appear after a child session.</div>}</div></article></section>{data?.recentSessions?.length > 0 && <section className="session-review"><div className="card-title-row"><h2>Saved reading sessions</h2><span>Authorised recordings only</span></div>{data.recentSessions.map((session: any) => <div className="session-row feedback-row" key={session.id}><div><b>{session.childName} · {session.storyTitle}</b><span>{session.accuracy}% match* · {session.wordsCorrectPerMinute} WCPM*</span></div><div><SessionAudioButton sessionId={session.audioStorageKey ? session.id : null} label="Listen" /><ReportDownloadButton childProfileId={session.childProfileId} audience="teacher" label="PDF running record" /><SessionFeedback sessionId={session.id} initialComments={session.comments || []} /></div></div>)}</section>}<BrandingEditor branding={data?.branding} /><MaterialLab materials={data?.materials || []} /></div>;
}

function SessionFeedback({ sessionId, initialComments }: { sessionId: string; initialComments: any[] }) {
  const utils = trpc.useUtils(); const [comment, setComment] = useState("");
  const add = trpc.readerLeader.sessions.addComment.useMutation({ onSuccess: async () => { setComment(""); await utils.readerLeader.dashboards.teacher.invalidate(); toast("Teacher feedback saved to this session report."); }, onError: error => toast(error.message) });
  return <div className="feedback-box">{initialComments.slice(0, 1).map(item => <p key={item.id}><b>Latest note:</b> {item.comment}</p>)}<div><input value={comment} onChange={event => setComment(event.target.value)} placeholder="Leave kind, specific feedback…" /><button onClick={() => comment.trim() && add.mutate({ sessionId, comment })} disabled={add.isPending}>{add.isPending ? "Saving…" : "Add feedback"}</button></div></div>;
}

function BrandingEditor({ branding }: { branding?: { schoolName: string; accentColor: string; footerLine: string } }) {
  const utils = trpc.useUtils(); const [schoolName, setSchoolName] = useState(branding?.schoolName || "Reader Leader School"); const [accentColor, setAccentColor] = useState(branding?.accentColor || "#2563EB"); const [footerLine, setFooterLine] = useState(branding?.footerLine || "Every reader can grow with practice and encouragement.");
  const save = trpc.readerLeader.branding.save.useMutation({ onSuccess: async () => { await utils.readerLeader.dashboards.teacher.invalidate(); toast("School branding saved for future PDF reports."); }, onError: error => toast(error.message) });
  return <section className="branding-editor"><div><div className="kicker">School branding</div><h2>Make every PDF feel like your school.</h2><p>Set a school name, report accent, and supportive footer. These appear on child celebration, parent summary, and teacher running-record PDFs.</p></div><div className="branding-fields"><label>School name<input value={schoolName} onChange={event => setSchoolName(event.target.value)} /></label><label>Accent colour<input type="color" value={accentColor} onChange={event => setAccentColor(event.target.value)} /></label><label>Footer message<input value={footerLine} onChange={event => setFooterLine(event.target.value)} /></label><button className="primary-cta" onClick={() => save.mutate({ schoolName, accentColor, footerLine })} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save PDF branding"}</button></div></section>;
}
function ClassCreator() {
  const utils = trpc.useUtils(); const [className, setClassName] = useState(""); const setup = trpc.readerLeader.account.setupTeacher.useMutation({ onSuccess: async data => { await utils.readerLeader.dashboards.teacher.invalidate(); toast(`${data.readerClass.name} is ready. Your class code is ${data.joinCode}.`); } });
  return <form className="teacher-code class-creator" onSubmit={event => { event.preventDefault(); if (className.trim().length < 2) return toast("Add a class name to continue."); setup.mutate({ className }); }}><div><b>Create your first class</b><p>Create a class to receive a shareable code and assign approved activities to enrolled child profiles.</p></div><input value={className} onChange={event => setClassName(event.target.value)} placeholder="e.g. Ms Kelly’s Class" /><button className="compact-action" type="submit" disabled={setup.isPending}>{setup.isPending ? "Creating…" : "Create class"}</button></form>;
}
function Stat({ value, label, color, icon }: { value: string | number; label: string; color: string; icon: React.ReactNode }) { return <div className="stat-card" style={{ "--card": color } as React.CSSProperties}><div className="stat-icon">{icon}</div><strong>{value}</strong><span>{label}</span></div>; }

function MaterialLab({ materials }: { materials: any[] }) {
  const utils = trpc.useUtils(); const [title, setTitle] = useState(""); const [level, setLevel] = useState("Level 3 · Sky Blue"); const [author, setAuthor] = useState(""); const [rightsSource, setRightsSource] = useState<MaterialRightsSource>("original"); const [interestAge, setInterestAge] = useState(""); const [genre, setGenre] = useState(""); const [text, setText] = useState(""); const [filename, setFilename] = useState(""); const [fileBase64, setFileBase64] = useState<string | undefined>(); const [fileMime, setFileMime] = useState("text/plain"); const [storageKey, setStorageKey] = useState<string | undefined>(); const [extractionNotice, setExtractionNotice] = useState(""); const [exercise, setExercise] = useState<any>(null); const [materialId, setMaterialId] = useState<number | null>(null);
  const create = trpc.readerLeader.materials.create.useMutation({ onSuccess: async data => { setMaterialId(data.id); await utils.readerLeader.materials.listMine.invalidate(); await utils.readerLeader.dashboards.teacher.invalidate(); toast("Reading material saved. Now create activities for your review."); } });
  const generate = trpc.readerLeader.materials.generateExercises.useMutation({ onSuccess: data => { setExercise(data.exercise.exerciseSet); setMaterialId(data.material.id); toast("AI activities are ready for teacher review."); }, onError: error => toast(error.message) });
  const approve = trpc.readerLeader.materials.approve.useMutation({ onSuccess: async () => { await utils.readerLeader.dashboards.teacher.invalidate(); toast("Material and activities approved for assignment."); } });
  const extract = trpc.readerLeader.materials.extractUpload.useMutation({ onSuccess: data => { setText(data.text); setStorageKey(data.storageKey); setFileBase64(undefined); setExtractionNotice(`${data.sourceType.toUpperCase()} text extracted and ready for your review${data.truncated ? " (preview shortened to 8,000 characters)" : ""}.`); toast("Document text extracted. Review it before saving."); }, onError: error => toast(error.message) });
  const loadFile = async (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 5_000_000) return toast("Choose a PDF, DOCX, or text file under 5 MB."); const extension = file.name.toLowerCase().split(".").pop(); if (!(["pdf", "docx", "txt"].includes(extension || ""))) return toast("Use a PDF, DOCX, or plain-text passage."); const buffer = await file.arrayBuffer(); const mime = file.type || (extension === "pdf" ? "application/pdf" : extension === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "text/plain"); setFilename(file.name); setFileMime(mime); setFileBase64(arrayBufferToBase64(buffer)); setStorageKey(undefined); setExtractionNotice("Extracting the passage for your review…"); extract.mutate({ sourceFilename: file.name, sourceFileBase64: arrayBufferToBase64(buffer), sourceFileMime: mime }); };
  const saveMaterial = async () => { if (title.trim().length < 3 || text.trim().length < 80) return toast("Add a title and at least a short reading passage before saving."); if (author.trim().length < 2 || interestAge.trim().length < 2 || genre.trim().length < 2) return toast("Record the author, interest age, genre and rights source before saving."); try { await create.mutateAsync({ title, author: author.trim(), rightsSource, interestAge: interestAge.trim(), genre: genre.trim(), readingLevel: level, sourceText: text, sourceFilename: filename || undefined, sourceFileBase64: storageKey ? undefined : fileBase64, sourceFileMime: fileMime, storageKey }); } catch (error) { toast(error instanceof Error ? error.message : "Could not save this material."); } };
  return <section className="material-lab"><div className="material-head"><div><div className="kicker">Lesson resources</div><h2>Upload material. Create a learning moment.</h2><p>Upload a PDF, DOCX, or text passage. Reader Leader extracts the reading text for your preview, then creates vocabulary and comprehension activities for your review before anything is assigned.</p></div><span className="view-chip">Teacher review required</span></div><div className="material-grid"><div className="material-form"><label>Reading material title<input value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. The Lantern in the Garden" /></label><div className="field-grid"><label>Author<input value={author} onChange={event => setAuthor(event.target.value)} placeholder="e.g. Ms Kelly" /></label><label>Rights / source<select value={rightsSource} onChange={event => setRightsSource(event.target.value as MaterialRightsSource)}><option value="original">Original</option><option value="public_domain">Public domain</option><option value="permission_obtained">Permission obtained</option></select></label></div><div className="field-grid"><label>Interest age<input value={interestAge} onChange={event => setInterestAge(event.target.value)} placeholder="e.g. 8–10" /></label><label>Genre<input value={genre} onChange={event => setGenre(event.target.value)} placeholder="e.g. Adventure" /></label></div><div className="field-grid"><label>Reading level<select value={level} onChange={event => setLevel(event.target.value)}><option>Level 3 · Sky Blue</option><option>Level 4 · Gold</option><option>Level 5 · Green</option></select></label><label className="file-input">Upload source<input type="file" accept=".txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={event => void loadFile(event)} /><span><Upload size={15} /> {filename || "PDF, DOCX, or .txt"}</span></label></div><label>Extracted text preview<textarea value={text} onChange={event => setText(event.target.value)} placeholder="Upload a document or paste a child-appropriate passage here…" rows={7} /></label>{extractionNotice && <p className="extraction-note"><FileText size={14} /> {extractionNotice}</p>}<div className="form-actions"><button className="secondary-cta" onClick={() => void saveMaterial()} disabled={create.isPending || extract.isPending}><FileText size={16} /> {create.isPending ? "Saving…" : "Save material"}</button><button className="primary-cta" onClick={() => materialId ? generate.mutate({ materialId }) : toast("Save the material first, then generate activities.")} disabled={generate.isPending}><WandSparkles size={16} /> {generate.isPending ? "Creating…" : "Generate exercises"}</button></div></div><div className="exercise-preview">{exercise ? <><div className="kicker">AI draft · review before assigning</div><h3>{exercise.activity}</h3><div className="vocabulary-chips">{exercise.vocabulary.map((word: any) => <span key={word.word}><b>{word.word}</b> {word.childFriendlyMeaning}</span>)}</div><div className="question-list">{exercise.questions.map((question: any, index: number) => <div key={question.prompt}><b>{index + 1}. {question.prompt}</b><span>{question.options.join(" · ")}</span></div>)}</div><button className="primary-cta" onClick={() => materialId && approve.mutate({ materialId })} disabled={approve.isPending}><Check size={16} /> {approve.isPending ? "Approving…" : "Approve & assign"}</button></> : <><WandSparkles size={35} /><h3>Activities will appear here.</h3><p>After you save a passage, Reader Leader uses AI to draft age-appropriate vocabulary, comprehension questions, and a short practice activity.</p><small>AI drafts are saved for teacher review and are never automatically assigned.</small></>}</div></div>{materials.length > 0 && <div className="materials-list"><strong>Saved resources</strong>{materials.map(material => <span key={material.id}><FileText size={15} /> {material.title} · {material.readingLevel} · {material.status}</span>)}</div>}</section>;
}

function ParentView({ data, loading, onReadTogether }: { data: any; loading: boolean; onReadTogether: () => void }) { const child = data?.children?.[0]; const summary = child?.summary; const displayName = child?.displayName ?? "Amina"; const latest = child?.sessions?.[0]; return <div className="view-wrap"><section className="dashboard-head"><div><div className="kicker">Parent Dashboard</div><h1 className="dashboard-title">Cheer the<br /><span className="marker">small wins.</span></h1><p className="dashboard-subtitle">You do not need to be a teacher. Your calm encouragement, curiosity, and five focused minutes can help reading feel safe and enjoyable.</p></div><span className="view-chip">{loading ? "Loading progress" : `${displayName}’s reading`}</span></section><section className="stat-grid"><Stat value={summary?.minutesReadThisWeek ?? child?.minutesReadThisWeek ?? 0} label="minutes read this week" color="#f4c746" icon={<BookOpen size={21} />} /><Stat value={typeof summary?.averageWcpm === "number" ? summary.averageWcpm : "\u2014"} label="reading speed · WCPM" color="#dfe7ff" icon={<Flame size={21} />} /><Stat value={summary?.sessionsCompleted || 3} label="Reading Sessions" color="#d9f0e5" icon={<Mic size={21} />} /></section><p className="accuracy-withheld" data-testid="parent-accuracy-withheld">{ACCURACY_WITHHELD_NOTE} {typeof summary?.averageWcpm === "number" ? `Reading speed is counted from the ${summary.readingsWithSettledPace} ${summary.readingsWithSettledPace === 1 ? "reading" : "readings"} the teacher has finished reviewing.` : PACE_AWAITS_REVIEW}</p><section className="dashboard-grid"><article className="dashboard-card"><div className="card-title-row"><h2>{displayName}’s strengths</h2><span>Recent reading</span></div><div className="tip-list"><div className="tip"><span><Check size={13} /></span><div><b>Self-correction</b><br />Trying a word again is a confident reader move.</div></div><div className="tip"><span><Check size={13} /></span><div><b>Word recognition</b><br />{displayName} keeps the story moving with familiar words.</div></div><div className="tip"><span><Check size={13} /></span><div><b>Brave persistence</b><br />Finishing a story builds reading stamina.</div></div></div></article><article className="dashboard-card"><div className="card-title-row"><h2>Practise together</h2><span>5 friendly minutes</span></div><div className="tip-list"><div className="tip"><span>1</span><div>Open <b>The Moonlight Kite</b> and let {displayName} choose a paragraph.</div></div><div className="tip"><span>2</span><div>Listen without correcting. If a word is sticky, wait, then read it together.</div></div><div className="tip"><span>3</span><div>Ask, “Which part painted a picture in your mind?” Then celebrate the answer.</div></div></div><div style={{ padding: "0 20px 21px" }}><button className="primary-cta" onClick={onReadTogether}><Headphones size={18} /> Read together</button></div></article></section>{child?.childProfileId && <div className="role-report-row"><div><b>Share a clear progress summary</b><span>Download a parent-friendly snapshot to discuss with the teacher.</span></div><div><ReportDownloadButton childProfileId={child.childProfileId} audience="parent" label="Download parent summary" />{latest?.audioStorageKey && <SessionAudioButton sessionId={latest.id} label="Play last recording" />}</div></div>}<section className="progress-strip"><div className="progress-copy"><h3>Keep it<br />kind and light.</h3><p>Reading together is about sharing stories, not getting every word perfect.</p></div><div className="achievement-row"><div className="achievement"><span className="achievement-icon"><Trophy size={20} /></span>Brave starter</div><div className="achievement"><span className="achievement-icon"><Star size={20} /></span>Story finisher</div><div className="achievement"><span className="achievement-icon"><Flame size={20} /></span>Four-day streak</div></div></section></div>; }
