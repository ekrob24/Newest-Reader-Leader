/**
 * The demo journey from DEMO_RUNBOOK.md, in the same order, asserting what a person sees.
 * The runbook and this file are the same artefact in two forms — change one, change the other.
 *
 * Runs with no OPENAI_API_KEY. Transcription therefore fails and the save falls back to the
 * guided transcript, which is the resilience path the merge preserved: deterministic, free,
 * no external call, and no audio leaving the test environment.
 *
 * Two substitutions, both because the test environment lacks a capability rather than to make
 * a failing thing pass:
 *
 *  1. The microphone is a committed synthetic tone, fed to Chromium as a fake capture device.
 *     It is a 440Hz tone, not anybody's voice, least of all a child's.
 *
 *  2. `SpeechRecognition` is replaced with one that emits a fixed transcript. This is NOT
 *     cosmetic and is the reason this test could not simply be written: the app's live
 *     transcript comes from the browser's Web Speech API, not from the recorded audio, and
 *     `completeReading()` refuses to finish until that transcript is non-empty. Chromium
 *     exposes the constructor but has no speech backend, so it errors continuously and
 *     "Finish story" does nothing at all — the behaviour recorded in todo.md line 43. Feeding
 *     fake audio does not help, because audio never reaches the gate. Nothing else can drive
 *     it: `onWordAttempt` is declared and passed but never invoked, so no control records a
 *     word attempt, and the guided fallback checks the same gate.
 *
 *     Everything downstream of the transcript is real: the client builds and sends the save
 *     payload itself, which is the failure this test exists to catch.
 */
import { expect, test } from "@playwright/test";

const PASSAGE_TITLE = "The Lantern in the Garden";
const PASSAGE =
  "Amina carried a little lantern into the garden at dusk. The light made golden circles on the path. " +
  "Near the tall gate, she saw a hedgehog sniffing beside the flowers. Amina stood very still, then " +
  "watched it hurry safely under the hedge.";

/**
 * One TH-stopping variation — "the" read as "de" — and nothing else. TH-stopping is the only
 * event kind that becomes `teacher_review` in guided practice, so this produces exactly one
 * flagged moment for the teacher, which is what step 8 needs.
 */
const SPOKEN = PASSAGE.replace("into the garden", "into de garden");

const CHILD_PASSWORD = process.env.READER_LEADER_CHILD_DEMO_PASSWORD ?? "";
const TEACHER_PASSWORD = process.env.READER_LEADER_TEACHER_DEMO_PASSWORD ?? "";

test("the demo journey", async ({ page, context }) => {
  expect(CHILD_PASSWORD, "the demo passwords must be set").not.toBe("");
  expect(TEACHER_PASSWORD, "the demo passwords must be set").not.toBe("");

  await context.addInitScript(spoken => {
    class FakeSpeechRecognition {
      onresult?: (event: unknown) => void;
      start() {
        setTimeout(() => {
          const results = [[{ transcript: spoken }]] as unknown as { isFinal: boolean }[];
          (results[0] as { isFinal: boolean }).isFinal = true;
          this.onresult?.({ results, resultIndex: 0 });
        }, 250);
      }
      stop() {}
      abort() {}
    }
    Object.assign(window, { SpeechRecognition: FakeSpeechRecognition, webkitSpeechRecognition: FakeSpeechRecognition });
  }, SPOKEN);

  // 1. Open the app.
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Continue as Child/i })).toBeVisible();

  // 2. Sign in as the child.
  await page.getByRole("button", { name: /Continue as Child/i }).click();
  await page.locator("input[type=password]").fill(CHILD_PASSWORD);
  await page.getByRole("button", { name: /Open my reading space/i }).click();
  await expect(page.getByRole("button", { name: /Start today.s read/ })).toBeVisible();

  // 3. Start today's read, and take the warm-up into guided reading.
  await page.getByRole("button", { name: /Start today.s read/ }).click();
  await page.getByRole("button", { name: /Start guided reading/ }).click();

  // 4. The passage appears, on its first page.
  await expect(page.getByText(PASSAGE_TITLE).first()).toBeVisible();
  await expect(page.getByText(/Page 1 of 4/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Tap to Read$/ })).toBeVisible();

  // 5. Read aloud. The passage turns its own pages as the words are heard, which is how a
  //    person can see the reading registered — and is the signal that there is something to
  //    finish. "Finish story" is on screen from the start, so clicking it straight away races
  //    the transcript and silently does nothing.
  await page.getByRole("button", { name: /^Tap to Read$/ }).click();
  await expect(page.getByText(/Page 4 of 4/)).toBeVisible();
  // A real read lasts seconds. The recorder emits its first chunk after one second, and the
  // client abandons the save — silently, down the guided path — when the blob is empty.
  // Finishing instantly means the server is never called at all.
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /Finish story/ }).click();

  // 6. The report appears, and the screen states what the SERVER said about the save.
  //    The previous assertion here looked for "Your reading practice was saved", a string the
  //    client produced whatever happened — so it passed while nothing was being written at
  //    all. This reads the save state the report renders from the mutation result, so a
  //    reading the server rejects cannot show the same screen as one it accepted.
  await expect(page.getByText(/That was a brave read/i)).toBeVisible();
  const saveState = page.getByTestId("save-state");
  await expect(saveState).toHaveAttribute("data-save-status", "saved", { timeout: 15_000 });
  await expect(saveState).toContainText(/Your reading is saved/i);

  // 7. Sign in as the teacher.
  await context.clearCookies();
  await page.goto("/");
  await page.getByRole("button", { name: /Continue as Teacher/i }).click();
  await page.locator("input[type=password]").fill(TEACHER_PASSWORD);
  await page.getByRole("button", { name: /Open my reading space/i }).click();
  await expect(page.getByText(/Ms Kelly.s Reading Class/)).toBeVisible();

  // 8. The class is in a reviewable state: the learner and their flagged reading moments are
  //    on screen. This is where the journey stops, because the review queue below it is not
  //    reachable in the running app — see DEMO_RUNBOOK.md, "What the demo does not show".
  await expect(page.getByText(/Speech Review Panel/i)).toBeVisible();
  await expect(page.getByText(/flagged moments/i)).toBeVisible();
  await expect(page.getByText(/Amina/).first()).toBeVisible();

  // 9. The reading the child just finished reached the teacher, and nothing is sitting in the
  //    unrecorded-reading list — the surface that exists so a failed save is visible to
  //    someone rather than to no one.
  await expect(page.getByTestId("unrecorded-attempts")).toHaveCount(0);
});
