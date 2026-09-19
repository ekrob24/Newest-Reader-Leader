/**
 * Builds the exercise-generation request, and is the only place allowed to decide what leaves
 * this system for the LLM provider.
 *
 * Why this module exists. Exercise generation sends a passage to a US provider. That is
 * acceptable only because a passage is not personal data: no child's voice, transcript, word
 * states, name, profile or session goes with it. That property held by convention — the call
 * site had the whole material row and the request in one function, and any future edit could
 * interpolate a field without anyone noticing.
 *
 * So the payload is built here from three declared fields and nothing else, and both the
 * compiler and a test enforce it:
 *
 *  - `ExerciseSource` names exactly what may be sent. The generic rejects a wider object
 *    rather than structurally accepting it, so passing a material row, a session or a child
 *    profile is a compile error, not a silent widening.
 *  - `assertOnlyExerciseFields` repeats the check at runtime, because a cast defeats a type.
 *
 * This is deliberately independent of which provider is configured: it constrains what is
 * sent, not who receives it, and stays correct if the provider changes.
 */

/** Everything that may be sent for exercise generation. Nothing about a child may appear here. */
export type ExerciseSource = {
  readonly title: string;
  readonly readingLevel: string;
  readonly sourceText: string;
};

const ALLOWED_FIELDS = ["title", "readingLevel", "sourceText"] as const;

/** Rejects a wider object at the type level: any extra key is required to be `never`. */
type OnlyExerciseFields<T> = T & Record<Exclude<keyof T, keyof ExerciseSource>, never>;

/** The same check at runtime, for callers that reach here through a cast or untyped data. */
export function assertOnlyExerciseFields(source: object): asserts source is ExerciseSource {
  const extra = Object.keys(source).filter(key => !ALLOWED_FIELDS.includes(key as (typeof ALLOWED_FIELDS)[number]));
  if (extra.length) {
    throw new Error(`Refusing to build an exercise prompt carrying fields beyond the passage itself: ${extra.join(", ")}.`);
  }
}

/** Longest passage sent. Trimming is for cost and latency, not privacy. */
export const MAX_SOURCE_TEXT_CHARS = 7000;

export const EXERCISE_SYSTEM_PROMPT =
  "You are a primary literacy specialist creating safe, useful teacher-reviewed materials.";

export function buildExercisePrompt<T extends ExerciseSource>(source: OnlyExerciseFields<T>): string {
  assertOnlyExerciseFields(source);
  return `Create a concise, encouraging comprehension activity for children aged 8–10. Reading level: ${source.readingLevel}. Reading text:\n\n${source.sourceText.slice(0, MAX_SOURCE_TEXT_CHARS)}\n\nReturn only the requested structured result. Use accessible language. Include 3–6 meaningful vocabulary terms and 3–4 multiple-choice comprehension questions. Do not include sensitive, frightening, discriminatory, or adult content. Avoid diagnosing reading ability.`;
}

const EXERCISE_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "reading_exercise_set",
    strict: true,
    schema: {
      type: "object",
      properties: {
        vocabulary: { type: "array", items: { type: "object", properties: { word: { type: "string" }, childFriendlyMeaning: { type: "string" } }, required: ["word", "childFriendlyMeaning"], additionalProperties: false }, minItems: 3, maxItems: 6 },
        questions: { type: "array", items: { type: "object", properties: { prompt: { type: "string" }, options: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 4 }, answer: { type: "string" }, explanation: { type: "string" } }, required: ["prompt", "options", "answer", "explanation"], additionalProperties: false }, minItems: 3, maxItems: 4 },
        activity: { type: "string" },
      },
      required: ["vocabulary", "questions", "activity"],
      additionalProperties: false,
    },
  },
};

/** The complete request. The router passes this straight through and adds nothing. */
export function buildExerciseGenerationRequest<T extends ExerciseSource>(source: OnlyExerciseFields<T>, model: string) {
  return {
    model,
    messages: [
      { role: "system" as const, content: EXERCISE_SYSTEM_PROMPT },
      { role: "user" as const, content: buildExercisePrompt(source) },
    ],
    response_format: EXERCISE_RESPONSE_FORMAT,
  };
}
