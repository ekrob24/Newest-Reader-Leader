import type { ReadingSession } from "../drizzle/schema";

import { ACCURACY_WITHHELD_NOTE } from "../shared/accuracyAudience";
export type { ReportAudience } from "../shared/accuracyAudience";
import type { ReportAudience } from "../shared/accuracyAudience";
export type ReadingReport = { filename: string; content: string; mimeType: "text/markdown" };

function percent(value: number) { return `${Math.max(0, Math.min(100, value))}%`; }

export function createReadingReport(input: { audience: ReportAudience; childName: string; bookBand: string; sessions: ReadingSession[] }) : ReadingReport {
  const total = input.sessions.length;
  const latest = input.sessions[0];
  const accuracy = total ? Math.round(input.sessions.reduce((sum, session) => sum + session.accuracy, 0) / total) : 0;
  const pace = total ? Math.round(input.sessions.reduce((sum, session) => sum + session.wordsCorrectPerMinute, 0) / total) : 0;
  const date = new Date().toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });

  if (input.audience === "child") {
    return { filename: `${input.childName.toLowerCase().replace(/\s+/g, "-")}-reading-celebration.md`, mimeType: "text/markdown", content: `# ${input.childName}'s Reading Celebration\n\n**${date}** · ${input.bookBand}\n\n## You are growing as a reader\n\nYou completed **${total} Reading Session${total === 1 ? "" : "s"}**. Your latest story was **${latest?.storyTitle ?? "one you have yet to finish"}**, and your steady reading pace is **${latest?.wordsCorrectPerMinute ?? 0} words per minute**.\n\n${ACCURACY_WITHHELD_NOTE}\n\n## Your next brave step\n\nChoose one sentence from your latest story that you enjoyed. Read it slowly, then read it again smoothly.\n\n> Every try grows your reader brain.\n` };
  }
  if (input.audience === "parent") {
    return { filename: `${input.childName.toLowerCase().replace(/\s+/g, "-")}-parent-reading-summary.md`, mimeType: "text/markdown", content: `# Parent Reading Summary: ${input.childName}\n\n**Prepared ${date}** · ${input.bookBand}\n\n## Reading snapshot\n\n| Measure | Current view |\n| --- | --- |\n| Completed Reading Sessions | ${total} |\n| Average WCPM* | ${pace} |\n| Latest story | ${latest?.storyTitle ?? "No saved session yet"} |\n\n${ACCURACY_WITHHELD_NOTE}\n\n## Strengths to notice\n\n${latest ? `- ${input.childName} completed **${latest.storyTitle}** and stayed with a full reading session.\n- Practice signals identify moments to revisit, not grades or diagnoses.` : `- Begin with one short shared story and praise the effort to begin.`}\n\n## Try this together\n\nAsk, “Which part made a picture in your mind?” If a word feels sticky, invite ${input.childName} to look at its first part and have another go.\n\n\*Practice signals based on saved sessions; use alongside your knowledge of the child.\n` };
  }
  return { filename: `${input.childName.toLowerCase().replace(/\s+/g, "-")}-teacher-running-record.md`, mimeType: "text/markdown", content: `# Teacher Running Record: ${input.childName}\n\n**Prepared ${date}** · ${input.bookBand}\n\n## Session summary\n\n| Measure | Value |\n| --- | --- |\n| Saved sessions | ${total} |\n| Average story match* | ${percent(accuracy)} |\n| Average WCPM* | ${pace} |\n| Latest text | ${latest?.storyTitle ?? "No saved session yet"} |\n\n## Recent sessions\n\n${input.sessions.slice(0, 5).map(session => `- **${session.storyTitle}** — ${percent(session.accuracy)} match*, ${session.wordsCorrectPerMinute} WCPM*`).join("\n") || "No reading sessions have been saved."}\n\n## Review notes\n\n${latest?.interventions.filter(item => item.action === "teacher_review").map(item => `- **${item.word}:** ${item.note}`).join("\n") || "No low-confidence moments are currently marked for teacher review."}\n\n> *These indicators support professional judgement; they do not diagnose reading ability.*\n` };
}
