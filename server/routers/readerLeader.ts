import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { audienceForRole, progressForAudience, readingResultForAudience } from "../../shared/accuracyAudience";
import { invokeLLM } from "../_core/llm";
import { protectedProcedure, router } from "../_core/trpc";
import { scopeForUser } from "../tenantScope";
import { isSessionId } from "../../shared/sessionId";
import { unrecordedAttemptReasonValues } from "../../drizzle/schema";
import { audioAbsenceSummary } from "../../shared/audioRetention";
import { getAccentFairnessSummary } from "../accentMetrics";
import { analyseReadingText, buildInterventions } from "../reader";
import { assertSafeExerciseSet } from "../exerciseSafety";
import { buildExerciseGenerationRequest } from "../exercisePrompt";
import { extractReadingMaterial } from "../documentExtraction";
import { createReadingReport } from "../readerReports";
import { scoreQuiz } from "../quizPolicy";
import { createBrandedPdfReport } from "../pdfReports";
import { createClassVariationReviewPdf } from "../classVariationReviewReport";
import {
  approveIrishVariantForClass,
  approveReadingMaterial,
  assignReadingMaterialToClasses,
  addLearnerToTeacherClass,
  addLearnersToTeacherClass,
  confirmProvisionalMatchReview,
  createProvisionalMatchReviews,
  createAdditionalClassForTeacher,
  createChildProfile,
  createClassForTeacher,
  createReadingMaterial,
  enrollChildInClass,
  getChildProfileForUser,
  getChildProgress,
  getIrishVariantContextForChild,
  getAssignedMaterialForChild,
  getLearnerReadingSettings,
  getParentDashboard,
  getSessionById,
  getSessionPlayback,
  getTeacherSessionReview,
  getTeacherMaterialReview,
  getTeacherDashboard,
  getTeacherIrishVariantExport,
  getTeacherClassVariationReview,
  getTeacherMonthlyTrendExport,
  listEducatorApprovedIrishVariants,
  listParentReminders,
  listTeacherProvisionalMatches,
  listSessionsForAccentFairness,
  listTeacherClasses,
  listTeacherTermPresets,
  isTeacher,
  linkParentToFamily,
  listAssignedMaterialsForChild,
  makeReadingMaterialAssignable,
  listTeacherMaterials,
  mayAccessChildProfile,
  saveGeneratedExercises,
  saveQuizAttempt,
  addSessionComment,
  getSessionComments,
  getQuizHistory,
  getReportContext,
  getSchoolBrandingForTeacher,
  saveSchoolBranding,
  seedDemoCohort,
  recordUnrecordedReadingAttempt,
  acknowledgeUnrecordedReadingAttempt,
  getSettledAccuracy,
  saveReadingSession,
  saveLearnerReadingSettings,
  saveWeeklyReadingGoal,
  saveClassLanguageSupportDefault,
  saveHomePracticeChecklist,
  markParentReminderRead,
  markAllParentRemindersRead,
  saveTeacherTermPreset,
  saveTeacherInterventionDecision,
  deleteTeacherTermPreset,
  deleteEducatorApprovedIrishVariant,
  setUserRole,
} from "../readerDb";
import { storageGet, storagePut } from "../storage";
import { classifyStorageOutcome } from "../audioOutcome";
import { buildWordTimings } from "../wordTiming";
import { createMonthlyTrendCsv, monthlyTrendFilename } from "../trendExport";
import { createIrishVariantCsv, irishVariantFilename } from "../irishVariantExport";

const childRole = z.literal("child");
const teacherRole = z.literal("teacher");
const parentRole = z.literal("parent");
const assessmentModeSchema = z.enum(["GUIDED_PRACTICE", "ASSISTED_PRACTICE", "MONTHLY_ASSESSMENT"]);
const languageSupportSchema = z.enum(["STANDARD_ENGLISH", "IRISH_ENGLISH_SUPPORT"]);
const materialRightsSourceSchema = z.enum(["original", "public_domain", "permission_obtained"]);
const trendDateRangeSchema = z.object({ startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).optional();
const termPresetSchema = z.object({ name: z.string().trim().min(2).max(80), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const weeklyGoalSchema = z.object({ childProfileId: z.number().int().positive(), weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), targetMinutes: z.number().int().min(5).max(600), targetSessions: z.number().int().min(1).max(14), note: z.string().trim().max(240).optional() });
const wordStateSchema = z.object({ id: z.string().regex(/^word-\d+$/), text: z.string().min(1).max(80), status: z.enum(["unread", "current", "correct", "incorrect", "retried_correct"]), attempts: z.number().int().min(0).max(12) });
const exerciseSetSchema = z.object({
  vocabulary: z.array(z.object({ word: z.string().min(1).max(50), childFriendlyMeaning: z.string().min(1).max(200) })).min(3).max(6),
  questions: z.array(z.object({ prompt: z.string().min(1).max(240), options: z.array(z.string().min(1).max(120)).min(3).max(4), answer: z.string().min(1).max(120), explanation: z.string().min(1).max(240) })).min(3).max(4),
  activity: z.string().min(1).max(300),
});

function code(prefix: string) {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

function requireTeacher(role: string) {
  if (!isTeacher(role as "user" | "admin" | "child" | "teacher" | "parent")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This action is available to teacher accounts." });
  }
}

function llmContentAsText(content: string | unknown[]): string {
  if (typeof content === "string") return content;
  return content.map(part => "text" in (part as object) ? (part as { text: string }).text : "").join("");
}

function safeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180) || "reading-material";
}

/** A session (or session child row) identifier: a ULID generated at the point of capture. */
const sessionIdInput = z.string().refine(isSessionId, "That is not a Reader Leader session identifier.");

/**
 * The school this request acts in, taken from the authenticated account rather than looked up.
 * A break-glass support account carries no school and is refused here.
 */
function tenantScope(ctx: { user: { schoolId: number | null } }) {
  try {
    return scopeForUser(ctx.user);
  } catch {
    throw new TRPCError({ code: "FORBIDDEN", message: "This account is not a member of a school." });
  }
}

export const readerLeaderRouter = router({
  account: router({
    me: protectedProcedure.query(async ({ ctx }) => {
      const role = ctx.user.role;
      const profile = role === "child" ? await getChildProfileForUser(tenantScope(ctx), ctx.user.id) : null;
      return { user: ctx.user, role, profile };
    }),
    setupChild: protectedProcedure.input(z.object({ displayName: z.string().trim().min(2).max(80) })).mutation(async ({ ctx, input }) => {
      await setUserRole(tenantScope(ctx), ctx.user.id, childRole.value);
      const profile = await createChildProfile(tenantScope(ctx), ctx.user.id, input.displayName, code("FAMILY"));
      return { profile, familyCode: profile.familyCode };
    }),
    setupTeacher: protectedProcedure.input(z.object({ className: z.string().trim().min(2).max(120) })).mutation(async ({ ctx, input }) => {
      await setUserRole(tenantScope(ctx), ctx.user.id, teacherRole.value);
      const readerClass = await createClassForTeacher(tenantScope(ctx), ctx.user.id, input.className, code("CLASS"));
      return { readerClass, joinCode: readerClass.joinCode };
    }),
    linkParent: protectedProcedure.input(z.object({ familyCode: z.string().trim().min(4).max(12) })).mutation(async ({ ctx, input }) => {
      await setUserRole(tenantScope(ctx), ctx.user.id, parentRole.value);
      const profile = await linkParentToFamily(tenantScope(ctx), ctx.user.id, input.familyCode.toUpperCase());
      return { profile };
    }),
    joinClass: protectedProcedure.input(z.object({ classCode: z.string().trim().min(4).max(12) })).mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "child") throw new TRPCError({ code: "FORBIDDEN", message: "Only child accounts can join a class." });
      const readerClass = await enrollChildInClass(tenantScope(ctx), ctx.user.id, input.classCode.toUpperCase());
      return { readerClass };
    }),
  }),
  materials: router({
    extractUpload: protectedProcedure.input(z.object({
      sourceFilename: z.string().trim().min(1).max(255),
      sourceFileBase64: z.string().min(1).max(7_000_000),
      sourceFileMime: z.string().trim().min(1).max(120),
    })).mutation(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      const bytes = Buffer.from(input.sourceFileBase64, "base64");
      if (bytes.byteLength === 0 || bytes.byteLength > 5_000_000) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Use a reading document under 5 MB." });
      const extracted = await extractReadingMaterial(bytes, input.sourceFileMime, input.sourceFilename);
      const stored = await storagePut(`reader-leader/materials/${ctx.user.id}/${safeFilename(input.sourceFilename)}`, bytes, input.sourceFileMime);
      return { ...extracted, sourceFilename: input.sourceFilename, storageKey: stored.key };
    }),
    assignedForMe: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "child") throw new TRPCError({ code: "FORBIDDEN", message: "Assigned reading materials are available to child accounts." });
      return listAssignedMaterialsForChild(tenantScope(ctx), ctx.user.id);
    }),
    listMine: protectedProcedure.query(async ({ ctx }) => {
      requireTeacher(ctx.user.role);
      return listTeacherMaterials(tenantScope(ctx), ctx.user.id);
    }),
    review: protectedProcedure.input(z.object({ materialId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      const [review, classes] = await Promise.all([getTeacherMaterialReview(tenantScope(ctx), ctx.user.id, input.materialId), listTeacherClasses(tenantScope(ctx), ctx.user.id)]);
      if (!review) throw new TRPCError({ code: "NOT_FOUND", message: "This material is not available to your class." });
      return { ...review, availableClasses: classes.map(readerClass => ({ id: readerClass.id, name: readerClass.name, joinCode: readerClass.joinCode })) };
    }),
    create: protectedProcedure.input(z.object({
      title: z.string().trim().min(3).max(180),
      author: z.string().trim().min(2).max(180),
      rightsSource: materialRightsSourceSchema,
      interestAge: z.string().trim().min(2).max(80),
      genre: z.string().trim().min(2).max(80),
      readingLevel: z.string().trim().min(2).max(80),
      summary: z.string().trim().max(480).optional(),
      sourceText: z.string().trim().min(80).max(8000),
      sourceFilename: z.string().trim().min(1).max(255).optional(),
      sourceFileBase64: z.string().max(7_000_000).optional(),
      sourceFileMime: z.string().max(120).optional(),
      storageKey: z.string().max(512).optional(),
    })).mutation(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      let storageKey = input.storageKey;
      if (storageKey && !storageKey.startsWith(`reader-leader/materials/${ctx.user.id}/`)) throw new TRPCError({ code: "FORBIDDEN", message: "This uploaded document does not belong to your account." });
      if (input.sourceFileBase64 && input.sourceFilename) {
        const bytes = Buffer.from(input.sourceFileBase64, "base64");
        if (bytes.byteLength > 5_000_000) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Use a source document under 5 MB." });
        const stored = await storagePut(`reader-leader/materials/${ctx.user.id}/${safeFilename(input.sourceFilename)}`, bytes, input.sourceFileMime || "text/plain");
        storageKey = stored.key;
      }
      return createReadingMaterial(tenantScope(ctx), { teacherUserId: ctx.user.id, title: input.title, author: input.author, rightsSource: input.rightsSource, interestAge: input.interestAge, genre: input.genre, readingLevel: input.readingLevel, summary: input.summary, sourceText: input.sourceText, sourceFilename: input.sourceFilename, storageKey });
    }),
    generateExercises: protectedProcedure.input(z.object({ materialId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      const materials = await listTeacherMaterials(tenantScope(ctx), ctx.user.id);
      const material = materials.find(item => item.id === input.materialId);
      if (!material) throw new TRPCError({ code: "FORBIDDEN", message: "This material is not available to your class." });
      // The payload is built from the passage alone, by the only module allowed to decide
      // what leaves this system for the LLM provider. Passing `material` here is a compile
      // error: it carries teacher, school and storage fields that must not be sent.
      const result = await invokeLLM(buildExerciseGenerationRequest({ title: material.title, readingLevel: material.readingLevel, sourceText: material.sourceText }, "gpt-5-mini"));
      const content = llmContentAsText(result.choices[0]?.message.content ?? "");
      const exerciseSet = assertSafeExerciseSet(exerciseSetSchema.parse(JSON.parse(content)));
      const saved = await saveGeneratedExercises(tenantScope(ctx), material.id, exerciseSet, "gpt-5-mini");
      return { material, exercise: saved };
    }),
    saveExerciseDraft: protectedProcedure.input(z.object({ materialId: z.number().int().positive(), exerciseSet: exerciseSetSchema })).mutation(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      const materials = await listTeacherMaterials(tenantScope(ctx), ctx.user.id);
      const material = materials.find(item => item.id === input.materialId);
      if (!material) throw new TRPCError({ code: "FORBIDDEN", message: "This material is not available to your class." });
      const exerciseSet = assertSafeExerciseSet(input.exerciseSet);
      const exercise = await saveGeneratedExercises(tenantScope(ctx), material.id, exerciseSet, "teacher-reviewed draft");
      return { material, exercise };
    }),
    approve: protectedProcedure.input(z.object({ materialId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      return { success: true, details: await approveReadingMaterial(tenantScope(ctx), ctx.user.id, input.materialId) };
    }),
    makeAssignable: protectedProcedure.input(z.object({ materialId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      return { success: true, details: await makeReadingMaterialAssignable(tenantScope(ctx), ctx.user.id, input.materialId) };
    }),
    assign: protectedProcedure.input(z.object({ materialId: z.number().int().positive(), classIds: z.array(z.number().int().positive()).min(1).max(100).refine(classIds => new Set(classIds).size === classIds.length, "Choose each class only once.") })).mutation(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      return assignReadingMaterialToClasses(tenantScope(ctx), ctx.user.id, input.materialId, input.classIds);
    }),
  }),
  sessions: router({
    processAndSave: protectedProcedure.input(z.object({
      childProfileId: z.number().int().positive(),
      materialId: z.number().int().positive().nullable().optional(),
      storyTitle: z.string().min(3).max(180),
      expectedText: z.string().min(20).max(8000),
      audioBase64: z.string().min(1).max(6_000_000),
      audioMime: z.string().optional(),
      // Recorded, not validated. A save must never be rejected over how long the reading
      // took: hasChildReadingEvidence already decides whether a reading happened, and a
      // bound here only turns a legitimate read into a silent 400. The remaining range is
      // a sanity bound on the payload — a broken clock, not a judgement about the child.
      durationSeconds: z.number().int().min(0).max(86_400),
      fallbackTranscript: z.string().max(8000).optional().default(""),
      assessmentMode: assessmentModeSchema.default("ASSISTED_PRACTICE"),
      wordStates: z.array(wordStateSchema).max(1000).optional(),
    })).mutation(async ({ ctx, input }) => {
      const allowed = await mayAccessChildProfile(tenantScope(ctx), { id: ctx.user.id, role: ctx.user.role }, input.childProfileId);
      if (!allowed || ctx.user.role !== "child") throw new TRPCError({ code: "FORBIDDEN", message: "Only the signed-in child can save this reading session." });
      const bytes = Buffer.from(input.audioBase64, "base64");
      if (bytes.byteLength === 0 || bytes.byteLength > 4_500_000) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Keep this practice recording under 4.5 MB and try again." });
      const mimeType = input.audioMime?.startsWith("audio/") ? input.audioMime : "audio/webm";
      const extension = mimeType.includes("ogg") ? "ogg" : mimeType.includes("wav") ? "wav" : "webm";
      const [learnerSettings, irishVariantContext] = await Promise.all([getLearnerReadingSettings(tenantScope(ctx), input.childProfileId), getIrishVariantContextForChild(tenantScope(ctx), input.childProfileId)]);
      const transcriptionPrompt = learnerSettings.languageSupport === "IRISH_ENGLISH_SUPPORT"
        ? "Transcribe a child reading aloud in Irish English. Preserve the words as spoken, including regional pronunciation. Do not correct mistakes or convert dialect features."
        : "Transcribe an English-speaking child reading aloud. Preserve the words as spoken. Do not correct mistakes.";
      const { transcribeAudio } = await import("../whisperTranscription");
      const [storedResult, transcriptionResult] = await Promise.allSettled([
        storagePut(`reader-leader/recordings/${ctx.user.id}/session-${Date.now()}.${extension}`, bytes, mimeType),
        transcribeAudio({ audio: bytes, mimeType, language: "en", prompt: transcriptionPrompt }),
      ]);
      // A session is valid without its audio. The retention model is that audio is scored and
      // discarded in the same request, so a null key is the ordinary production case, not an
      // error. Degrade exactly as a failed transcription does — but never silently: record
      // which kind of null this is so the review surface can say why no clip exists.
      if (storedResult.status === "rejected") console.error("[readerLeader] recording not stored:", storedResult.reason);
      const { audioStorageKey, audioStatus } = classifyStorageOutcome(storedResult);
      const transcription = transcriptionResult.status === "fulfilled" && !("error" in transcriptionResult.value) ? transcriptionResult.value : null;
      const transcriptionStatus = transcription ? "transcribed" as const : "guided" as const;
      const transcript = transcription?.text || input.fallbackTranscript.trim();
      if (!transcript) throw new TRPCError({ code: "BAD_REQUEST", message: "Read a few words before finishing so Reader Leader can prepare a report." });
      const analysis = analyseReadingText(input.expectedText, transcript, input.durationSeconds, input.assessmentMode, input.wordStates, learnerSettings.languageSupport, irishVariantContext.variants);
      const interventions = buildInterventions(analysis.events);
      const wordTimings = buildWordTimings(transcript, analysis.durationSeconds, transcription?.segments);
      const session = await saveReadingSession(tenantScope(ctx), { childProfileId: input.childProfileId, materialId: input.materialId, storyTitle: input.storyTitle, transcript: analysis.transcript, accuracy: analysis.accuracy, wordsCorrectPerMinute: analysis.pace, durationSeconds: analysis.durationSeconds, audioStorageKey, audioStatus, assessmentMode: input.assessmentMode, languageSupport: learnerSettings.languageSupport, practiceWords: analysis.practiceWords, interventions, wordStates: analysis.wordStates, wordTimings });
      await createProvisionalMatchReviews(tenantScope(ctx), { sessionId: session.id, childProfileId: input.childProfileId, classId: irishVariantContext.classId, matches: analysis.events.filter(event => event.provisionalIrishEnglish && event.recognisedWord).map(event => ({ expectedWord: event.expectedWord, recognisedWord: event.recognisedWord!, source: event.variantSource })) });
      // The reader gets her report without the percentage; the row keeps it for the teacher.
      return { ...readingResultForAudience({ session, analysis }, audienceForRole(ctx.user.role)), transcriptionStatus, audioStatus };
    }),
    save: protectedProcedure.input(z.object({
      childProfileId: z.number().int().positive(),
      materialId: z.number().int().positive().nullable().optional(),
      storyTitle: z.string().min(3).max(180),
      expectedText: z.string().min(20).max(8000),
      transcript: z.string().min(1).max(8000),
      // Recorded, not validated. A save must never be rejected over how long the reading
      // took: hasChildReadingEvidence already decides whether a reading happened, and a
      // bound here only turns a legitimate read into a silent 400. The remaining range is
      // a sanity bound on the payload — a broken clock, not a judgement about the child.
      durationSeconds: z.number().int().min(0).max(86_400),
      assessmentMode: assessmentModeSchema.default("ASSISTED_PRACTICE"),
      wordStates: z.array(wordStateSchema).max(1000).optional(),
      demoInterventions: z.array(z.object({ word: z.string().min(1).max(80), action: z.enum(["prompt", "model", "stay_silent", "teacher_review"]), note: z.string().min(1).max(300) })).max(3).optional().default([]),
    })).mutation(async ({ ctx, input }) => {
      const allowed = await mayAccessChildProfile(tenantScope(ctx), { id: ctx.user.id, role: ctx.user.role }, input.childProfileId);
      if (!allowed || ctx.user.role !== "child") throw new TRPCError({ code: "FORBIDDEN", message: "Only the signed-in child can save this reading session." });
      const [learnerSettings, irishVariantContext] = await Promise.all([getLearnerReadingSettings(tenantScope(ctx), input.childProfileId), getIrishVariantContextForChild(tenantScope(ctx), input.childProfileId)]);
      const analysis = analyseReadingText(input.expectedText, input.transcript, input.durationSeconds, input.assessmentMode, input.wordStates, learnerSettings.languageSupport, irishVariantContext.variants);
      const interventions = buildInterventions(analysis.events);
      const wordTimings = buildWordTimings(analysis.transcript, analysis.durationSeconds);
      const session = await saveReadingSession(tenantScope(ctx), { childProfileId: input.childProfileId, materialId: input.materialId, storyTitle: input.storyTitle, transcript: analysis.transcript, accuracy: analysis.accuracy, wordsCorrectPerMinute: analysis.pace, durationSeconds: analysis.durationSeconds, assessmentMode: input.assessmentMode, languageSupport: learnerSettings.languageSupport, practiceWords: analysis.practiceWords, interventions: [...input.demoInterventions, ...interventions], wordStates: analysis.wordStates, wordTimings });
      await createProvisionalMatchReviews(tenantScope(ctx), { sessionId: session.id, childProfileId: input.childProfileId, classId: irishVariantContext.classId, matches: analysis.events.filter(event => event.provisionalIrishEnglish && event.recognisedWord).map(event => ({ expectedWord: event.expectedWord, recognisedWord: event.recognisedWord!, source: event.variantSource })) });
      return readingResultForAudience({ session, analysis }, audienceForRole(ctx.user.role));
    }),
    teacherReview: protectedProcedure.input(z.object({ sessionId: sessionIdInput })).query(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      const review = await getTeacherSessionReview(tenantScope(ctx), input.sessionId);
      if (!review) throw new TRPCError({ code: "NOT_FOUND", message: "Reading session not found." });
      const allowed = await mayAccessChildProfile(tenantScope(ctx), { id: ctx.user.id, role: ctx.user.role }, review.session.childProfileId);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "This child is not assigned to your class." });
      // Derived from the per-word rows on every read, never stored, so it cannot drift from
      // the decisions a teacher has actually made.
      return { ...review, settled: await getSettledAccuracy(tenantScope(ctx), input.sessionId) };
    }),
    decideIntervention: protectedProcedure.input(z.object({ sessionId: sessionIdInput, interventionIndex: z.number().int().min(0).max(100), teacherDecision: z.enum(["confirmed", "overridden"]) })).mutation(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      const session = await getSessionById(tenantScope(ctx), input.sessionId);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Reading session not found." });
      const allowed = await mayAccessChildProfile(tenantScope(ctx), { id: ctx.user.id, role: ctx.user.role }, session.childProfileId);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "This child is not assigned to your class." });
      return saveTeacherInterventionDecision(tenantScope(ctx), input.sessionId, input.interventionIndex, input.teacherDecision);
    }),
    /** The child's device reporting that a reading it completed was not saved. Without this a
     *  failed save leaves no trace anywhere a teacher can see it. */
    recordUnrecordedAttempt: protectedProcedure.input(z.object({
      childProfileId: z.number().int().positive(),
      materialId: z.number().int().positive().nullable().optional(),
      storyTitle: z.string().min(1).max(180),
      reason: z.enum(unrecordedAttemptReasonValues),
      detail: z.string().max(400).optional(),
      durationSeconds: z.number().int().min(0).max(86_400).optional(),
    })).mutation(async ({ ctx, input }) => {
      const allowed = await mayAccessChildProfile(tenantScope(ctx), { id: ctx.user.id, role: ctx.user.role }, input.childProfileId);
      if (!allowed || ctx.user.role !== "child") throw new TRPCError({ code: "FORBIDDEN", message: "Only the signed-in child can report an unsaved reading." });
      return recordUnrecordedReadingAttempt(tenantScope(ctx), input);
    }),
    acknowledgeUnrecordedAttempt: protectedProcedure.input(z.object({ attemptId: sessionIdInput })).mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "teacher" && ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Only a teacher can clear an unsaved reading from the review list." });
      return acknowledgeUnrecordedReadingAttempt(tenantScope(ctx), ctx.user.id, input.attemptId);
    }),
    childProgress: protectedProcedure.input(z.object({ childProfileId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const allowed = await mayAccessChildProfile(tenantScope(ctx), { id: ctx.user.id, role: ctx.user.role }, input.childProfileId);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "This child profile is not available to your account." });
      const progress = await getChildProgress(tenantScope(ctx), input.childProfileId);
      return progressForAudience(progress, audienceForRole(ctx.user.role));
    }),
    audioUrl: protectedProcedure.input(z.object({ sessionId: sessionIdInput })).query(async ({ ctx, input }) => {
      const playback = await getSessionPlayback(tenantScope(ctx), input.sessionId);
      const session = playback?.session;
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "This saved reading session is no longer available." });
      if (!session.audioStorageKey) throw new TRPCError({ code: "NOT_FOUND", message: `${audioAbsenceSummary(session.audioStatus)}. The saved transcript and word states are still available for review.` });
      const allowed = await mayAccessChildProfile(tenantScope(ctx), { id: ctx.user.id, role: ctx.user.role }, session.childProfileId);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "This recording is not available to your account." });
      const audio = await storageGet(session.audioStorageKey);
      return { ...audio, transcript: session.transcript, wordTimings: playback.wordTimings };
    }),
    comments: protectedProcedure.input(z.object({ sessionId: sessionIdInput })).query(async ({ ctx, input }) => {
      const session = await getSessionById(tenantScope(ctx), input.sessionId);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Reading session not found." });
      const allowed = await mayAccessChildProfile(tenantScope(ctx), { id: ctx.user.id, role: ctx.user.role }, session.childProfileId);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "This session is not available to your account." });
      return getSessionComments(tenantScope(ctx), [input.sessionId]);
    }),
    addComment: protectedProcedure.input(z.object({ sessionId: sessionIdInput, comment: z.string().trim().min(2).max(1200) })).mutation(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      const session = await getSessionById(tenantScope(ctx), input.sessionId);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Reading session not found." });
      const allowed = await mayAccessChildProfile(tenantScope(ctx), { id: ctx.user.id, role: ctx.user.role }, session.childProfileId);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "This child is not assigned to your class." });
      return addSessionComment(tenantScope(ctx), { sessionId: input.sessionId, teacherUserId: ctx.user.id, comment: input.comment });
    }),
  }),
  learners: router({
    settings: protectedProcedure.input(z.object({ childProfileId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const allowed = await mayAccessChildProfile(tenantScope(ctx), { id: ctx.user.id, role: ctx.user.role }, input.childProfileId);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "This learner is not available to your account." });
      return getLearnerReadingSettings(tenantScope(ctx), input.childProfileId);
    }),
    saveSettings: protectedProcedure.input(z.object({ childProfileId: z.number().int().positive(), defaultReadingMode: assessmentModeSchema, targetWcpm: z.number().int().min(30).max(250), languageSupport: languageSupportSchema.default("STANDARD_ENGLISH") })).mutation(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      const allowed = await mayAccessChildProfile(tenantScope(ctx), { id: ctx.user.id, role: ctx.user.role }, input.childProfileId);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "This learner is not assigned to your class." });
      return saveLearnerReadingSettings(tenantScope(ctx), input.childProfileId, { defaultReadingMode: input.defaultReadingMode, targetWcpm: input.targetWcpm, languageSupport: input.languageSupport });
    }),
  }),
  weeklyGoals: router({
    save: protectedProcedure.input(weeklyGoalSchema).mutation(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      return saveWeeklyReadingGoal(tenantScope(ctx), ctx.user.id, input);
    }),
  }),
  classes: router({
    create: protectedProcedure.input(z.object({ name: z.string().trim().min(2).max(120) })).mutation(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      return createAdditionalClassForTeacher(tenantScope(ctx), ctx.user.id, input.name, code("CLASS"));
    }),
    addLearner: protectedProcedure.input(z.object({ classId: z.number().int().positive(), displayName: z.string().trim().min(2).max(80), bookBand: z.string().trim().min(2).max(80) })).mutation(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      return addLearnerToTeacherClass(tenantScope(ctx), { teacherUserId: ctx.user.id, ...input, familyCode: code("FAM") });
    }),
    importLearners: protectedProcedure.input(z.object({ classId: z.number().int().positive(), rows: z.array(z.object({ row: z.number().int().min(2).max(101), displayName: z.string().trim().min(1).max(80), bookBand: z.string().trim().min(2).max(80).optional() })).min(1).max(100) })).mutation(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      return addLearnersToTeacherClass(tenantScope(ctx), { teacherUserId: ctx.user.id, classId: input.classId, rows: input.rows, createFamilyCode: () => code("FAM") });
    }),
    saveLanguageSupportDefault: protectedProcedure.input(z.object({ classId: z.number().int().positive(), languageSupport: languageSupportSchema })).mutation(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      return saveClassLanguageSupportDefault(tenantScope(ctx), ctx.user.id, input.classId, input.languageSupport);
    }),
  }),
  irishVariants: router({
    list: protectedProcedure.input(z.object({ classId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      return listEducatorApprovedIrishVariants(tenantScope(ctx), ctx.user.id, input.classId);
    }),
    approve: protectedProcedure.input(z.object({ classId: z.number().int().positive(), expectedWord: z.string().trim().min(1).max(80), recognisedVariant: z.string().trim().min(1).max(80) })).mutation(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      return approveIrishVariantForClass(tenantScope(ctx), { teacherUserId: ctx.user.id, ...input });
    }),
    remove: protectedProcedure.input(z.object({ variantId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      return deleteEducatorApprovedIrishVariant(tenantScope(ctx), ctx.user.id, input.variantId);
    }),
    confirmMatch: protectedProcedure.input(z.object({ reviewId: sessionIdInput })).mutation(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      return confirmProvisionalMatchReview(tenantScope(ctx), ctx.user.id, input.reviewId);
    }),
    csv: protectedProcedure.input(z.object({ classId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      const exportData = await getTeacherIrishVariantExport(tenantScope(ctx), ctx.user.id, input.classId);
      return { filename: irishVariantFilename(exportData.className), csv: createIrishVariantCsv(exportData.className, exportData.variants) };
    }),
    pendingMatches: protectedProcedure.input(z.object({ classId: z.number().int().positive().optional(), childProfileId: z.number().int().positive().optional(), range: trendDateRangeSchema }).refine(input => !input.range?.startDate || !input.range?.endDate || input.range.startDate <= input.range.endDate, { message: "Choose an end date on or after the start date." })).query(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      return listTeacherProvisionalMatches(tenantScope(ctx), ctx.user.id, { classId: input.classId, childProfileId: input.childProfileId, ...input.range });
    }),
  }),
  termPresets: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      requireTeacher(ctx.user.role);
      return listTeacherTermPresets(tenantScope(ctx), ctx.user.id);
    }),
    save: protectedProcedure.input(termPresetSchema).mutation(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      return saveTeacherTermPreset(tenantScope(ctx), ctx.user.id, input);
    }),
    remove: protectedProcedure.input(z.object({ presetId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      return deleteTeacherTermPreset(tenantScope(ctx), ctx.user.id, input.presetId);
    }),
  }),
  homePractice: router({
    saveChecklist: protectedProcedure.input(z.object({ childProfileId: z.number().int().positive(), completedSteps: z.array(z.boolean()).max(3) })).mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "parent") throw new TRPCError({ code: "FORBIDDEN", message: "Home-practice checklists are available to linked parent accounts." });
      const allowed = await mayAccessChildProfile(tenantScope(ctx), { id: ctx.user.id, role: ctx.user.role }, input.childProfileId);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "This learner is not linked to your family account." });
      return saveHomePracticeChecklist(tenantScope(ctx), ctx.user.id, input.childProfileId, input.completedSteps);
    }),
    markReminderRead: protectedProcedure.input(z.object({ reminderId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "parent") throw new TRPCError({ code: "FORBIDDEN", message: "This reminder centre is available to parent accounts." });
      await markParentReminderRead(tenantScope(ctx), ctx.user.id, input.reminderId);
      return { success: true } as const;
    }),
    markAllRemindersRead: protectedProcedure.mutation(async ({ ctx }) => {
      if (ctx.user.role !== "parent") throw new TRPCError({ code: "FORBIDDEN", message: "This reminder centre is available to parent accounts." });
      return markAllParentRemindersRead(tenantScope(ctx), ctx.user.id);
    }),
    reminders: protectedProcedure.input(z.object({ childProfileId: z.number().int().positive().optional(), range: trendDateRangeSchema })).query(async ({ ctx, input }) => {
      if (ctx.user.role !== "parent") throw new TRPCError({ code: "FORBIDDEN", message: "This reminder centre is available to parent accounts." });
      if (input.childProfileId && !(await mayAccessChildProfile(tenantScope(ctx), { id: ctx.user.id, role: ctx.user.role }, input.childProfileId))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This learner is not linked to your family account." });
      }
      return listParentReminders(tenantScope(ctx), ctx.user.id, { childProfileId: input.childProfileId, ...input.range });
    }),
  }),
  quizzes: router({
    forAssignedMaterial: protectedProcedure.input(z.object({ materialId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      if (ctx.user.role !== "child") throw new TRPCError({ code: "FORBIDDEN", message: "Quizzes are available to child accounts." });
      const material = await getAssignedMaterialForChild(tenantScope(ctx), ctx.user.id, input.materialId);
      if (!material?.exerciseSet) throw new TRPCError({ code: "NOT_FOUND", message: "There is no approved quiz for this reading passage yet." });
      return { materialId: material.id, title: material.title, activity: material.exerciseSet.activity, questions: material.exerciseSet.questions.map(question => ({ prompt: question.prompt, options: question.options })) };
    }),
    submit: protectedProcedure.input(z.object({
      childProfileId: z.number().int().positive(),
      materialId: z.number().int().positive(),
      answers: z.array(z.object({ questionIndex: z.number().int().min(0), selectedAnswer: z.string().min(1).max(120) })).min(1).max(4),
    })).mutation(async ({ ctx, input }) => {
      const allowed = await mayAccessChildProfile(tenantScope(ctx), { id: ctx.user.id, role: ctx.user.role }, input.childProfileId);
      if (!allowed || ctx.user.role !== "child") throw new TRPCError({ code: "FORBIDDEN", message: "Only the signed-in child can submit this quiz." });
      const material = await getAssignedMaterialForChild(tenantScope(ctx), ctx.user.id, input.materialId);
      if (!material?.exerciseSet) throw new TRPCError({ code: "NOT_FOUND", message: "This assigned passage does not have an approved quiz." });
      const answers = scoreQuiz(material.exerciseSet.questions, input.answers);
      const score = answers.filter(answer => answer.correct).length;
      const attempt = await saveQuizAttempt(tenantScope(ctx), { childProfileId: input.childProfileId, materialId: input.materialId, answers, score, totalQuestions: material.exerciseSet.questions.length });
      return { attempt, score, totalQuestions: material.exerciseSet.questions.length, explanations: material.exerciseSet.questions.map((question, index) => ({ questionIndex: index, explanation: question.explanation })) };
    }),
    history: protectedProcedure.input(z.object({ childProfileId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const allowed = await mayAccessChildProfile(tenantScope(ctx), { id: ctx.user.id, role: ctx.user.role }, input.childProfileId);
      if (!allowed || ctx.user.role !== "child") throw new TRPCError({ code: "FORBIDDEN", message: "Quiz history is available to the signed-in child." });
      return getQuizHistory(tenantScope(ctx), input.childProfileId);
    }),
  }),
  reports: router({
    monthlyTrend: protectedProcedure.input(z.object({ classId: z.number().int().positive().optional(), range: trendDateRangeSchema })).query(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      return getTeacherMonthlyTrendExport(tenantScope(ctx), ctx.user.id, input.classId, input.range);
    }),
    monthlyTrendCsv: protectedProcedure.input(z.object({ classId: z.number().int().positive().optional(), range: trendDateRangeSchema })).query(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      const trend = await getTeacherMonthlyTrendExport(tenantScope(ctx), ctx.user.id, input.classId, input.range);
      return { filename: monthlyTrendFilename(trend.className, input.range), csv: createMonthlyTrendCsv(trend.className, trend.points) };
    }),
    classVariationReviewPdf: protectedProcedure.input(z.object({ classId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      const review = await getTeacherClassVariationReview(tenantScope(ctx), ctx.user.id, input.classId);
      const data = await createClassVariationReviewPdf({ className: review.readerClass.name, branding: review.branding, variants: review.variants, reviews: review.reviews });
      return { filename: `${review.readerClass.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-class-variation-review.pdf`, mimeType: "application/pdf", dataBase64: data.toString("base64") };
    }),
    download: protectedProcedure.input(z.object({ childProfileId: z.number().int().positive(), audience: z.enum(["child", "parent", "teacher"]) })).query(async ({ ctx, input }) => {
      const allowed = await mayAccessChildProfile(tenantScope(ctx), { id: ctx.user.id, role: ctx.user.role }, input.childProfileId);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "This report is not available to your account." });
      if (input.audience === "child" && ctx.user.role !== "child") throw new TRPCError({ code: "FORBIDDEN", message: "Use the report designed for your account." });
      if (input.audience === "parent" && ctx.user.role !== "parent") throw new TRPCError({ code: "FORBIDDEN", message: "Use the report designed for your account." });
      if (input.audience === "teacher" && !isTeacher(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Use the report designed for your account." });
      const progress = await getChildProgress(tenantScope(ctx), input.childProfileId);
      return createReadingReport({ audience: input.audience, childName: progress.profile.displayName, bookBand: progress.profile.bookBand, sessions: progress.sessions });
    }),
    downloadPdf: protectedProcedure.input(z.object({ childProfileId: z.number().int().positive(), audience: z.enum(["child", "parent", "teacher"]) })).query(async ({ ctx, input }) => {
      const allowed = await mayAccessChildProfile(tenantScope(ctx), { id: ctx.user.id, role: ctx.user.role }, input.childProfileId);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "This report is not available to your account." });
      if (input.audience === "child" && ctx.user.role !== "child") throw new TRPCError({ code: "FORBIDDEN", message: "Use the report designed for your account." });
      if (input.audience === "parent" && ctx.user.role !== "parent") throw new TRPCError({ code: "FORBIDDEN", message: "Use the report designed for your account." });
      if (input.audience === "teacher" && !isTeacher(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Use the report designed for your account." });
      const context = await getReportContext(tenantScope(ctx), input.childProfileId);
      const data = await createBrandedPdfReport({ audience: input.audience, childName: context.profile.displayName, bookBand: context.profile.bookBand, sessions: context.sessions, branding: context.branding, comments: context.comments });
      return { filename: `${context.profile.displayName.toLowerCase().replace(/\s+/g, "-")}-${input.audience}-reading-report.pdf`, mimeType: "application/pdf", dataBase64: data.toString("base64") };
    }),
  }),
  branding: router({
    mine: protectedProcedure.query(async ({ ctx }) => { requireTeacher(ctx.user.role); return getSchoolBrandingForTeacher(tenantScope(ctx), ctx.user.id); }),
    save: protectedProcedure.input(z.object({ schoolName: z.string().trim().min(2).max(120), accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), footerLine: z.string().trim().min(4).max(180) })).mutation(async ({ ctx, input }) => {
      requireTeacher(ctx.user.role);
      return saveSchoolBranding(tenantScope(ctx), ctx.user.id, input);
    }),
  }),
  dashboards: router({
    teacher: protectedProcedure.query(async ({ ctx }) => {
      requireTeacher(ctx.user.role);
      return getTeacherDashboard(tenantScope(ctx), ctx.user.id);
    }),
    accentFairness: protectedProcedure.query(async ({ ctx }) => {
      requireTeacher(ctx.user.role);
      return getAccentFairnessSummary(await listSessionsForAccentFairness(tenantScope(ctx)));
    }),
    parent: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "parent" && ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "This dashboard is available to parent accounts." });
      return getParentDashboard(tenantScope(ctx), ctx.user.id);
    }),
  }),
  demo: router({
    seedCohort: protectedProcedure.mutation(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Only an administrator can create the guided demo cohort." });
      return seedDemoCohort(tenantScope(ctx), ctx.user.id);
    }),
  }),
});
