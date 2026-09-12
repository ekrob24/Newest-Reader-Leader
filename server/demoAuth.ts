import { timingSafeEqual } from "node:crypto";

export type DemoAccount = {
  username: "child1" | "teacher2" | "parent3";
  openId: string;
  name: string;
  role: "child" | "teacher" | "parent";
  passwordEnv: "READER_LEADER_CHILD_DEMO_PASSWORD" | "READER_LEADER_TEACHER_DEMO_PASSWORD" | "READER_LEADER_PARENT_DEMO_PASSWORD";
};

const accounts: DemoAccount[] = [
  { username: "child1", openId: "reader-leader-local-child1", name: "Amina Roe", role: "child", passwordEnv: "READER_LEADER_CHILD_DEMO_PASSWORD" },
  { username: "teacher2", openId: "reader-leader-local-teacher2", name: "Ms Kelly", role: "teacher", passwordEnv: "READER_LEADER_TEACHER_DEMO_PASSWORD" },
  { username: "parent3", openId: "reader-leader-local-parent3", name: "Amina’s Parent", role: "parent", passwordEnv: "READER_LEADER_PARENT_DEMO_PASSWORD" },
];

function secureMatch(value: string, expected: string) {
  const left = Buffer.from(value);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Demo-only verification. Values remain server-side environment variables. */
export function verifyDemoCredentials(username: string, password: string): DemoAccount | null {
  const account = accounts.find(candidate => candidate.username === username.trim().toLowerCase());
  if (!account) return null;
  const expectedPassword = process.env[account.passwordEnv];
  if (!expectedPassword || !secureMatch(password, expectedPassword)) return null;
  return account;
}
