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
import { expect, test, type Locator, type Page } from "@playwright/test";

const PASSAGE_TITLE = "The Lantern in the Garden";
const PASSAGE =
  "Amina carried a little lantern into the garden at dusk. The light made golden circles on the path. " +
  "Near the tall gate, she saw a hedgehog sniffing beside the flowers. Amina stood very still, then " +
  "watched it hurry safely under the hedge.";

/**
 * One TH-stopping variation — "the" read as "de" — and nothing else. TH-stopping is the only
 * event kind that becomes `teacher_review` in guided practice, so this produces exactly one
 * flagged moment for the teacher.
 *
 * Deliberately no substitution here. A page does not advance until every word on it is
 * correct or has been attempted three times (shared/readingPagination.ts), which is the
 * product asking the child to try again — correct behaviour, but it stalls a scripted read.
 * The miscue half of the teacher demonstration therefore uses the seeded running record
 * below, which carries a real substitution.
 */
const SPOKEN = PASSAGE.replace("into the garden", "into de garden");

/** The seeded running record the teacher reviews word by word. It contains a substitution
 *  ("hedgehog" heard as "hedghog"), so confirming it genuinely moves the child's figure. */
const SEEDED_RECORD_TITLE = "The Lantern in the Garden · last week";

/**
 * Recording mode. `pnpm demo:record` sets READER_LEADER_RECORD=1, which turns on video, a
 * trace and these pauses. A run at full speed takes twelve seconds and is unwatchable — the
 * settled-accuracy figure changes and returns inside a second — so the moments worth seeing
 * are held. Nothing here waits in an ordinary run or in CI, so the pauses cannot hide a race:
 * every assertion around them has its own timeout and runs either way.
 */
const RECORDING = process.env.READER_LEADER_RECORD === "1";
async function beat(page: Page, label: string, seconds = 2.5, focus?: Locator) {
  if (!RECORDING) return;
  // Bring the thing being demonstrated into view first. Without this the accuracy figure is
  // scrolled off screen at the exact moment a teacher's decision changes it.
  if (focus) await focus.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `demo-recording/frames/${label}.png` });
  await page.waitForTimeout(seconds * 1000);
}

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
  // The synthetic-data statement is on screen before anyone signs in, and stays on every
  // screen after. A viewer is told without having to ask.
  await expect(page.getByTestId("synthetic-data-notice")).toContainText(/everything here is synthetic/i);
  await beat(page, "01-landing");
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
  await beat(page, "05-last-page");
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
  await beat(page, "06-child-report", 4);
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
  await beat(page, "07-teacher-dashboard", 4);

  // 8. The class is in a reviewable state: the learner and their flagged reading moments are
  //    on screen.
  await expect(page.getByText(/Speech Review Panel/i)).toBeVisible();
  await expect(page.getByText(/flagged moments/i)).toBeVisible();
  await expect(page.getByText(/Amina/).first()).toBeVisible();

  // 8b. The teacher opens one reading word by word and exercises the override — the decision
  //     the product is built around, and the part worth watching, because the number moves.
  //     Before any decision nothing counts against the reading: a machine judgement no human
  //     has checked must not enter a child's record, so the settled figure starts at 100%.
  const seededRow = page.locator(".session-row", { hasText: SEEDED_RECORD_TITLE });
  await seededRow.getByRole("button", { name: /Review word by word/i }).click();
  await expect(page.getByText(/Review the reading record/i)).toBeVisible();

  //     Teacher decisions persist, so this journey needs a database where none have been made
  //     — CI provisions a fresh MySQL for every run, and `pnpm demo:record` resets first. The
  //     precondition is asserted rather than assumed, so a second run against a used database
  //     says what is wrong instead of failing somewhere further down.
  await expect(
    page.getByText("Decision needed"),
    "The seeded running record already carries teacher decisions. Reset the database before running this journey.",
  ).toHaveCount(2);

  const settled = page.getByTestId("settled-accuracy");
  await expect(settled).toHaveText("100%");
  await beat(page, "09-review-before-decisions", 4, settled);

  //     Confirming the substitution is what lets it count. The figure drops.
  //     Asserted on the figure itself rather than on a toast: the toast is transient and says
  //     only that something was saved, while the number is the thing that has to change.
  const miscue = page.getByTestId("error-moments");
  await expect(miscue.getByText("hedgehog")).toBeVisible();
  await miscue.getByRole("button", { name: /^Confirm event$/ }).first().click();
  await expect(settled).not.toHaveText("100%", { timeout: 15_000 });
  const afterConfirm = Number((await settled.innerText()).replace("%", ""));
  expect(afterConfirm).toBeLessThan(100);
  await beat(page, "10-after-confirming-the-miscue", 4, settled);

  //     Overriding takes it back out. This is Article 14 in one screen: the teacher overrules
  //     the model, and the child's record follows the teacher rather than the model.
  await miscue.getByRole("button", { name: /^Override$/ }).first().click();
  await expect(miscue.getByText(/Overridden/).first()).toBeVisible();
  await expect(settled).toHaveText("100%", { timeout: 15_000 });
  await beat(page, "11-after-overriding-the-miscue", 4.5, settled);

  //     The accent variation is a separate category and is never a miscue. Confirming it
  //     leaves the child's record exactly where it was, which is the fairness claim made
  //     visible rather than asserted.
  const accent = page.getByTestId("accent-moments");
  await expect(accent.getByRole("button", { name: /^Confirm variation$/ })).toHaveCount(1);
  await accent.getByRole("button", { name: /^Confirm variation$/ }).first().click();
  await expect(accent.getByText(/Confirmed/).first()).toBeVisible();
  await expect(settled).toHaveText("100%");
  await beat(page, "12-accent-variation-never-counts", 4.5, settled);

  await page.getByRole("button", { name: /Return to Dashboard/i }).click();
  await expect(page.getByText(/Ms Kelly.s Reading Class/)).toBeVisible();

  // 9. The reading the child just finished reached the teacher, and nothing is sitting in the
  //    unrecorded-reading list — the surface that exists so a failed save is visible to
  //    someone rather than to no one.
  await expect(page.getByTestId("unrecorded-attempts")).toHaveCount(0);
  await expect(page.getByTestId("synthetic-data-notice")).toBeVisible();
});
