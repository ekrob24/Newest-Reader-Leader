import PDFDocument from "pdfkit";
import type { ReadingSession } from "../drizzle/schema";
import type { ReportAudience } from "./readerReports";

type Brand = { schoolName: string; accentColor: string; footerLine: string };
type Comment = { sessionId: string; comment: string; createdAt: Date };

function colorOrDefault(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#2563EB";
}

export async function createBrandedPdfReport(input: { audience: ReportAudience; childName: string; bookBand: string; sessions: ReadingSession[]; branding: Brand; comments: Comment[] }) {
  const document = new PDFDocument({ margin: 48, size: "A4", info: { Title: `${input.childName} Reading Report` } });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const complete = new Promise<Buffer>((resolve, reject) => { document.on("end", () => resolve(Buffer.concat(chunks))); document.on("error", reject); });
  const accent = colorOrDefault(input.branding.accentColor);
  const total = input.sessions.length;
  const averageAccuracy = total ? Math.round(input.sessions.reduce((sum, session) => sum + session.accuracy, 0) / total) : 0;
  const averageWcpm = total ? Math.round(input.sessions.reduce((sum, session) => sum + session.wordsCorrectPerMinute, 0) / total) : 0;
  const latest = input.sessions[0];
  const label = input.audience === "child" ? "Reading Celebration" : input.audience === "parent" ? "Parent Reading Summary" : "Teacher Running Record";
  document.rect(0, 0, document.page.width, 82).fill(accent);
  document.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(18).text(input.branding.schoolName, 48, 26);
  document.font("Helvetica").fontSize(9).text("READER LEADER", 48, 50);
  document.fillColor("#172554").font("Helvetica-Bold").fontSize(24).text(`${input.childName}’s ${label}`, 48, 112);
  document.font("Helvetica").fontSize(11).fillColor("#475569").text(`${input.bookBand} · Prepared ${new Date().toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" })}`, 48, 144);
  document.moveTo(48, 168).lineTo(547, 168).strokeColor(accent).lineWidth(2).stroke();
  document.fillColor("#172554").font("Helvetica-Bold").fontSize(14).text("Reading snapshot", 48, 190);
  const snapshot = [`Saved Reading Sessions: ${total}`, `Average story match*: ${averageAccuracy}%`, `Average WCPM*: ${averageWcpm}`, `Latest story: ${latest?.storyTitle ?? "No saved session yet"}`];
  document.font("Helvetica").fontSize(11).fillColor("#334155").list(snapshot, 62, 216, { bulletRadius: 2, textIndent: 10, lineGap: 5 });
  const heading = input.audience === "child" ? "Your next brave step" : input.audience === "parent" ? "Try this together" : "Teacher feedback and review notes";
  document.fillColor("#172554").font("Helvetica-Bold").fontSize(14).text(heading, 48, 320);
  const notes = input.audience === "child"
    ? "Choose one favourite sentence and read it slowly, then smoothly. Every try grows your reader brain."
    : input.audience === "parent"
      ? `Ask ${input.childName}, “Which part made a picture in your mind?” Praise the effort to reread a tricky word.`
      : (input.comments.map(comment => comment.comment).join("\n• ") || "No teacher feedback has been added yet.");
  document.font("Helvetica").fontSize(11).fillColor("#334155").text(notes, 48, 347, { width: 495, lineGap: 5 });
  if (input.audience === "teacher") {
    document.fillColor("#172554").font("Helvetica-Bold").fontSize(14).text("Recent session evidence", 48, 445);
    document.font("Helvetica").fontSize(10).fillColor("#334155");
    input.sessions.slice(0, 4).forEach((session, index) => document.text(`${index + 1}. ${session.storyTitle} — ${session.accuracy}% story match*, ${session.wordsCorrectPerMinute} WCPM*`, 55, 470 + index * 24));
  }
  document.font("Helvetica-Oblique").fontSize(8).fillColor("#64748B").text(`${input.branding.footerLine}\n*Practice signals support conversation and professional judgement; they do not diagnose reading ability.`, 48, 760, { width: 495, align: "center" });
  document.end();
  return complete;
}
