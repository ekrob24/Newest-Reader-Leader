# Unified merge — what was done and why

This repository is `reading-project-ui-update` (the newest UI architecture) with
`reading-project-first-fork` merged into it. Both branches descend from the same
initial commit and share migration history exactly through `0009_strange_solo`,
so this was a real `git merge`, not a hand port. Full history from both sides is
preserved.

**Verified after the merge:** `tsc --noEmit` clean, 62 tests passing
(8 skipped, 2 suites skipped without a database), `vite build` succeeds.

## Base choice

The UI branch is the base because it carries the new UI and, more importantly,
the `provisionalMatchReviews` review queue and `educatorApprovedIrishVariants`,
which the teacher-review and retention design depend on. The fork never had
those tables.

## Database

`drizzle/schema.ts` merged cleanly on its own. The result has all 20 tables:

- From the fork: `readingMaterialDetails`, and the richer `StoredIntervention`
  (`eventType`, `heardWord`, `provisionalIrishEnglish`, `teacherDecision`).
- From the base: `provisionalMatchReviews`, `educatorApprovedIrishVariants`,
  `weeklyReadingGoals`, `readerClasses.defaultLanguageSupport`,
  `readingMaterials.summary`.

Both branches had used migration slot `0010`, which collided. Resolution:

1. Kept the base's `drizzle/meta/_journal.json` and `0010_snapshot.json`.
2. Deleted the fork's `0010_illegal_wrecking_crew.sql`.
3. Ran `drizzle-kit generate`, which produced `0014_third_maelstrom.sql`
   creating `readingMaterialDetails` — and nothing else, confirming the rest of
   the merged schema already matched snapshot `0013`.

The journal was never hand-edited and the snapshot chain is consistent.

## Dialect matching — the one real design decision

The two branches had genuinely different matchers:

- Base: a hand-kept lookup list, plus educator-approved variants from the
  database, returning `source: "built_in" | "educator_approved"`.
- Fork: a rule engine deriving variants from TH-stopping, G-dropping,
  TH-cluster reduction and the cot-caught merger, returning a `feature`.

**Resolution: the fork's rule engine plus the base's educator-approved layer.**
`matchExpectedReadingWord` now checks educator-approved variants first (an
explicit teacher decision for their class wins), then the rules, and returns
both `feature` and `source`. The `source` values are unchanged, so
`provisionalMatchReviews.source` needs no migration.

The base's curated list was **dropped deliberately**. It contained
`park -> pork`, `hard -> hod` and `card -> cod`, which are non-rhotic
r-dropping. Irish English is rhotic, so those are genuine misreads, not dialect
features — the fork is linguistically right and has a test asserting it.
Everything else in that list is already derivable from the rules.

## Session save path

Merged rather than chosen:

- Transcription now uses the fork's `whisperTranscription.ts` (audio bytes sent
  directly, no storage round trip).
- The base's resilience is kept: storage and transcription run in
  `Promise.allSettled`, a transcription failure falls back to
  `input.fallbackTranscript` and reports `transcriptionStatus: "guided"`.
- Audio is still written to storage, because the teacher review queue needs a
  clip to play back.
- Interventions carry the fork's richer fields.
- `analyseReadingText` still receives the educator-approved variants.

## Known follow-ups (not merge failures)

1. **`materials.approve` semantics changed.** In the fork, approving a text no
   longer assigns it — `makeAssignable` and `assignToClasses` are separate
   steps. `TeacherWorkflow` now shows a toast instead of navigating to the
   assignment confirmation page. The confirmation flow needs rewiring to the
   three-step lifecycle.
2. **The base's exercise editor was lost.** Adding, reordering and removing
   comprehension questions existed on the base's `ExerciseDocument` but the
   merged router uses the fork's `approveReadingMaterial` path. Re-add against
   the new lifecycle.
3. **Author / rights / interest age / genre are now required** when creating a
   material. Fields were added to both `TeacherMaterialUploader` and the inline
   material lab in `Home.tsx`. `rightsSource` defaults to `original` — check
   that default before a real teacher uses it.
4. **`OPENAI_API_KEY` is now required** for transcription. See the compliance
   plan: OpenAI is a US processor, and this is currently the only component
   sending child audio outside the EU.

## Environment variables

Tests need the demo passwords set, or `demoAuth.test.ts` fails on empty input:

```
READER_LEADER_CHILD_DEMO_PASSWORD=...
READER_LEADER_TEACHER_DEMO_PASSWORD=...
READER_LEADER_PARENT_DEMO_PASSWORD=...
```

Also required at runtime: `DATABASE_URL`, `JWT_SECRET`, `OPENAI_API_KEY`,
`BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY`.
