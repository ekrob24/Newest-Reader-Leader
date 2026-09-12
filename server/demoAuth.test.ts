import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const context = { user: null, req: { headers: {} }, res: {} } as TrpcContext;

describe("demoAccess.verify", () => {
  it("accepts the configured child demo password through the public tRPC endpoint", async () => {
    const caller = appRouter.createCaller(context);
    const result = await caller.demoAccess.verify({ username: "child1", password: process.env.READER_LEADER_CHILD_DEMO_PASSWORD || "" });
    expect(result).toEqual({ username: "child1", role: "child", name: "Amina Roe" });
  });

  it("rejects an incorrect demo password", async () => {
    const caller = appRouter.createCaller(context);
    await expect(caller.demoAccess.verify({ username: "teacher2", password: "not-the-password" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
