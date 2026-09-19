import { sql } from "drizzle-orm";
import { check, decimal, int, json, mysqlEnum, mysqlTable, text, timestamp, unique, varchar } from "drizzle-orm/mysql-core";

export const accountRoleValues = ["user", "admin", "child", "teacher", "parent"] as const;
export type AccountRole = (typeof accountRoleValues)[number];
export const assessmentModeValues = ["GUIDED_PRACTICE", "ASSISTED_PRACTICE", "MONTHLY_ASSESSMENT"] as const;
export type AssessmentMode = (typeof assessmentModeValues)[number];
export const readingLanguageSupportValues = ["STANDARD_ENGLISH", "IRISH_ENGLISH_SUPPORT"] as const;
export type ReadingLanguageSupport = (typeof readingLanguageSupportValues)[number];
export const materialRightsSourceValues = ["original", "public_domain", "permission_obtained"] as const;
export type MaterialRightsSource = (typeof materialRightsSourceValues)[number];
export const materialLifecycleValues = ["draft", "teacher_approved", "assignable"] as const;
export type MaterialLifecycle = (typeof materialLifecycleValues)[number];

/** The school is the data controller; Reader Leader is the processor. Every tenant-scoped
 *  row hangs off one school so that erasing a school is a single delete per table. */
export const schools = mysqlTable("schools", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  slug: varchar("slug", { length: 80 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Core identity managed by Manus OAuth. Roles are assigned through the Reader Leader onboarding flow. */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  /** Null only for a break-glass support account with no standing school
   *  membership. A null school yields no tenant scope, so tenant queries reject it. */
  schoolId: int("schoolId").references(() => schools.id, { onDelete: "cascade" }),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", accountRoleValues).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const readerClasses = mysqlTable("readerClasses", {
  id: int("id").autoincrement().primaryKey(),
  schoolId: int("schoolId").notNull().references(() => schools.id, { onDelete: "cascade" }),
  teacherUserId: int("teacherUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  joinCode: varchar("joinCode", { length: 12 }).notNull().unique(),
  defaultLanguageSupport: mysqlEnum("defaultLanguageSupport", readingLanguageSupportValues).notNull().default("STANDARD_ENGLISH"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/** Teacher-approved transcript variants apply to one of their Irish English-enabled classes. */
export const educatorApprovedIrishVariants = mysqlTable("educatorApprovedIrishVariants", {
  id: int("id").autoincrement().primaryKey(),
  schoolId: int("schoolId").notNull().references(() => schools.id, { onDelete: "cascade" }),
  teacherUserId: int("teacherUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  classId: int("classId").notNull().references(() => readerClasses.id, { onDelete: "cascade" }),
  expectedWord: varchar("expectedWord", { length: 80 }).notNull(),
  recognisedVariant: varchar("recognisedVariant", { length: 80 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [unique("approved_irish_variant_unique").on(table.classId, table.expectedWord, table.recognisedVariant)]);

/** A reusable, teacher-owned assessment-reporting range. Dates are stored as ISO calendar days. */
export const teacherTermPresets = mysqlTable("teacherTermPresets", {
  id: int("id").autoincrement().primaryKey(),
  schoolId: int("schoolId").notNull().references(() => schools.id, { onDelete: "cascade" }),
  teacherUserId: int("teacherUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 80 }).notNull(),
  startDate: varchar("startDate", { length: 10 }).notNull(),
  endDate: varchar("endDate", { length: 10 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [unique("teacher_term_preset_name_unique").on(table.teacherUserId, table.name)]);

/** Presentation only. `schoolName` is a legacy per-teacher copy kept so the demo-visible PDF
 *  report header keeps working; `schools.name` is authoritative and new code must read that.
 *  Folding this column into `schools` is a separate change. */
export const schoolBranding = mysqlTable("schoolBranding", {
  id: int("id").autoincrement().primaryKey(),
  schoolId: int("schoolId").notNull().references(() => schools.id, { onDelete: "cascade" }),
  teacherUserId: int("teacherUserId").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  schoolName: varchar("schoolName", { length: 120 }).notNull().default("Reader Leader School"),
  accentColor: varchar("accentColor", { length: 12 }).notNull().default("#2563EB"),
  footerLine: varchar("footerLine", { length: 180 }).notNull().default("Every reader can grow with practice and encouragement."),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const childProfiles = mysqlTable("childProfiles", {
  id: int("id").autoincrement().primaryKey(),
  schoolId: int("schoolId").notNull().references(() => schools.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  displayName: varchar("displayName", { length: 80 }).notNull(),
  bookBand: varchar("bookBand", { length: 80 }).notNull().default("Level 3 · Sky Blue"),
  familyCode: varchar("familyCode", { length: 12 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Teacher-configured defaults and supportive pace target for one learner. */
export const learnerReadingSettings = mysqlTable("learnerReadingSettings", {
  id: int("id").autoincrement().primaryKey(),
  schoolId: int("schoolId").notNull().references(() => schools.id, { onDelete: "cascade" }),
  childProfileId: int("childProfileId").notNull().unique().references(() => childProfiles.id, { onDelete: "cascade" }),
  defaultReadingMode: mysqlEnum("defaultReadingMode", assessmentModeValues).notNull().default("ASSISTED_PRACTICE"),
  targetWcpm: int("targetWcpm").notNull().default(100),
  languageSupport: mysqlEnum("languageSupport", readingLanguageSupportValues).notNull().default("STANDARD_ENGLISH"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** A teacher-owned weekly reading target for one learner. Progress is derived from saved sessions. */
export const weeklyReadingGoals = mysqlTable("weeklyReadingGoals", {
  id: int("id").autoincrement().primaryKey(),
  schoolId: int("schoolId").notNull().references(() => schools.id, { onDelete: "cascade" }),
  teacherUserId: int("teacherUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  childProfileId: int("childProfileId").notNull().references(() => childProfiles.id, { onDelete: "cascade" }),
  weekStart: varchar("weekStart", { length: 10 }).notNull(),
  targetMinutes: int("targetMinutes").notNull().default(20),
  targetSessions: int("targetSessions").notNull().default(3),
  note: varchar("note", { length: 240 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [unique("teacher_child_week_goal_unique").on(table.teacherUserId, table.childProfileId, table.weekStart)]);

export const classEnrollments = mysqlTable("classEnrollments", {
  id: int("id").autoincrement().primaryKey(),
  schoolId: int("schoolId").notNull().references(() => schools.id, { onDelete: "cascade" }),
  classId: int("classId").notNull().references(() => readerClasses.id, { onDelete: "cascade" }),
  childProfileId: int("childProfileId").notNull().references(() => childProfiles.id, { onDelete: "cascade" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [unique("class_child_unique").on(table.classId, table.childProfileId)]);

export const familyLinks = mysqlTable("familyLinks", {
  id: int("id").autoincrement().primaryKey(),
  schoolId: int("schoolId").notNull().references(() => schools.id, { onDelete: "cascade" }),
  parentUserId: int("parentUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  childProfileId: int("childProfileId").notNull().references(() => childProfiles.id, { onDelete: "cascade" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [unique("parent_child_unique").on(table.parentUserId, table.childProfileId)]);

/** One parent-managed, three-step home-practice checklist per linked learner and UTC calendar day. */
export const homePracticeChecklists = mysqlTable("homePracticeChecklists", {
  id: int("id").autoincrement().primaryKey(),
  schoolId: int("schoolId").notNull().references(() => schools.id, { onDelete: "cascade" }),
  parentUserId: int("parentUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  childProfileId: int("childProfileId").notNull().references(() => childProfiles.id, { onDelete: "cascade" }),
  checklistDate: varchar("checklistDate", { length: 10 }).notNull(),
  completedSteps: json("completedSteps").$type<boolean[]>().notNull(),
  completedAt: timestamp("completedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [unique("parent_child_practice_date_unique").on(table.parentUserId, table.childProfileId, table.checklistDate)]);

/** An in-app notification is created once when a linked parent completes a learner's daily checklist. */
export const parentReminders = mysqlTable("parentReminders", {
  id: int("id").autoincrement().primaryKey(),
  schoolId: int("schoolId").notNull().references(() => schools.id, { onDelete: "cascade" }),
  parentUserId: int("parentUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  childProfileId: int("childProfileId").notNull().references(() => childProfiles.id, { onDelete: "cascade" }),
  checklistId: int("checklistId").notNull().unique().references(() => homePracticeChecklists.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 160 }).notNull(),
  message: varchar("message", { length: 360 }).notNull(),
  status: mysqlEnum("status", ["unread", "read"]).notNull().default("unread"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  readAt: timestamp("readAt"),
});

export const readingMaterials = mysqlTable("readingMaterials", {
  id: int("id").autoincrement().primaryKey(),
  schoolId: int("schoolId").notNull().references(() => schools.id, { onDelete: "cascade" }),
  teacherUserId: int("teacherUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 180 }).notNull(),
  readingLevel: varchar("readingLevel", { length: 80 }).notNull(),
  summary: text("summary"),
  sourceText: text("sourceText").notNull(),
  sourceFilename: varchar("sourceFilename", { length: 255 }),
  storageKey: varchar("storageKey", { length: 512 }),
  status: mysqlEnum("status", ["draft", "assigned"]).default("draft").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Breadth-layer metadata and approval state for teacher-contributed texts. */
export const readingMaterialDetails = mysqlTable("readingMaterialDetails", {
  id: int("id").autoincrement().primaryKey(),
  schoolId: int("schoolId").notNull().references(() => schools.id, { onDelete: "cascade" }),
  materialId: int("materialId").notNull().unique().references(() => readingMaterials.id, { onDelete: "cascade" }),
  author: varchar("author", { length: 180 }).notNull(),
  rightsSource: mysqlEnum("rightsSource", materialRightsSourceValues).notNull(),
  interestAge: varchar("interestAge", { length: 80 }).notNull(),
  genre: varchar("genre", { length: 80 }).notNull(),
  lifecycleStatus: mysqlEnum("lifecycleStatus", materialLifecycleValues).default("draft").notNull(),
  approvedByUserId: int("approvedByUserId").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approvedAt"),
  assignableAt: timestamp("assignableAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ExerciseQuestion = { prompt: string; options: string[]; answer: string; explanation: string };
export type ExerciseSet = { vocabulary: { word: string; childFriendlyMeaning: string }[]; questions: ExerciseQuestion[]; activity: string };

export const readingExercises = mysqlTable("readingExercises", {
  id: int("id").autoincrement().primaryKey(),
  schoolId: int("schoolId").notNull().references(() => schools.id, { onDelete: "cascade" }),
  materialId: int("materialId").notNull().unique().references(() => readingMaterials.id, { onDelete: "cascade" }),
  exerciseSet: json("exerciseSet").$type<ExerciseSet>().notNull(),
  modelName: varchar("modelName", { length: 80 }).notNull(),
  approvedAt: timestamp("approvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const materialAssignments = mysqlTable("materialAssignments", {
  id: int("id").autoincrement().primaryKey(),
  schoolId: int("schoolId").notNull().references(() => schools.id, { onDelete: "cascade" }),
  classId: int("classId").notNull().references(() => readerClasses.id, { onDelete: "cascade" }),
  materialId: int("materialId").notNull().references(() => readingMaterials.id, { onDelete: "cascade" }),
  assignedAt: timestamp("assignedAt").defaultNow().notNull(),
}, table => [unique("assigned_material_class_unique").on(table.classId, table.materialId)]);

export type StoredIntervention = { word: string; action: "prompt" | "model" | "stay_silent" | "teacher_review"; note: string; eventType?: "correct" | "dialect_variation" | "substitution" | "omission" | "insertion" | "repetition"; heardWord?: string; provisionalIrishEnglish?: boolean; teacherDecision?: string };
export type StoredWordState = { id: string; text: string; status: "unread" | "current" | "correct" | "incorrect" | "retried_correct"; attempts: number };
export type StoredWordTiming = { id: string; text: string; startMs: number; endMs: number };

export const captureTimeSourceValues = ["device", "server"] as const;
export type CaptureTimeSource = (typeof captureTimeSourceValues)[number];

/** Why a session has, or does not have, a stored recording. A session is valid without its
 *  audio: audio is scored and discarded in the same request, so a null key is the ordinary
 *  case. The status says which kind of null it is, so a null is never mistaken for a bug.
 *
 *  "discarded_by_policy" is the success case, not an absence: it is the retention commitment
 *  the school-facing data protection summary makes, and it is what turns that commitment from
 *  a claim into a queryable fact — the distribution of these statuses across a term is the
 *  evidence. It is deliberately separate from "not_captured", which means nothing was ever
 *  sent, and from the two storage statuses, which mean something went wrong. */
export const audioRetentionStatusValues = ["stored", "discarded_by_policy", "storage_unavailable", "storage_rejected", "not_captured"] as const;
export type AudioRetentionStatus = (typeof audioRetentionStatusValues)[number];

/**
 * `id` is a ULID generated where the reading happens, not by the database — see
 * shared/sessionId.ts. `capturedAt` is the classroom tablet's own clock as reported, kept
 * alongside the server's `createdAt`; `capturedAtSource` records which of the two is
 * authoritative when they disagree. See shared/captureTime.ts.
 */
export const readingSessions = mysqlTable("readingSessions", {
  id: varchar("id", { length: 26 }).primaryKey(),
  schoolId: int("schoolId").notNull().references(() => schools.id, { onDelete: "cascade" }),
  childProfileId: int("childProfileId").notNull().references(() => childProfiles.id, { onDelete: "cascade" }),
  materialId: int("materialId").references(() => readingMaterials.id, { onDelete: "set null" }),
  storyTitle: varchar("storyTitle", { length: 180 }).notNull(),
  transcript: text("transcript").notNull(),
  accuracy: int("accuracy").notNull(),
  wordsCorrectPerMinute: int("wordsCorrectPerMinute").notNull(),
  durationSeconds: int("durationSeconds").notNull(),
  audioStorageKey: varchar("audioStorageKey", { length: 512 }),
  /** Always set. "stored" iff audioStorageKey is non-null; otherwise the reason it is null. */
  audioStatus: mysqlEnum("audioStatus", audioRetentionStatusValues).notNull().default("not_captured"),
  completed: int("completed").notNull().default(1),
  assessmentMode: mysqlEnum("assessmentMode", assessmentModeValues).notNull().default("ASSISTED_PRACTICE"),
  languageSupport: mysqlEnum("languageSupport", readingLanguageSupportValues).notNull().default("STANDARD_ENGLISH"),
  practiceWords: json("practiceWords").$type<string[]>().notNull(),
  interventions: json("interventions").$type<StoredIntervention[]>().notNull(),
  wordStates: json("wordStates").$type<StoredWordState[]>().notNull(),
  wordTimings: json("wordTimings").$type<StoredWordTiming[]>(),
  /** The device's clock as reported. Null when the device supplied none; never overwritten. */
  capturedAt: timestamp("capturedAt"),
  capturedAtSource: mysqlEnum("capturedAtSource", captureTimeSourceValues).notNull().default("server"),
  /** The server's clock. Authoritative whenever capturedAtSource is "server". */
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/** Each Irish English provisional transcript match remains confirmable by an authorised teacher. */
export const provisionalMatchReviews = mysqlTable("provisionalMatchReviews", {
  id: varchar("id", { length: 26 }).primaryKey(),
  schoolId: int("schoolId").notNull().references(() => schools.id, { onDelete: "cascade" }),
  sessionId: varchar("sessionId", { length: 26 }).notNull().references(() => readingSessions.id, { onDelete: "cascade" }),
  childProfileId: int("childProfileId").notNull().references(() => childProfiles.id, { onDelete: "cascade" }),
  classId: int("classId").references(() => readerClasses.id, { onDelete: "set null" }),
  expectedWord: varchar("expectedWord", { length: 80 }).notNull(),
  recognisedWord: varchar("recognisedWord", { length: 80 }).notNull(),
  source: mysqlEnum("source", ["built_in", "educator_approved"]).notNull().default("built_in"),
  status: mysqlEnum("status", ["pending", "confirmed", "dismissed"]).notNull().default("pending"),
  confirmedByTeacherId: int("confirmedByTeacherId").references(() => users.id, { onDelete: "set null" }),
  confirmedAt: timestamp("confirmedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const sessionComments = mysqlTable("sessionComments", {
  id: varchar("id", { length: 26 }).primaryKey(),
  schoolId: int("schoolId").notNull().references(() => schools.id, { onDelete: "cascade" }),
  sessionId: varchar("sessionId", { length: 26 }).notNull().references(() => readingSessions.id, { onDelete: "cascade" }),
  teacherUserId: int("teacherUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  comment: text("comment").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});


export const wordProgressValues = ["unread", "current", "correct", "incorrect", "retried_correct"] as const;
export type WordProgress = (typeof wordProgressValues)[number];

/** Mirrors evidence_bundles.event_type in the governance repo, lowercased for this codebase. */
export const wordJudgementValues = ["correct", "substitution", "omission", "insertion", "repetition", "self_correction", "hesitation", "uncertain"] as const;
export type WordJudgement = (typeof wordJudgementValues)[number];

export const wordResolutionValues = ["auto", "teacher_confirmed", "teacher_overridden", "unreviewed"] as const;
export type WordResolution = (typeof wordResolutionValues)[number];

/** Mirrors evidence_bundles.pronunciation_context. */
export const pronunciationContextValues = ["valid_regional_variant", "not_matched", "uncertain"] as const;
export type PronunciationContext = (typeof pronunciationContextValues)[number];

/**
 * One row per word of reading opportunity, written at session save.
 *
 * Three independent state fields, because one column cannot represent an override honestly:
 * `progress` is what the child did, `judgement` is what the system concluded, `resolution` is
 * who settled it. Whether a word counts against a score is DERIVED from judgement and
 * resolution by countsAgainstScore() in shared/readingWordScore.ts — never stored. A stored
 * flag is how an override and the displayed accuracy drift apart.
 *
 * Four confidence scores rather than one blended number: a word flagged because the
 * microphone was poor and a word flagged because the child misread it are different events,
 * and telling them apart is the whole fairness argument. Each is null when the pipeline
 * cannot supply it; none is invented.
 *
 * Field names follow evidence_bundles in the reader-leader-tech-ireland governance repo
 * (Postgres/Supabase) so the two reconcile without a translation layer. Divergences, both
 * deliberate: `heardWord` is that repo's `observed_form`, kept because the existing JSON
 * columns and the matcher already use heardWord; and the confidences are nullable here
 * because this pipeline cannot yet supply them, where that repo requires them.
 */
export const readingWords = mysqlTable("readingWords", {
  id: varchar("id", { length: 26 }).primaryKey(),
  schoolId: int("schoolId").notNull().references(() => schools.id, { onDelete: "cascade" }),
  sessionId: varchar("sessionId", { length: 26 }).notNull().references(() => readingSessions.id, { onDelete: "cascade" }),
  /** Stable identifier for this word within its session. */
  wordEventId: varchar("wordEventId", { length: 64 }).notNull(),
  /** Position in the passage, from zero. Fixes reading order independently of insertion order. */
  tokenIndex: int("tokenIndex").notNull(),
  /** The word the child was meant to read. */
  referenceWord: varchar("referenceWord", { length: 120 }).notNull(),
  /** What was heard instead, when that differs. `observed_form` in the governance repo. */
  heardWord: varchar("heardWord", { length: 120 }),

  progress: mysqlEnum("progress", wordProgressValues).notNull(),
  judgement: mysqlEnum("judgement", wordJudgementValues).notNull(),
  resolution: mysqlEnum("resolution", wordResolutionValues).notNull().default("unreviewed"),

  audioConfidence: decimal("audioConfidence", { precision: 4, scale: 3 }),
  alignmentConfidence: decimal("alignmentConfidence", { precision: 4, scale: 3 }),
  lexicalConfidence: decimal("lexicalConfidence", { precision: 4, scale: 3 }),
  pronunciationConfidence: decimal("pronunciationConfidence", { precision: 4, scale: 3 }),
  pronunciationContext: mysqlEnum("pronunciationContext", pronunciationContextValues).notNull().default("uncertain"),

  attempts: int("attempts").notNull().default(0),
  startMs: int("startMs"),
  endMs: int("endMs"),
  /** The dialect rule that explained this reading, e.g. TH-stopping. Never a label on a child. */
  dialectFeature: varchar("dialectFeature", { length: 80 }),
  source: varchar("source", { length: 40 }).notNull().default("built_in"),

  provider: varchar("provider", { length: 80 }).notNull(),
  providerVersion: varchar("providerVersion", { length: 80 }).notNull(),
  policyVersion: varchar("policyVersion", { length: 80 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
  unique("reading_word_event_unique").on(table.sessionId, table.wordEventId),
  unique("reading_word_token_unique").on(table.sessionId, table.tokenIndex),
  check("reading_word_audio_confidence_range", sql`${table.audioConfidence} is null or ${table.audioConfidence} between 0 and 1`),
  check("reading_word_alignment_confidence_range", sql`${table.alignmentConfidence} is null or ${table.alignmentConfidence} between 0 and 1`),
  check("reading_word_lexical_confidence_range", sql`${table.lexicalConfidence} is null or ${table.lexicalConfidence} between 0 and 1`),
  check("reading_word_pronunciation_confidence_range", sql`${table.pronunciationConfidence} is null or ${table.pronunciationConfidence} between 0 and 1`),
  check("reading_word_token_index_range", sql`${table.tokenIndex} >= 0`),
]);

export type ReadingWord = typeof readingWords.$inferSelect;

export type QuizAnswer = { questionIndex: number; selectedAnswer: string; correct: boolean };

export const quizAttempts = mysqlTable("quizAttempts", {
  id: int("id").autoincrement().primaryKey(),
  schoolId: int("schoolId").notNull().references(() => schools.id, { onDelete: "cascade" }),
  childProfileId: int("childProfileId").notNull().references(() => childProfiles.id, { onDelete: "cascade" }),
  materialId: int("materialId").notNull().references(() => readingMaterials.id, { onDelete: "cascade" }),
  answers: json("answers").$type<QuizAnswer[]>().notNull(),
  score: int("score").notNull(),
  totalQuestions: int("totalQuestions").notNull(),
  completedAt: timestamp("completedAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type ReadingMaterial = typeof readingMaterials.$inferSelect;
export type ReadingMaterialDetails = typeof readingMaterialDetails.$inferSelect;
export type ReadingSession = typeof readingSessions.$inferSelect;
export type School = typeof schools.$inferSelect;
