import { describe, expect, it } from "vitest";
import { readerLeaderRouter } from "./routers/readerLeader";

/** Reads the duration bound straight off the procedure input schema, so the floor cannot
 *  quietly creep back up. A rejected save is a silent failure: the child sees a success
 *  screen and the teacher sees no record at all, which is the exact class of bug this
 *  project keeps finding. */
function durationSchema(procedure: string) {
  const record = (readerLeaderRouter as unknown as { _def: { procedures: Record<string, { _def: { inputs: unknown[] } }> } })._def.procedures;
  const found = record[procedure];
  if (!found) throw new Error(`No procedure named ${procedure}; the test is checking nothing.`);
  const input = found._def.inputs.at(-1) as { shape?: Record<string, { safeParse(value: unknown): { success: boolean } }> } | undefined;
  const shape = input && "shape" in input ? input.shape : undefined;
  const duration = shape?.durationSeconds;
  if (!duration) throw new Error(`${procedure} has no durationSeconds field; the test is checking nothing.`);
  return duration;
}

const procedures = ["sessions.processAndSave", "sessions.save"] as const;

describe("reading duration is not a reason to reject a save", () => {
  it.each(procedures)("%s accepts a one-second read", name => {
    expect(durationSchema(name).safeParse(1).success).toBe(true);
  });

  it.each(procedures)("%s accepts a read longer than the old fifteen-minute ceiling", name => {
    expect(durationSchema(name).safeParse(1_800).success).toBe(true);
  });

  it.each(procedures)("%s still rejects a payload no clock could produce", name => {
    expect(durationSchema(name).safeParse(-1).success).toBe(false);
    expect(durationSchema(name).safeParse(90_000).success).toBe(false);
    expect(durationSchema(name).safeParse("60").success).toBe(false);
  });
});
