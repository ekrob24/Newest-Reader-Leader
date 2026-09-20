import { SessionAudioButton, SessionTranscriptPlayer, useSessionWordClips } from "@/components/ReadingActions";
import { trpc } from "@/lib/trpc";
import { audioAbsenceSummary, flaggedWordAudioNote, hasStoredAudio, isAudioFailure } from "@shared/audioRetention";
import { PACE_AWAITS_REVIEW, isPaceMeaningful, shortSampleNote } from "@shared/readingPace";
import type { AudioRetentionStatus } from "@shared/types";
import { buildReviewQueue, type ReviewWord } from "@shared/reviewRanking";
import { ArrowLeft, Check, ClipboardCheck, Headphones, ListOrdered, ShieldCheck, Volume2, X } from "lucide-react";
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
  return <section className={`review-moment-group ${accent ? "accent-group" : "error-group"}`} data-testid={accent ? "accent-moments" : "error-moments"}><div className="review-group-title"><span>{accent ? <ShieldCheck size={18} /> : <ClipboardCheck size={18} />}</span><div><div className="kicker">{accent ? "Separate category" : "Other saved events"}</div><h2>{title}</h2><p>{description}</p></div></div>{moments.length ? <div className="review-moment-list">{moments.map(({ moment, index }) => <MomentCard key={`${sessionId}-${index}`} moment={moment} index={index} sessionId={sessionId} audioStatus={audioStatus} />)}</div> : <p className="review-empty">{accent ? "No provisional accent variations were saved for this session." : "No additional flagged reading events were saved for this session."}</p>}</section>;
}


type QueueWord = ReviewWord & { heardWord: string | null; judgement: string; resolution: string };

function clockTime(ms: number | null) {
  if (ms === null || !Number.isFinite(ms)) return null;
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Where to listen first.
 *
 * Ordered by how unsure the software is that the word was read as written, least sure at the
 * top, because the teacher's time is the cost this product has to justify - not because the
 * order is a judgement about the child. Nothing here is a score of her reading.
 *
 * Every confidence column is null on every saved reading today, so the usual state of this
 * panel is to say it cannot order anything. That is the point: a queue that silently fell back
 * to reading order while calling itself a review order would be the same defect this project
 * keeps finding.
 */
function ReviewQueue({ words, sessionId, canPlay }: { words: QueueWord[]; sessionId: string; canPlay: boolean }) {
  const { playback, audioRef, audioUrl, load, hearWord } = useSessionWordClips(sessionId);
  const queue = buildReviewQueue(words);

  if (!words.length) {
    return <section className="review-queue" data-testid="review-queue"><div className="review-group-title"><span><ListOrdered size={18} /></span><div><div className="kicker">Where to listen first</div><h2>No per-word record for this reading.</h2><p>This reading was saved before per-word rows were written, so there is nothing to order. The saved moments below are still complete.</p></div></div></section>;
  }

  return <section className="review-queue" data-testid="review-queue"><div className="review-group-title"><span><ListOrdered size={18} /></span><div><div className="kicker">Where to listen first</div><h2>{queue.unordered ? "These words are in reading order, not review order." : "Least certain first."}</h2><p data-testid="review-queue-state">{queue.unordered
    ? "No per-word confidence was recorded for this reading, so nothing can be ranked. Until a reading engine writes one, this is the passage in the order it was read."
    : "Ordered by how unsure the software is that each word was read as written. This ranks your attention; it is not a score of the reading."}</p></div></div>
    {canPlay && !playback ? <button className="audio-action" onClick={() => void load()} disabled={audioUrl.isFetching}><Volume2 size={14} /> {audioUrl.isFetching ? "Loading…" : "Open word playback"}</button> : null}
    {playback ? <audio ref={audioRef} src={playback.url} preload="metadata" data-testid="review-queue-audio" /> : null}
    <ol className="review-queue-list">{[...queue.ranked, ...queue.unscored.map(word => ({ ...word, rank: null as number | null }))].map(word => {
      const at = clockTime(word.startMs);
      return <li key={word.wordEventId} data-testid="review-queue-word"><span className="queue-rank">{word.rank ?? "—"}</span><div className="queue-word"><b>{word.referenceWord}</b>{word.heardWord && word.heardWord !== word.referenceWord ? <small>heard “{word.heardWord}”</small> : null}</div><span className="queue-score">{word.score === null ? "no score" : word.score.toFixed(3)}</span><span className="queue-time">{at ?? "no timing"}</span>{canPlay && word.startMs !== null && word.endMs !== null
        ? <button type="button" onClick={() => void hearWord({ id: word.wordEventId, text: word.referenceWord, startMs: word.startMs as number, endMs: word.endMs as number })}><Volume2 size={12} /> Hear</button>
        : <span className="queue-no-clip">no clip</span>}</li>;
    })}</ol>
    {queue.unscored.length && !queue.unordered ? <p className="queue-unscored-note" data-testid="review-queue-unscored">{queue.unscored.length} {queue.unscored.length === 1 ? "word carries" : "words carry"} no confidence and could not be ranked. They are listed after the ranked words, not treated as certain.</p> : null}
  </section>;
}

export function TeacherSessionReviewScreen({ sessionId }: { sessionId: string }) {
  const [, setLocation] = useLocation();
  const review = trpc.readerLeader.sessions.teacherReview.useQuery({ sessionId });

  if (review.isLoading) return <main className="workflow-page"><section className="workflow-card session-review-loading">Opening the saved running record…</section></main>;
  if (!review.data) return <main className="workflow-page"><section className="workflow-card session-review-loading"><h1>Session not found</h1><p>This saved reading session is unavailable, or belongs to another teacher account.</p><button className="secondary-cta" onClick={() => setLocation("/")}><ArrowLeft size={16} /> Return to Teacher Dashboard</button></section></main>;

  const { session, childName, bookBand, settled } = review.data;
  const reviewWords = ((review.data as { reviewWords?: unknown }).reviewWords ?? []) as Parameters<typeof ReviewQueue>[0]["words"];
  const indexedMoments = (session.interventions ?? []).map((moment, index) => ({ moment: moment as ReviewMoment, index }));
  const accentMoments = indexedMoments.filter(item => isAccentVariation(item.moment));
  const errorMoments = indexedMoments.filter(item => !isAccentVariation(item.moment));
  const savedAt = session.createdAt ? new Date(session.createdAt).toLocaleString() : "Saved reading session";
  const audioStatus = session.audioStatus as AudioRetentionStatus;
  // A words-per-minute figure from a very short read is mostly arithmetic. Say so where the
  // figure is shown, rather than presenting it as a measurement of the child.
  const paceNote = shortSampleNote(session.durationSeconds);

  return <main className="workflow-page session-review-page"><section className="workflow-hero success"><div><div className="kicker"><ClipboardCheck size={15} /> Teacher review</div><h1>Review the reading record.</h1><p><b>{childName}</b> read <b>{session.storyTitle}</b>. Use the saved record, any available audio, and your professional judgement to confirm or override each flagged moment.</p><p className={`record-audio-state ${isAudioFailure(audioStatus) ? "audio-fault" : "audio-by-design"}`} data-testid="session-audio-state"><Headphones size={14} /> {audioAbsenceSummary(audioStatus)}{hasStoredAudio(audioStatus) ? "" : " — every flagged moment below can still be confirmed or overridden from the transcript."}</p></div><div className="workflow-actions"><button className="secondary-cta" onClick={() => setLocation("/")}><ArrowLeft size={17} /> Return to Dashboard</button></div></section><section className="running-record-card"><div className="record-header"><div><div className="kicker">Saved running record</div><h2>{session.storyTitle}</h2><p>{childName} · {bookBand} · {savedAt}</p></div><span className="view-chip">{session.assessmentMode.replaceAll("_", " ")}</span></div><div className="record-metrics"><div className="settled-metric"><span>After your decisions</span><b data-testid="settled-accuracy">{settled.accuracy === null ? "—" : `${settled.accuracy}%`}</b></div><div className="settled-metric"><span>Reading speed, after your decisions</span><b data-testid="settled-wcpm">{settled.wordsCorrectPerMinute === null ? "\u2014" : `${settled.wordsCorrectPerMinute} WCPM`}</b></div><div><span>Reading time</span><b>{session.durationSeconds}s</b></div></div>{paceNote ? <p className="pace-caveat" data-testid="session-pace-caveat">{paceNote}</p> : null}{settled.wordsCorrectPerMinute === null && isPaceMeaningful(session.durationSeconds) ? <p className="pace-caveat" data-testid="pace-awaits-review">{PACE_AWAITS_REVIEW}</p> : null}{settled.discardedErrors > 0 ? <p className="record-incomplete" data-testid="discarded-errors"><ShieldCheck size={14} /> This reading found <b>{settled.discardedErrors}</b> more likely {settled.discardedErrors === 1 ? "error" : "errors"} than it kept. Only the first five reading moments are saved for review, so the rest are not below and cannot be confirmed or overruled. No accuracy or reading speed is reported for this reading, because any figure would leave those words out and read higher than the reading was.</p> : null}<p className="settled-explainer"><ShieldCheck size={14} /> A flagged word only counts against this reading once you confirm it. {settled.countedAgainst === 0 ? "Nothing is counting against it right now." : `${settled.countedAgainst} of ${settled.wordCount} words ${settled.countedAgainst === 1 ? "is" : "are"} counting against it.`} Overriding a flag takes it back out.</p><section className="record-transcript"><div className="record-section-heading"><div><h3>Saved spoken record</h3><p>This is the captured reading transcript for teacher review.</p></div><SessionAudioButton sessionId={session.id} audioStatus={session.audioStatus} label="Play saved audio" /></div><p>{session.transcript}</p><SessionTranscriptPlayer sessionId={session.id} audioStatus={session.audioStatus} /></section>{session.wordStates?.length ? <section className="saved-word-states"><h3>Saved word states</h3><div>{session.wordStates.map((word: any) => <span key={word.id} className={word.status}><b>{word.text}</b><small>{word.status.replaceAll("_", " ")}</small></span>)}</div></section> : null}</section><ReviewQueue words={reviewWords} sessionId={session.id} canPlay={hasStoredAudio(audioStatus)} /><MomentGroup title="Accent variations" description="These moments were provisionally accepted under the learner’s Irish English support setting. They are separate from reading errors and need your confirmation." moments={accentMoments} sessionId={session.id} accent audioStatus={audioStatus} /><MomentGroup title="Other flagged moments" description="Review these reading events alongside the running record and any available audio." moments={errorMoments} sessionId={session.id} accent={false} audioStatus={audioStatus} /></main>;
}
