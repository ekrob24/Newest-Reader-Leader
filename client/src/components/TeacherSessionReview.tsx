import { SessionAudioButton, SessionTranscriptPlayer } from "@/components/ReadingActions";
import { trpc } from "@/lib/trpc";
import { audioAbsenceSummary, flaggedWordAudioNote, hasStoredAudio } from "@shared/audioRetention";
import type { AudioRetentionStatus } from "@shared/types";
import { ArrowLeft, Check, ClipboardCheck, Headphones, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type ReviewMoment = {
  word: string;
  action: "prompt" | "model" | "stay_silent" | "teacher_review";
  note: string;
  eventType?: string;
  heardWord?: string;
  provisionalIrishEnglish?: boolean;
  teacherDecision?: string;
};

function isAccentVariation(moment: ReviewMoment) {
  return moment.eventType === "dialect_variation" || moment.provisionalIrishEnglish === true;
}

function MomentCard({ moment, index, sessionId, audioStatus }: { moment: ReviewMoment; index: number; sessionId: string; audioStatus: AudioRetentionStatus }) {
  const utils = trpc.useUtils();
  const accentVariation = isAccentVariation(moment);
  const decide = trpc.readerLeader.sessions.decideIntervention.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.readerLeader.sessions.teacherReview.invalidate({ sessionId }),
        utils.readerLeader.dashboards.teacher.invalidate(),
      ]);
      toast("Teacher decision saved to this reading moment.");
    },
    onError: error => toast(error.message),
  });
  const decisionLabel = moment.teacherDecision === "confirmed" ? "Confirmed" : moment.teacherDecision === "overridden" ? "Overridden" : null;
  // The clip makes review better, not possible. Where there is none, say so plainly rather
  // than leaving a control that cannot play anything.
  const noClipNote = flaggedWordAudioNote(audioStatus);

  return <article className={`review-moment-card ${accentVariation ? "accent-variation" : "reading-event"}`}><div className="review-moment-heading"><div><span className="moment-category">{accentVariation ? "Accent variation — please confirm" : "Reading event — teacher decision"}</span><h3>{accentVariation ? "Listen before deciding" : "Review the saved reading moment"}</h3></div>{decisionLabel ? <span className={`decision-state ${moment.teacherDecision}`}>{decisionLabel}</span> : <span className="decision-state pending">Decision needed</span>}</div><div className="word-comparison"><div><span>Expected word</span><b>{moment.word}</b></div><div><span>Heard word</span><b>{moment.heardWord || "Not captured"}</b></div></div><p className="moment-note">{moment.note}</p>{noClipNote ? <p className="moment-no-clip" data-testid="moment-no-clip"><Headphones size={14} /> {noClipNote}</p> : null}<div className="moment-actions"><button className="confirm-moment" onClick={() => decide.mutate({ sessionId, interventionIndex: index, teacherDecision: "confirmed" })} disabled={decide.isPending || moment.teacherDecision === "confirmed"}><Check size={15} /> {moment.teacherDecision === "confirmed" ? "Confirmed" : accentVariation ? "Confirm variation" : "Confirm event"}</button><button className="override-moment" onClick={() => decide.mutate({ sessionId, interventionIndex: index, teacherDecision: "overridden" })} disabled={decide.isPending || moment.teacherDecision === "overridden"}><X size={15} /> {moment.teacherDecision === "overridden" ? "Overridden" : "Override"}</button></div></article>;
}

function MomentGroup({ title, description, moments, sessionId, accent, audioStatus }: { title: string; description: string; moments: Array<{ moment: ReviewMoment; index: number }>; sessionId: string; accent: boolean; audioStatus: AudioRetentionStatus }) {
  return <section className={`review-moment-group ${accent ? "accent-group" : "error-group"}`}><div className="review-group-title"><span>{accent ? <ShieldCheck size={18} /> : <ClipboardCheck size={18} />}</span><div><div className="kicker">{accent ? "Separate category" : "Other saved events"}</div><h2>{title}</h2><p>{description}</p></div></div>{moments.length ? <div className="review-moment-list">{moments.map(({ moment, index }) => <MomentCard key={`${sessionId}-${index}`} moment={moment} index={index} sessionId={sessionId} audioStatus={audioStatus} />)}</div> : <p className="review-empty">{accent ? "No provisional accent variations were saved for this session." : "No additional flagged reading events were saved for this session."}</p>}</section>;
}

export function TeacherSessionReviewScreen({ sessionId }: { sessionId: string }) {
  const [, setLocation] = useLocation();
  const review = trpc.readerLeader.sessions.teacherReview.useQuery({ sessionId });

  if (review.isLoading) return <main className="workflow-page"><section className="workflow-card session-review-loading">Opening the saved running record…</section></main>;
  if (!review.data) return <main className="workflow-page"><section className="workflow-card session-review-loading"><h1>Session not found</h1><p>This saved reading session is unavailable, or belongs to another teacher account.</p><button className="secondary-cta" onClick={() => setLocation("/")}><ArrowLeft size={16} /> Return to Teacher Dashboard</button></section></main>;

  const { session, childName, bookBand } = review.data;
  const indexedMoments = (session.interventions ?? []).map((moment, index) => ({ moment: moment as ReviewMoment, index }));
  const accentMoments = indexedMoments.filter(item => isAccentVariation(item.moment));
  const errorMoments = indexedMoments.filter(item => !isAccentVariation(item.moment));
  const savedAt = session.createdAt ? new Date(session.createdAt).toLocaleString() : "Saved reading session";
  const audioStatus = session.audioStatus as AudioRetentionStatus;

  return <main className="workflow-page session-review-page"><section className="workflow-hero success"><div><div className="kicker"><ClipboardCheck size={15} /> Teacher review</div><h1>Review the reading record.</h1><p><b>{childName}</b> read <b>{session.storyTitle}</b>. Use the saved record, any available audio, and your professional judgement to confirm or override each flagged moment.</p><p className="record-audio-state" data-testid="session-audio-state"><Headphones size={14} /> {audioAbsenceSummary(audioStatus)}{hasStoredAudio(audioStatus) ? "" : " — every flagged moment below can still be confirmed or overridden from the transcript."}</p></div><div className="workflow-actions"><button className="secondary-cta" onClick={() => setLocation("/")}><ArrowLeft size={17} /> Return to Dashboard</button></div></section><section className="running-record-card"><div className="record-header"><div><div className="kicker">Saved running record</div><h2>{session.storyTitle}</h2><p>{childName} · {bookBand} · {savedAt}</p></div><span className="view-chip">{session.assessmentMode.replaceAll("_", " ")}</span></div><div className="record-metrics"><div><span>Story match</span><b>{session.accuracy}%</b></div><div><span>Reading speed</span><b>{session.wordsCorrectPerMinute} WCPM</b></div><div><span>Reading time</span><b>{session.durationSeconds}s</b></div></div><section className="record-transcript"><div className="record-section-heading"><div><h3>Saved spoken record</h3><p>This is the captured reading transcript for teacher review.</p></div><SessionAudioButton sessionId={session.id} audioStatus={session.audioStatus} label="Play saved audio" /></div><p>{session.transcript}</p><SessionTranscriptPlayer sessionId={session.id} audioStatus={session.audioStatus} /></section>{session.wordStates?.length ? <section className="saved-word-states"><h3>Saved word states</h3><div>{session.wordStates.map((word: any) => <span key={word.id} className={word.status}><b>{word.text}</b><small>{word.status.replaceAll("_", " ")}</small></span>)}</div></section> : null}</section><MomentGroup title="Accent variations" description="These moments were provisionally accepted under the learner’s Irish English support setting. They are separate from reading errors and need your confirmation." moments={accentMoments} sessionId={session.id} accent audioStatus={audioStatus} /><MomentGroup title="Other flagged moments" description="Review these reading events alongside the running record and any available audio." moments={errorMoments} sessionId={session.id} accent={false} audioStatus={audioStatus} /></main>;
}
